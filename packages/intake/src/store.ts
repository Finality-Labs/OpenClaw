import type { Intent, Offer } from "./types";

export interface Room {
  roomId: string;
  intentId: string;
  offerId: string;
  status: "open";
}

let counter = 0;
const nextId = (p: string) => `${p}_${(++counter).toString(36)}_${Date.now().toString(36)}`;

export class Store {
  intents = new Map<string, Intent>();
  offers = new Map<string, Offer>();
  rooms = new Map<string, Room>();

  addIntent(i: Intent): string {
    const id = nextId("intent");
    this.intents.set(id, i);
    return id;
  }
  addOffer(o: Offer): string {
    const id = nextId("offer");
    this.offers.set(id, o);
    return id;
  }
  createRoom(intentId: string, offerId: string): Room {
    const room: Room = { roomId: nextId("room"), intentId, offerId, status: "open" };
    this.rooms.set(room.roomId, room);
    return room;
  }
  getIntent(id: string) {
    return this.intents.get(id);
  }
  getOffer(id: string) {
    return this.offers.get(id);
  }
  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }
  findRoomByIntent(intentId: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.intentId === intentId) return r;
    return undefined;
  }
  findRoomByOffer(offerId: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.offerId === offerId) return r;
    return undefined;
  }
  findMatchForIntent(intent: Intent): { offerId: string; offer: Offer } | undefined {
    for (const [offerId, offer] of this.offers) if (matches(intent, offer)) return { offerId, offer };
    return undefined;
  }
  findMatchForOffer(offer: Offer): { intentId: string; intent: Intent } | undefined {
    for (const [intentId, intent] of this.intents) if (matches(intent, offer)) return { intentId, intent };
    return undefined;
  }
}

// Match rule (contract §2): resource equal, unit equal, offer.unitPrice <= intent.maxUnitPrice,
// and intent.requirements is a subset of offer.requirements (same key+value).
export function matches(intent: Intent, offer: Offer): boolean {
  if (intent.resource !== offer.resource) return false;
  if (intent.unit !== offer.unit) return false;
  if (offer.unitPrice > intent.maxUnitPrice) return false;
  for (const [k, v] of Object.entries(intent.requirements || {})) {
    if (!(k in (offer.requirements || {}))) return false;
    if ((offer.requirements as Record<string, unknown>)[k] !== v) return false;
  }
  return true;
}
