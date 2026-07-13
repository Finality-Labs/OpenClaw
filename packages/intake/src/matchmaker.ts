import type { Store } from "./store";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3002";

export class Matchmaker {
  constructor(private store: Store) {}

  // Called after an intent is added. If a compatible offer exists, open a room.
  onIntent(intentId: string): { matched: boolean; roomId?: string; wssUrl?: string } {
    const intent = this.store.getIntent(intentId);
    if (!intent) return { matched: false };
    const hit = this.store.findMatchForIntent(intent);
    if (!hit) return { matched: false };
    const room = this.store.createRoom(intentId, hit.offerId);
    return { matched: true, roomId: room.roomId, wssUrl: `${WS_URL}/negotiate/${room.roomId}` };
  }

  // Called after an offer is added. If a compatible intent exists, open a room.
  onOffer(offerId: string): { matched: boolean; roomId?: string; wssUrl?: string } {
    const offer = this.store.getOffer(offerId);
    if (!offer) return { matched: false };
    const hit = this.store.findMatchForOffer(offer);
    if (!hit) return { matched: false };
    const room = this.store.createRoom(hit.intentId, offerId);
    return { matched: true, roomId: room.roomId, wssUrl: `${WS_URL}/negotiate/${room.roomId}` };
  }

  // Lookup an existing match for an intent or offer id.
  lookup(id: string): { matched: boolean; roomId?: string; wssUrl?: string } {
    const room = this.store.findRoomByIntent(id) ?? this.store.findRoomByOffer(id);
    if (!room) return { matched: false };
    return { matched: true, roomId: room.roomId, wssUrl: `${WS_URL}/negotiate/${room.roomId}` };
  }
}
