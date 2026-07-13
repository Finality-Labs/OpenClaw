import { z } from "zod";

// ── Envelope (contract §4) ────────────────────────────────────────────────
// { "type": "counteroffer" | "accept" | "reject" | "close" | "system",
//   "from": "buyer" | "seller", "round": 1, "payload": { ... }, "ts": ... }

export const Role = z.enum(["buyer", "seller"]);
export type Role = z.infer<typeof Role>;

export const MessageType = z.enum(["counteroffer", "accept", "reject", "close", "system"]);
export type MessageType = z.infer<typeof MessageType>;

// Counteroffer / accept payload shape (contract §4 + §5).
export const TermsSchema = z.object({
  unitPrice: z.number(),
  qty: z.number(),
  terms: z.string(),
  requirements: z.record(z.unknown()).optional(),
});
export type Terms = z.infer<typeof TermsSchema>;

// Full wire envelope (mirrors negotiation.json schema). `payload` is loosely typed
// here and narrowed by the Room per message type.
export const EnvelopeSchema = z.object({
  type: MessageType,
  from: Role,
  round: z.number().int().min(1),
  payload: z.record(z.unknown()).optional(),
  ts: z.number().optional(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;

// Server-emitted `system` envelopes (never sent by clients).
export type SystemEnvelope =
  | { type: "system"; kind: "error"; message: string; ts: number }
  | { type: "system"; kind: "deal-closed"; deal: ClosedDeal; transcriptHash: string; ts: number }
  | { type: "system"; kind: "constraint-hit"; lastTerms: Terms | null; reason: string; ts: number }
  | { type: "system"; kind: "info"; message: string; ts: number };

// Deal object delivered to Part 3 (contract §5).
export interface ClosedDeal {
  buyer: { agentRegistry: string; agentId: string; wallet: string };
  seller: { agentRegistry: string; agentId: string; wallet: string };
  unitPrice: number;
  qty: number;
  terms: string;
  totalUsdc: number;
}

// Negotiation policy (contract §4 "Server-enforced constraints").
export interface NegotiationConfig {
  maxRounds: number; // default 10
  minDelta: number; // default 0.01
}

export const DEFAULT_CONFIG: NegotiationConfig = {
  maxRounds: 10,
  minDelta: 0.01,
};

// Parse + structurally validate an incoming client frame. Returns the typed
// envelope or a zod error. `system` frames from clients are rejected by the
// server higher up (clients must not emit system).
export function parseEnvelope(raw: unknown): { ok: true; value: Envelope } | { ok: false; error: z.ZodError } {
  const result = EnvelopeSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error };
}
