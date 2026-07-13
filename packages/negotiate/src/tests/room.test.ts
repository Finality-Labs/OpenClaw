import { describe, it, expect } from "vitest";
import { Room, PartyIdentity } from "../room.js";

function buyer(): PartyIdentity {
  return {
    agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    agentId: "1",
    wallet: "0xBUYER",
    maxUnitPrice: 20,
  };
}
function seller(floor = 18): PartyIdentity {
  return {
    agentRegistry: "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e",
    agentId: "2",
    wallet: "0xSELLER",
    floorUnitPrice: floor,
  };
}

// A mock "send" that records frames per party.
function makeParty() {
  const frames: any[] = [];
  const send = (d: string) => frames.push(JSON.parse(d));
  return { frames, send };
}

const co = (role: "buyer" | "seller", round: number, unitPrice: number, qty = 5, terms = "ok", ts?: number) => ({
  type: "counteroffer",
  from: role,
  round,
  payload: { unitPrice, qty, terms },
  ts,
});
const accept = (role: "buyer" | "seller", round: number, ts?: number) => ({
  type: "accept",
  from: role,
  round,
  ts,
});

describe("Room protocol", () => {
  it("rejects a 3rd connection to a full room", () => {
    const r = new Room("r1");
    expect(r.join("buyer", buyer(), () => {})).toBe(true);
    expect(r.join("seller", seller(), () => {})).toBe(true);
    expect(r.join("buyer", buyer(), () => {})).toBe(false); // role taken
    expect(r.join("seller", seller(), () => {})).toBe(false); // room full
    expect(r.isFull).toBe(true);
  });

  it("deal-closed on accept with agreed unitPrice + deterministic hash", () => {
    const b = makeParty();
    const s = makeParty();
    let notified: any = null;
    const r = new Room("r2", {}, (res) => (notified = res));
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(), s.send);

    r.handle("buyer", co("buyer", 1, 20, 5, "ok", 1));
    r.handle("seller", co("seller", 2, 19, 5, "ok", 2));
    r.handle("buyer", accept("buyer", 3, 3));

    // both parties see deal-closed
    const bClosed = b.frames.find((f: any) => f.kind === "deal-closed");
    const sClosed = s.frames.find((f: any) => f.kind === "deal-closed");
    expect(bClosed).toBeTruthy();
    expect(sClosed).toBeTruthy();
    expect(bClosed.deal.unitPrice).toBe(19);
    expect(bClosed.deal.totalUsdc).toBe(95); // 19 * 5
    expect(bClosed.transcriptHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(notified.roomId).toBe("r2");

    // determinism: same sequence → same hash
    const b2 = makeParty();
    const s2 = makeParty();
    const r2 = new Room("r3");
    r2.join("buyer", buyer(), b2.send);
    r2.join("seller", seller(), s2.send);
    r2.handle("buyer", co("buyer", 1, 20, 5, "ok", 1));
    r2.handle("seller", co("seller", 2, 19, 5, "ok", 2));
    r2.handle("buyer", accept("buyer", 3, 3));
    const closed2 = b2.frames.find((f: any) => f.kind === "deal-closed") as any;
    expect(closed2.transcriptHash).toBe(bClosed.transcriptHash);
  });

  it("out-of-turn message is rejected with system: error and ignored", () => {
    const b = makeParty();
    const s = makeParty();
    const r = new Room("r4");
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(), s.send);
    // seller sends before buyer (turn is buyer)
    r.handle("seller", co("seller", 1, 19));
    const err = s.frames.find((f: any) => f.kind === "error");
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/out of turn/);
    // turn unchanged → still buyer
    r.handle("buyer", co("buyer", 1, 20));
    expect(b.frames.some((f: any) => f.type === "counteroffer")).toBe(true);
  });

  it("maxRounds=2 → constraint-hit after two rounds with no accept", () => {
    const b = makeParty();
    const s = makeParty();
    const r = new Room("r5", { maxRounds: 2, minDelta: 0.01 });
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(), s.send);
    r.handle("buyer", co("buyer", 1, 20, 5, "a", 1));
    r.handle("seller", co("seller", 2, 19, 5, "b", 2));
    r.handle("buyer", co("buyer", 3, 18, 5, "c", 3));
    r.handle("seller", co("seller", 4, 17, 5, "d", 4));
    const hit = b.frames.find((f: any) => f.kind === "constraint-hit");
    expect(hit).toBeTruthy();
    expect(hit.reason).toMatch(/maxRounds/);
  });

  it("minDelta violation is rejected", () => {
    const b = makeParty();
    const s = makeParty();
    const r = new Room("r6", { minDelta: 1 });
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(), s.send);
    r.handle("buyer", co("buyer", 1, 20, 5, "a", 1));
    // seller moves only 0.5 (< minDelta 1) from 20
    r.handle("seller", co("seller", 2, 19.5, 5, "b", 2));
    const err = s.frames.find((f: any) => f.kind === "error");
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/minDelta/);
  });

  it("buyer may not accept above its maxUnitPrice", () => {
    const b = makeParty();
    const s = makeParty();
    const r = new Room("r7");
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(25), s.send); // seller floor 25, above buyer ceiling 20
    r.handle("buyer", co("buyer", 1, 20, 5, "a", 1));
    r.handle("seller", co("seller", 2, 25, 5, "b", 2));
    r.handle("buyer", accept("buyer", 3, 3));
    const err = b.frames.find((f: any) => f.kind === "error");
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/ceiling/);
  });

  it("notifyDeal called with contract §5 shape on close", async () => {
    let received: any = null;
    const b = makeParty();
    const s = makeParty();
    const r = new Room("r8", {}, (res) => (received = res));
    r.join("buyer", buyer(), b.send);
    r.join("seller", seller(), s.send);
    r.handle("buyer", co("buyer", 1, 20, 5, "a", 1));
    r.handle("seller", co("seller", 2, 19, 5, "b", 2));
    r.handle("buyer", accept("buyer", 3, 3));
    expect(received).toBeTruthy();
    expect(received.roomId).toBe("r8");
    expect(received.deal.buyer.agentId).toBe("1");
    expect(received.deal.seller.agentId).toBe("2");
    expect(received.deal.totalUsdc).toBe(95);
  });
});
