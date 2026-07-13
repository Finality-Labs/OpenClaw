/**
 * Tiny append/persist helpers for the dashboard's local data files.
 *
 * These are the OFF-CHAIN "notebook" records (reputation + payments) that the
 * dashboard visualises. They are real: each entry carries the actual on-chain
 * txHash as its proof, so the data is verifiable even though the reputation
 * write itself is currently off-chain (GOAT Testnet3 Reputation Registry is a
 * placeholder). When the on-chain registry goes live, these same shapes map
 * 1:1 onto ERC-8004 reads.
 *
 * Files live under <repo>/data/ (gitignored — they contain run-specific state,
 * not source). All writes are best-effort and never throw into the caller.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const p = join(DATA_DIR, file);
    if (!existsSync(p)) return fallback;
    const raw = await readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(join(DATA_DIR, file), JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn(`[data] persist ${file} failed:`, (e as Error).message);
  }
}

// ── Reputation notebook ──
export interface StoredFeedback {
  agentId: string;
  value: number;
  decimals: number;
  tag1: string;
  tag2: string;
  endpoint: string;
  feedbackHash: string;
  proofTxHash: string;
  ts: number;
}

export async function loadReputation(): Promise<Record<string, StoredFeedback[]>> {
  return readJson("reputation.json", {});
}

export async function appendReputation(fb: StoredFeedback): Promise<void> {
  const all = await loadReputation();
  const list = all[fb.agentId] ?? [];
  list.push(fb);
  all[fb.agentId] = list;
  await writeJson("reputation.json", all);
}

// ── Payments notebook ──
export interface StoredPayment {
  agentId: string;
  txHash: string;
  amountGoat: string;
  from: string;
  to: string;
  ts: number;
  explorerUrl: string;
}

export async function loadPayments(): Promise<StoredPayment[]> {
  return readJson("payments.json", []);
}

export async function appendPayment(p: StoredPayment): Promise<void> {
  const all = await loadPayments();
  all.push(p);
  await writeJson("payments.json", all);
}
