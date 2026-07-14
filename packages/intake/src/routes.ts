import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Store } from "./store";
import type { Matchmaker } from "./matchmaker";
import type { PulseService } from "./pulse";
import { verifyOrRegister } from "./identity";

// Wallet: must be a 0x-prefixed string. Real ERC-8004 wallets are hex
// (^0x[a-fA-F0-9]+$); placeholder/demo wallets (e.g. 0xBUYER) are allowed too.
const walletSchema = z.string().regex(/^0x[0-9a-zA-Z]+$/);

const identitySchema = z.object({
  agentRegistry: z.string().regex(/^eip155:/),
  agentId: z.string(),
  wallet: walletSchema,
});

const intentSchema = z.object({
  resource: z.string(),
  qty: z.number().min(0),
  unit: z.string(),
  maxUnitPrice: z.number().min(0),
  requirements: z.record(z.unknown()).optional().default({}),
  agentRegistry: z.string().regex(/^eip155:/),
  agentId: z.string(),
  wallet: walletSchema,
});

const offerSchema = z.object({
  resource: z.string(),
  unit: z.string(),
  unitPrice: z.number().min(0),
  terms: z.string(),
  requirements: z.record(z.unknown()).optional().default({}),
  agentRegistry: z.string().regex(/^eip155:/),
  agentId: z.string(),
  wallet: walletSchema,
  pulseMinutes: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

export function registerRoutes(app: FastifyInstance, store: Store, matchmaker: Matchmaker, pulse: PulseService) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/intents", async (req, reply) => {
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const id = store.addIntent(parsed.data as any);
    const match = matchmaker.onIntent(id);
    return reply.code(201).send({ intentId: id, ...match });
  });

  app.post("/offers", async (req, reply) => {
    const parsed = offerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const id = store.addOffer(parsed.data as any);
    pulse.register(id, (parsed.data as any).pulseMinutes);
    const match = matchmaker.onOffer(id);
    return reply.code(201).send({ offerId: id, ...match });
  });

  app.get<{ Params: { id: string } }>("/matches/:id", async (req, reply) => {
    const m = matchmaker.lookup(req.params.id);
    if (!m.matched) return reply.code(200).send({ matched: false });
    return reply.code(200).send(m);
  });

  app.get<{ Params: { agentId: string } }>("/agents/:agentId/reputation", async (req) => {
    // Placeholder reputation read (Part 3 owns real ERC-8004 getSummary).
    return { agentId: req.params.agentId, count: 0, summaryValue: 0, summaryValueDecimals: 0 };
  });

  // Identity verification seam (exposed for testing; routes also use verifyOrRegister internally).
  app.post("/_identity", async (req) => {
    const parsed = identitySchema.safeParse(req.body);
    if (!parsed.success) return { ok: false, registered: false };
    return verifyOrRegister(parsed.data as any);
  });

  // ── Offer pulse + registry-feed seams (negotiation §1 presence layer) ──

  // Manual pulse: re-assert an offer as ACTIVE and immediately try to match.
  // A seller agent calls this on its own pulse timer (or the server PulseService
  // does it automatically). Returns the match state.
  app.post<{ Params: { id: string } }>("/offers/:id/pulse", async (req, reply) => {
    const ok = store.pulseOffer(req.params.id);
    if (!ok) return reply.code(404).send({ error: "offer not found" });
    const match = matchmaker.onOffer(req.params.id);
    return reply.code(200).send({ pulsed: true, active: true, ...match });
  });

  // Registry feed view for a seller: what the registry currently says about the
  // offer + its registryVersion. A seller agent polls this; when registryVersion
  // changes, it reconnects to the negotiation room.
  app.get<{ Params: { id: string } }>("/offers/:id/registry", async (req, reply) => {
    const state = store.getOfferRegistryState(req.params.id);
    if (!state) return reply.code(404).send({ error: "offer not found" });
    return { offerId: req.params.id, ...state };
  });

  // Registry change notification (simulates "a change happened in the registry
  // during the pulse"): bumps the seller's offers' registryVersion so watching
  // seller agents wake up and reconnect. Real ERC-8004/on-chain events would
  // call this.
  app.post<{ Params: { agentId: string } }>("/registry/:agentId/notify", async (req, reply) => {
    const changed = store.bumpRegistry(req.params.agentId);
    return reply.code(200).send({ notified: true, changed });
  });

  // Read the registry feed state for an agent (seller polling endpoint).
  app.get<{ Params: { agentId: string } }>("/registry/:agentId", async (req) => {
    const offers = [...store.offers.values()]
      .filter((o) => o.agentId === req.params.agentId)
      .map((o) => ({ active: !!o.active, registryVersion: o.registryVersion ?? 1, offer: o }));
    return { agentId: req.params.agentId, offers };
  });
}
