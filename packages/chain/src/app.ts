/**
 * Fastify app factory for Part 3 — exported so tests can build it without
 * binding a port. Builds the full service: /health, /deals.
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { registerDealsRoutes } from './deals.js';
import type { SafetyPolicy } from './safety.js';

export interface BuildAppOptions {
  policy?: SafetyPolicy;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors);

  app.get('/health', async () => ({ ok: true }));

  registerDealsRoutes(app, opts);

  return app;
}
