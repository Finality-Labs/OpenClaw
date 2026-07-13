import { keccak256, stringToHex } from "viem";
import {
  DEFAULT_CONFIG,
  NegotiationConfig,
  Terms,
  parseEnvelope,
  SystemEnvelope,
  ClosedDeal,
} from "./protocol.js";

// Identity carried at join time (contract §5 deal shape).
export interface PartyIdentity {
  agentRegistry: string;
  agentId: string;
  wallet: string;
  // Price bound: buyer's hard ceiling (maxUnitPrice), seller's floor.
  maxUnitPrice?: number; // buyer
  floorUnitPrice?: number; // seller
}

export type RoomStatus = "open" | "closed";

export interface JoinedParty {
  role: "buyer" | "seller";
  identity: PartyIdentity;
  send: (data: string) => void;
}

interface TranscriptEntry {
  type: string;
  from: "buyer" | "seller";
  round: number;
  payload: unknown;
  ts: number;
}

export interface DealResult {
  roomId: string;
  transcriptHash: string;
  deal: ClosedDeal;
}

// A negotiation room. Enforces the protocol from contract §4:
//  - exactly two parties (buyer + seller)
//  - alternating turns
//  - maxRounds cap → constraint-hit
//  - minDelta on counteroffers → rejects stalls
//  - price bounds (buyer ceiling / seller floor) enforced on accept
//  - appends every message to a transcript; on terminal, keccak256(JSON(transcript))
export class Room {
  readonly roomId: string;
  status: RoomStatus = "open";
  config: NegotiationConfig;

  private parties: Partial<Record<"buyer" | "seller", JoinedParty>> = {};
  private transcript: TranscriptEntry[] = [];
  private turn: "buyer" | "seller" | null = null;
  private round = 0; // completed counteroffer rounds

  // track the last opposing offer so we can enforce minDelta
  private lastOffer: { role: "buyer" | "seller"; unitPrice: number } | null = null;
  private lastTerms: Terms | null = null;
  private result: DealResult | null = null;

