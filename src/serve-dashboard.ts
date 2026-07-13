/**
 * GOAT Testnet3 — Finality dashboard server.
 *
 * Serves a single-page dashboard that visualises the REAL data we've produced:
 *   - Agents: read LIVE from the ERC-8004 Identity Registry (every agent your
 *     wallet owns on-chain) — verifiable, persistent.
 *   - Payments: real settlement txs we executed (stored in data/payments.json
 *     with the on-chain txHash as proof).
 *   - Ratings: the off-chain ERC-8004-compatible notebook (data/reputation.json),
 *     each entry carrying the real payment txHash.
 *
 * API:
 *   GET /api/state   -> { network, wallet, agents[], payments[], reputation{} }
 *   GET /            -> dashboard HTML
 *
 * Run: npm run goat:dashboard   (needs CHAIN_MODE=live + .env for on-chain reads)
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { buildLiveCtx, IDENTITY_REGISTRY, IDENTITY_ABI, EXPLORER, explorerAddr } from "../scripts/lib/live.ts";
import { loadPayments, loadReputation } from "../scripts/lib/data.ts";

const PUBLIC = new URL("../packages/orchestrator/public/", import.meta.url).pathname;
const PORT = Number(process.env.DASH_PORT ?? 4173);

async function getOnChainAgents(): Promise<any[]> {
  try {
    const ctx = buildLiveCtx();
    const topic0 = "0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a"; // AgentRegistered
    const ownerTopic = `0x000000000000000000000000${ctx.account.address.slice(2).toLowerCase()}`;
    const block = await ctx.pc.getBlockNumber();
    const fromBlock = block > 500_000n ? block - 500_000n : 0n;
    const logs = await ctx.pc.getLogs({
      address: IDENTITY_REGISTRY as `0x${string}`,
      topics: [topic0, null, ownerTopic] as any,
      fromBlock,
      toBlock: "latest",
    });
    const ownerLower = ctx.account.address.toLowerCase();
    const agents: any[] = [];
    for (const l of logs) {
      // Defensively verify the owner topic matches (some RPCs ignore topic filters).
      const t2 = (l.topics[2] ?? "").toLowerCase();
      if (t2 && t2 !== ownerTopic && t2 !== ownerLower) continue;
      const tokenId = BigInt(l.topics[1] as `0x${string}`);
      if (tokenId === 0n) continue; // skip malformed/mint-ish entries
      let wallet = "";
      try {
        wallet = await ctx.pc.readContract({
          address: IDENTITY_REGISTRY as `0x${string}`,
          abi: IDENTITY_ABI,
          functionName: "getAgentWallet",
          args: [tokenId],
        }) as string;
      } catch { /* wallet read optional */ }
      agents.push({
        agentId: tokenId.toString(),
        wallet,
        explorerUrl: `${EXPLORER}/token/${IDENTITY_REGISTRY}/${tokenId.toString()}`,
      });
    }
    return agents;
  } catch (e) {
    return [{ error: (e as Error).message }];
  }
}

async function getState() {
  const ctx = (() => {
    try { return buildLiveCtx(); } catch { return null; }
  })();
  const [agents, payments, reputation] = await Promise.all([
    getOnChainAgents(),
    loadPayments(),
    loadReputation(),
  ]);
  return {
    network: ctx?.cfg.network ?? "goat-testnet",
    chainId: ctx?.chain.id ?? 48816,
    wallet: ctx?.account.address ?? null,
    walletExplorer: ctx ? explorerAddr(ctx.account.address) : null,
    identityRegistry: IDENTITY_REGISTRY,
    agents,
    payments,
    reputation,
    generatedAt: new Date().toISOString(),
  };
}

const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    const url = (req.url ?? "/").split("?")[0];
    if (url === "/api/state") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(await getState(), null, 2));
      return;
    }
    let p = url === "/" ? "/dashboard.html" : url;
    const file = join(PUBLIC, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Finality dashboard at http://localhost:${PORT}/`);
  console.log(`(on-chain agents from GOAT Testnet3 Identity Registry + local payments/ratings notebook)`);
});
