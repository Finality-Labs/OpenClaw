/**
 * Guardrail client — wraps the NeMo sidecar with a safe passthrough fallback.
 *
 * If FIMALITY_GUARDRAILS is set and the sidecar responds, we honor its verdict.
 * Otherwise (sidecar down / disabled) we return `allowed: true` so the
 * negotiation never deadlocks on a missing guardrail process. The deterministic
 * room-side bounds (packages/negotiate) remain the hard guarantee regardless.
 */

export interface GuardVerdict {
  allowed: boolean;
  reason: string;
}

const GUARD_URL = process.env.GUARDRAILS_URL ?? "http://localhost:5050/guard";

export async function guardDecision(
  text: string,
  role: "buyer" | "seller",
  opts: { bound?: number; timeoutMs?: number } = {},
): Promise<GuardVerdict> {
  if (process.env.FIMALITY_GUARDRAILS !== "1") {
    return { allowed: true, reason: "guardrails disabled" };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 1500);
  try {
    const res = await fetch(GUARD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, role, bound: opts.bound }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { allowed: true, reason: `sidecar ${res.status} → passthrough` };
    const j = (await res.json()) as GuardVerdict;
    return j;
  } catch {
    // Sidecar unreachable → never block the deal on it.
    return { allowed: true, reason: "sidecar unreachable → passthrough" };
  } finally {
    clearTimeout(t);
  }
}