  constructor(
    roomId: string,
    config: Partial<NegotiationConfig> = {},
    private onDeal?: (result: DealResult) => void,
  ) {
    this.roomId = roomId;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get isFull(): boolean {
    return !!this.parties.buyer && !!this.parties.seller;
  }

  // Returns the role assigned, or null if the room is full.
  join(role: "buyer" | "seller", identity: PartyIdentity, send: (data: string) => void): boolean {
    if (this.parties[role]) return false; // role already taken
    if (this.parties.buyer && this.parties.seller) return false; // room full
    this.parties[role] = { role, identity, send };
    this.broadcast({
      type: "system",
      kind: "info",
      message: `${role} joined`,
      ts: Date.now(),
    });
    // The first joiner is the buyer (natural initiator) unless roles were
    // explicit; turn passes to buyer when the room is ready.
    if (this.isFull) {
      this.turn = "buyer";
      this.broadcast({
        type: "system",
        kind: "info",
        message: "room ready — buyer to move",
        ts: Date.now(),
      });
    }
    return true;
  }

  // Handle an incoming client frame (already JSON-parsed, raw).
  handle(role: "buyer" | "seller", raw: unknown): void {
    if (this.status === "closed") return;
    const who = this.parties[role];
    if (!who) return; // unknown party

    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      this.tell(role, { type: "system", kind: "error", message: "invalid envelope", ts: Date.now() });
      return;
    }
    const env = parsed.value;
    if (env.from !== role) {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: `envelope.from=${env.from} but you are ${role}`,
        ts: Date.now(),
      });
      return;
    }
    if (env.type === "system") {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: "clients may not send system frames",
        ts: Date.now(),
      });
      return;
    }

    switch (env.type) {
      case "counteroffer":
        this.onCounteroffer(role, env);
        break;
      case "accept":
        this.onAccept(role, env);
        break;
      case "reject":
        this.onReject(role);
        break;
      case "close":
        this.closeBy(role);
        break;
    }
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  private onCounteroffer(
    role: "buyer" | "seller",
    env: { from: "buyer" | "seller"; round: number; payload?: Record<string, unknown>; ts?: number },
  ): void {
    if (!this.checkTurn(role)) return;
    const p = env.payload ?? {};
    const unitPrice = p.unitPrice;
    const qty = p.qty;
    const terms = typeof p.terms === "string" ? p.terms : "";
    if (typeof unitPrice !== "number" || typeof qty !== "number") {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: "counteroffer requires numeric unitPrice and qty",
        ts: Date.now(),
      });
      return;
    }

    // minDelta: a counteroffer must move the price by >= minDelta from the last
    // OPPOSING offer (within bounds). Prevents stalling.
    if (this.lastOffer && this.lastOffer.role !== role) {
      const delta = Math.abs(unitPrice - this.lastOffer.unitPrice);
      if (delta < this.config.minDelta) {
        this.tell(role, {
          type: "system",
          kind: "error",
          message: `price moved < minDelta (${this.config.minDelta}) from opposing ${this.lastOffer.unitPrice}`,
          ts: Date.now(),
        });
        return;
      }
    }

    const termsObj: Terms = {
      unitPrice,
      qty,
      terms,
      requirements: (p.requirements as Record<string, unknown>) ?? {},
    };
    this.lastTerms = termsObj;
    this.lastOffer = { role, unitPrice };
    // Use the client-supplied timestamp when present so the transcript hash is
    // deterministic for a given message sequence (TDD #2); fall back to a
    // monotonic sequence number otherwise.
    const ts = typeof env.ts === "number" ? env.ts : this.transcript.length + 1;
    this.append(role, env.round, termsObj, ts);

    this.round += 1;
    this.turn = role === "buyer" ? "seller" : "buyer";

    if (this.round >= this.config.maxRounds) {
      // cap reached with no accept → constraint-hit
      this.terminate({
        type: "system",
        kind: "constraint-hit",
        lastTerms: this.lastTerms,
        reason: `maxRounds (${this.config.maxRounds}) reached`,
        ts: Date.now(),
      });
      return;
    }
    this.broadcast(env as never); // reflect the accepted counteroffer to both
  }

  private onAccept(
    role: "buyer" | "seller",
    env: { from: "buyer" | "seller"; round: number; payload?: Record<string, unknown>; ts?: number },
  ): void {
    if (!this.checkTurn(role)) return;
    if (!this.lastTerms) {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: "cannot accept before any offer exists",
        ts: Date.now(),
      });
      return;
    }
    const agreed: Terms = {
      unitPrice: this.lastTerms.unitPrice,
      qty: this.lastTerms.qty,
      terms: this.lastTerms.terms,
      requirements: this.lastTerms.requirements,
    };

    // Buyer may never accept > its maxUnitPrice; seller may never go below floor.
    const buyerFloor = this.parties.buyer?.identity.floorUnitPrice; // unused but kept for clarity
    void buyerFloor;
    const buyer = this.parties.buyer!;
    const seller = this.parties.seller!;
    const buyerCeiling = buyer.identity.maxUnitPrice;
    const sellerFloor = seller.identity.floorUnitPrice;
    if (buyerCeiling !== undefined && agreed.unitPrice > buyerCeiling) {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: `price ${agreed.unitPrice} exceeds buyer ceiling ${buyerCeiling}`,
        ts: Date.now(),
      });
      return;
    }
    if (sellerFloor !== undefined && agreed.unitPrice < sellerFloor) {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: `price ${agreed.unitPrice} below seller floor ${sellerFloor}`,
        ts: Date.now(),
      });
      return;
    }

    const acceptTs = typeof env.ts === "number" ? env.ts : this.transcript.length + 1;
    this.append(role, env.round, agreed, acceptTs);
    const deal: ClosedDeal = {
      buyer: {
        agentRegistry: buyer.identity.agentRegistry,
        agentId: buyer.identity.agentId,
        wallet: buyer.identity.wallet,
      },
      seller: {
        agentRegistry: seller.identity.agentRegistry,
        agentId: seller.identity.agentId,
        wallet: seller.identity.wallet,
      },
      unitPrice: agreed.unitPrice,
      qty: agreed.qty,
      terms: agreed.terms,
      totalUsdc: agreed.unitPrice * agreed.qty,
    };
    const transcriptHash = this.computeHash();
    this.result = { roomId: this.roomId, transcriptHash, deal };
    this.terminate({
      type: "system",
      kind: "deal-closed",
      deal,
      transcriptHash,
      ts: Date.now(),
    });
  }

  private onReject(role: "buyer" | "seller"): void {
    if (!this.checkTurn(role)) return;
    this.tell(role, {
      type: "system",
      kind: "info",
      message: `${role} rejected — proposing new terms`,
      ts: Date.now(),
    });
    // A reject does not change the turn; the same party may counter again.
    // (Keeps the round count honest — only accepted counteroffers advance.)
  }

  private closeBy(role: "buyer" | "seller"): void {
    this.terminate({
      type: "system",
      kind: "constraint-hit",
      lastTerms: this.lastTerms,
      reason: `closed by ${role}`,
      ts: Date.now(),
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private checkTurn(role: "buyer" | "seller"): boolean {
    if (this.turn === null) {
      this.tell(role, { type: "system", kind: "error", message: "not your turn yet", ts: Date.now() });
      return false;
    }
    if (role !== this.turn) {
      this.tell(role, {
        type: "system",
        kind: "error",
        message: `out of turn (expected ${this.turn})`,
        ts: Date.now(),
      });
      return false;
    }
    return true;
  }

  private append(role: "buyer" | "seller", round: number, payload: unknown, ts: number): void {
    this.transcript.push({ type: "msg", from: role, round, payload, ts });
  }

  private computeHash(): string {
    return keccak256(stringToHex(JSON.stringify(this.transcript)));
  }

  private broadcast(env: SystemEnvelope | Record<string, unknown>): void {
    const data = JSON.stringify(env);
    for (const p of Object.values(this.parties)) p?.send(data);
  }

  private tell(role: "buyer" | "seller", env: SystemEnvelope): void {
    this.parties[role]?.send(JSON.stringify(env));
  }

  // Terminal: emit the system frame, close the room, resolve any waiters.
  private terminate(env: SystemEnvelope): void {
    if (this.status === "closed") return;
    this.status = "closed";
    this.broadcast(env);
    if (env.type === "system" && env.kind === "deal-closed" && this.result) {
      this.onDeal?.(this.result);
    }
  }

  getResult(): DealResult | null {
    return this.result;
  }

  // Last received terms (for constraint-hit payloads / inspection).
  getLastTerms(): Terms | null {
    return this.lastTerms;
  }
}
