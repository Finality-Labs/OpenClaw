import WebSocket from "ws";

/**
 * Negotiation strategy + WebSocket client for the Finality reference agent.
 *
 * Implements the protocol from `finality-agent-skill.md` §6 and is interoperable
 * with the real `packages/negotiate` server (Part 2), which requires a `join`
 * handshake before counteroffers and gates the buyer's first move on a
 * "room ready" system frame. The contract `contracts/CONTRACT.md` §4 is the
 * envelope spec; this client also emits/reads the `join` control message the
 * server needs.
 */

export type Role = "buyer" | "seller";

export interface PartyIdentity {
  agentRegistry: string;
  agentId: string;
  wallet: string;
}

export interface NegotiationPolicy {
  role: Role;
  /** buyer: ceiling price per unit. seller: floor price per unit. */
  price: number;
  qty: number;
  terms: string;
  requirements: Record<string, unknown>;
  /** server-enforced; mirrored here for correct client behavior. */
  maxRounds?: number;
  minDelta?: number;
  /** optional hard risk cap for a buyer (safety surfacing). */
  hardMax?: number;
}

export interface DealResult {
  kind: "deal-closed" | "constraint-hit";
  unitPrice?: number;
  qty?: number;
  terms?: string;
  transcriptHash?: string;
}

interface Msg {
  type: "counteroffer" | "accept" | "reject" | "close" | "system" | "join";
  from?: "buyer" | "seller";
  kind?: string;
  round?: number;
  payload?: any;
  message?: string;
  deal?: any;
  ts?: number;
}

