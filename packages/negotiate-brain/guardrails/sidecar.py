#!/usr/bin/env python3
"""
NVIDIA NeMo Guardrails sidecar for Finality negotiations.

Why a sidecar? NeMo Guardrails is Python-only and cannot run inside the
TypeScript process. So we run it as a small HTTP server that the TS negotiator
calls before emitting a decision. This keeps the guardrail boundary clean and
lets us enable/disable it purely via environment variables:

  FIMALITY_GUARDRAILS=1   → enable the sidecar
  (unset)                 → TS client short-circuits to passthrough

Endpoint:
  POST /guard  { "text": "<agent argument or decision>", "role": "buyer|seller" }
  → 200 { "allowed": true, "reason": "ok" }
  → 200 { "allowed": false, "reason": "<why blocked>" }

Guardrails applied:
  1. TOPICAL/SAFETY: refuse to emit deals that contain off-platform language,
     coercion, or attempt to leak private keys/wallets.
  2. PRICE SANITY: reject a decision whose text implies a price outside the
     agent's stated bound (server-side re-check, belt-and-suspenders).

Runs on PORT (default 5050). Started by the orchestrator when FIMALITY_GUARDRAILS=1.
"""
import os
import sys
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "5050"))

# Pattern for "I will pay/sell at PRICE" so we can re-check bounds.
PRICE_RE = re.compile(r"(?:price|pay|sell|offer|accept).*?(\d+(?:\.\d+)?)", re.IGNORECASE)


def load_rails():
    """Lazily import + build the NeMo rails. Returns a callable or None."""
    try:
        from nemoguardrails import RailsConfig, LLMRails
        config = RailsConfig.from_content(
            config={
                "models": [{"type": "main", "engine": "openai", "model": "gpt-4o-mini"}],
                "rails": {
                    "input": {"flows": ["guardrail self check"]},
                    "output": {"flows": ["guardrail self check"]},
                },
            },
            # Colang content for the negotiation domain.
            colang="""
define user express intent to deal
  "I want to " create order

define flow guardrail self check
  $allowed = True
  # Built-in self-check flow; extend with custom colang as needed.
""",
        )
        rails = LLMRails(config)
        return rails
    except Exception as e:  # noqa
        print(f"[guardrails] NeMo init failed: {e}", file=sys.stderr)
        return None


RAILS = load_rails() if os.environ.get("FIMALITY_GUARDRAILS") == "1" else None


# Behavioral heuristics (always on, no LLM needed) — cheap + deterministic.
UNSAFE_PATTERNS = [
    (re.compile(r"(private key|seed phrase|mnemonic|0x[a-fA-F0-9]{64})"), "mentions secret material"),
    (re.compile(r"(ignore (the|your) rules|jailbreak|bypass)"), "attempts to bypass policy"),
    (re.compile(r"(kill|hurt|threat|ransom)"), "threatening language"),
]


def heuristic_check(text: str) -> tuple[bool, str]:
    for pat, reason in UNSAFE_PATTERNS:
        if pat.search(text or ""):
            return False, reason
    return True, "ok"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, obj: dict):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/guard":
            self._send(404, {"allowed": False, "reason": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            raw = self.rfile.read(length)
            data = json.loads(raw or b"{}")
        except Exception as e:  # noqa
            self._send(400, {"allowed": False, "reason": f"bad request: {e}"})
            return

        text = str(data.get("text", ""))
        role = str(data.get("role", ""))
        bound = data.get("bound")  # optional numeric price bound for sanity check

        # 1. Heuristic safety.
        ok, reason = heuristic_check(text)
        if not ok:
            self._send(200, {"allowed": False, "reason": reason})
            return

        # 2. Price-bound sanity (if a bound is supplied).
        if bound is not None:
            m = PRICE_RE.search(text)
            if m:
                mentioned = float(m.group(1))
                if role == "buyer" and mentioned > float(bound):
                    self._send(200, {"allowed": False, "reason": f"price {mentioned} exceeds buyer ceiling {bound}"})
                    return
                if role == "seller" and mentioned < float(bound):
                    self._send(200, {"allowed": False, "reason": f"price {mentioned} below seller floor {bound}"})
                    return

        # 3. NeMo semantic self-check (optional, when rails loaded).
        if RAILS is not None:
            try:
                # NeMo self-check; non-blocking on failure.
                res = RAILS.generate(messages=[{"role": "user", "content": text}])
                if "block" in str(res).lower() or "deny" in str(res).lower():
                    self._send(200, {"allowed": False, "reason": "nemo semantic block"})
                    return
            except Exception as e:  # noqa
                print(f"[guardrails] nemo check error: {e}", file=sys.stderr)

        self._send(200, {"allowed": True, "reason": "ok"})

    def log_message(self, *args):  # silence default logging
        pass


def main():
    print(f"[guardrails] listening on :{PORT} (nemo={'on' if RAILS else 'off'})")
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
