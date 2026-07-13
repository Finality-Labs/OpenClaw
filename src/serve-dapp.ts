/**
 * Static file server for the GOAT Testnet3 MetaMask dapp.
 * Run: npm run goat:dapp   -> serves packages/orchestrator/public/goat-wallet.html
 * Open the printed URL in a browser with MetaMask installed.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../packages/orchestrator/public/", import.meta.url).pathname;
const PORT = Number(process.env.DAPP_PORT ?? 5173);
const TYPES: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
};

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (p === "/") p = "/goat-wallet.html";
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ""));
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`GOAT Testnet3 dapp at http://localhost:${PORT}/`);
  console.log(`Open it in a browser with MetaMask. Wallet key is NOT needed server-side.`);
});