const DEFAULT_MAX_ROUNDS = 10;
const DEFAULT_MIN_DELTA = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the next price move for this role, strictly respecting `minDelta`
 * (the server rejects counteroffers that move < minDelta from the opposing
 * price) and never crossing the agent's own bound.
 *  - Buyer starts at its max and moves DOWN toward the seller's last price.
 *  - Seller starts at its floor and moves UP toward the buyer's last price.
 * `nextPrice` is used for *responses* only; the opening move always sends
 * `policy.price` (the agent's own bound). The returned price is guaranteed to
 * be strictly between the agent's bound and the counterparty price, offset by
 * at least `minDelta`, so the server accepts it.
 */
export function nextPrice(policy: NegotiationPolicy, counterpartyPrice: number): number {
  const minDelta = policy.minDelta ?? DEFAULT_MIN_DELTA;
  if (policy.role === "buyer") {
    const delta = policy.price - counterpartyPrice; // >0 when we're above
    const step = Math.max(minDelta, delta / 2);
    let candidate = policy.price - step;
    candidate = Math.min(candidate, policy.price); // never above our max
    candidate = Math.max(candidate, counterpartyPrice); // never undercut
    // keep a server-valid move (delta >= minDelta from counterparty)
    if (candidate - counterpartyPrice < minDelta) candidate = counterpartyPrice + minDelta;
    if (candidate > policy.price) candidate = policy.price;
    return round2(candidate);
  } else {
    const delta = counterpartyPrice - policy.price; // >0 when we're below
    const step = Math.max(minDelta, delta / 2);
    let candidate = policy.price + step;
    candidate = Math.max(candidate, policy.price); // never below our floor
    candidate = Math.min(candidate, counterpartyPrice); // never exceed
    if (counterpartyPrice - candidate < minDelta) candidate = counterpartyPrice - minDelta;
    if (candidate < policy.price) candidate = policy.price;
    return round2(candidate);
  }
}

export function accepts(policy: NegotiationPolicy, counterpartyPrice: number): boolean {
  if (policy.role === "buyer") return counterpartyPrice <= policy.price;
  return counterpartyPrice >= policy.price;
}

/**
 * Run a negotiation as `role` against the given ws URL. Resolves with the
 * terminal deal/constraint result.
 */
export function negotiate(
  wsUrl: string,
  policy: NegotiationPolicy,
  identity: PartyIdentity,
  opts: { timeoutMs?: number; log?: (s: string) => void } = {}
): Promise<DealResult> {
  const log = opts.log ?? (() => {});
  const minDelta = policy.minDelta ?? DEFAULT_MIN_DELTA;
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return new Promise<DealResult>((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let round = 1;
    let done = false;
    let opened = false; // buyer has sent its opening counteroffer
    let joined = false;

    const finish = (r: DealResult) => {
      if (done) return;
      done = true;
      try { ws.close(); } catch {}
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      log("negotiation timed out");
      finish({ kind: "constraint-hit" });
    }, timeoutMs);

    const send = (m: Msg) => {
      m.ts = Date.now();
      if (m.type === "counteroffer" || m.type === "accept") m.round = round;
      if (m.type === "counteroffer" || m.type === "accept") m.from = policy.role;
      ws.send(JSON.stringify(m));
    };

    const join = () => {
      // Real Part 2 server expects: { type:"join", role, identity:{...} }
      // where identity carries the ERC-8004 fields + the price bound
      // (buyer: maxUnitPrice, seller: floorUnitPrice).
      const joinMsg: any = {
        type: "join",
        role: policy.role,
        identity: {
          agentRegistry: identity.agentRegistry,
          agentId: identity.agentId,
          wallet: identity.wallet,
        },
      };
      if (policy.role === "buyer") joinMsg.identity.maxUnitPrice = policy.price;
      else joinMsg.identity.floorUnitPrice = policy.price;
      ws.send(JSON.stringify(joinMsg));
      joined = true;
      log(`${policy.role} joined room`);
    };

    const counteroffer = (price: number) => {
      send({
        type: "counteroffer",
        payload: {
          unitPrice: price,
          qty: policy.qty,
          terms: policy.terms,
          requirements: policy.requirements,
        },
      });
      log(`${policy.role} counteroffer round ${round}: ${price}`);
    };

    const accept = (price: number) => {
      send({
        type: "accept",
        payload: { unitPrice: price, qty: policy.qty, terms: policy.terms },
      });
      log(`${policy.role} ACCEPT ${price}`);
    };

    const isDealClosed = (msg: Msg) =>
      msg.kind === "deal-closed" ||
      (msg.type === "system" && msg.payload?.kind === "deal-closed") ||
      (msg.type === "system" && typeof msg.payload?.unitPrice === "number" && msg.deal);

    const isConstraintHit = (msg: Msg) =>
      msg.kind === "constraint-hit" ||
      (msg.type === "system" && msg.payload?.kind === "constraint-hit");

    ws.on("open", () => join());

    ws.on("message", (data: WebSocket.RawData) => {
      let msg: Msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      // ── System frames ───────────────────────────────────────────────
      if (msg.type === "system") {
        if (isDealClosed(msg)) {
          const d = msg.deal ?? msg.payload;
          log(`system: deal-closed ${JSON.stringify(d)}`);
          return finish({
            kind: "deal-closed",
            unitPrice: d?.unitPrice,
            qty: d?.qty,
            terms: d?.terms,
            transcriptHash: (msg as any).transcriptHash ?? msg.payload?.transcriptHash,
          });
        }
        if (isConstraintHit(msg)) {
          log("system: constraint-hit (no deal)");
          return finish({ kind: "constraint-hit" });
        }
        // "room ready — buyer to move": buyer opens.
        if (
          policy.role === "buyer" &&
          !opened &&
          typeof msg.message === "string" &&
          /room ready/i.test(msg.message)
        ) {
          opened = true;
          counteroffer(policy.price);
        }
        return;
      }

      // ── Counteroffers from the counterparty ─────────────────────────
      if (msg.from && msg.from !== policy.role && msg.type === "counteroffer") {
        const price = msg.payload?.unitPrice;
        if (typeof price !== "number") return;

        // Safety surfacing (buyer only): flag abnormal amounts.
        if (policy.role === "buyer" && policy.hardMax != null && price > policy.hardMax) {
          log(`SAFETY: proposed price ${price} exceeds hardMax ${policy.hardMax} — surface to human`);
          send({ type: "reject", payload: { reason: "exceeds risk policy" } });
          return finish({ kind: "constraint-hit" });
        }

        if (accepts(policy, price)) {
          accept(price);
          return;
        }

        if (round >= (policy.maxRounds ?? DEFAULT_MAX_ROUNDS)) {
          log("maxRounds reached — close");
          send({ type: "close", payload: { reason: "maxRounds" } });
          return finish({ kind: "constraint-hit" });
        }

        const move = nextPrice(policy, price);
        // If we cannot improve further within our bound, close.
        const stuck =
          policy.role === "buyer"
            ? move <= price + minDelta / 2
            : move >= price - minDelta / 2;
        if (stuck) {
          send({ type: "close", payload: { reason: "no improvement" } });
          return finish({ kind: "constraint-hit" });
        }
        round += 1;
        counteroffer(move);
      }
    });

    ws.on("error", (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
