/**
 * Finality — merged system boot.
 *
 * Boots all three backend services IN-PROCESS (no ports conflict, single
 * process) so the whole Finality Agent Network runs from one command:
 *   - intake   (Part 1) :3001  HTTP  POST /intents,/offers  GET /matches/:id
 *   - negotiate(Part 2) :3002  WS    /negotiate/:roomId
 *   - chain    (Part 3) :3003  HTTP  POST /deals, GET /health
 *
 * The reference-agent (Part 4) is the client that drives an end-to-end deal.
 */
import { buildApp as buildIntake } from "../../intake/src/app.js";
import { startServer as startNegotiate } from "../../negotiate/src/index.js";
import { buildApp as buildChain } from "../../chain/src/app.js";
import type { FastifyInstance } from "fastify";
import type { WebSocketServer } from "ws";

export interface RunningSystem {
  intake: FastifyInstance;
  chain: FastifyInstance;
  negotiate: WebSocketServer;
  close: () => Promise<void>;
}

export async function startSystem(ports = { intake: 3001, negotiate: 3002, chain: 3003 }): Promise<RunningSystem> {
  const intake = await buildIntake();
  await intake.listen({ port: ports.intake, host: "0.0.0.0" });

  const chain = await buildChain();
  await chain.listen({ port: ports.chain, host: "0.0.0.0" });

  const negotiate = startNegotiate(ports.negotiate);

  return {
    intake,
    chain,
    negotiate,
    async close() {
      await intake.close();
      await chain.close();
      await new Promise<void>((r) => negotiate.close(() => r()));
    },
  };
}

// Allow running directly: `tsx src/start-all.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startSystem()
    .then((sys) => {
      console.log("[orchestrator] Finality system up:");
      console.log("  intake   http://localhost:3001");
      console.log("  negotiate ws://localhost:3002/negotiate/:roomId");
      console.log("  chain    http://localhost:3003");
      console.log("Press Ctrl+C to stop.");
      const stop = () => sys.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
