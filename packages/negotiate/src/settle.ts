import { DealResult } from "./room.js";

// Best-effort delivery of a closed deal to Part 3 (contract §5).
// POST { roomId, transcriptHash, buyer, seller, unitPrice, qty, terms, totalUsdc }
// If Part 3 is not running, log + continue (never crash).

const DEALS_URL_DEFAULT = "http://localhost:3003/deals";

export async function notifyDeal(result: DealResult): Promise<void> {
  const DEALS_URL = process.env.DEALS_URL ?? DEALS_URL_DEFAULT;
  const body = {
    roomId: result.roomId,
    transcriptHash: result.transcriptHash,
    buyer: result.deal.buyer,
    seller: result.deal.seller,
    unitPrice: result.deal.unitPrice,
    qty: result.deal.qty,
    terms: result.deal.terms,
    totalUsdc: result.deal.totalUsdc,
  };
  try {
    const res = await fetch(DEALS_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[settle] Part 3 returned ${res.status} for ${result.roomId}; continuing`);
    } else {
      console.log(`[settle] notified Part 3 of deal ${result.roomId} (${result.transcriptHash})`);
    }
  } catch (err) {
    console.warn(`[settle] Part 3 unreachable at ${DEALS_URL} (${String(err)}); continuing`);
  }
}
