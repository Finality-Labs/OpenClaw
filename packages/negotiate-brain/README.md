# @finality/negotiate-brain

The autonomous "haggling brain" for Finality negotiation rooms. It replaces the
mechanical midpoint split with an LLM-driven agent that reasons about price,
terms, and counterparty reputation — while staying **reproducible** for audit.

## Stack

- **LangChain.js** (`@langchain/core`, `@langchain/openai`) — LLM client +
  structured (zod) output so every decision is a validated object.
- **LangGraph.js** (`@langchain/langgraph`) — the negotiation turn is a graph:
  `think → validate → guard → END`. Each WebSocket turn is one graph invocation,
  which keeps LangSmith traces clean and avoids recursion limits.
- **LangSmith** — set `LANGCHAIN_TRACING_V2=true` + `LANGCHAIN_API_KEY` to trace
  every LLM call and graph step.
- **NVIDIA NeMo Guardrails** (Python sidecar) — semantic + safety guardrails on
  each emitted decision. Runs as `guardrails/sidecar.py`, called over HTTP; the
  TS `guardDecision()` client honors it when `FIMALITY_GUARDRAILS=1`, otherwise
  passes through (the deterministic room-side bounds remain the hard guarantee).

## Deterministic by design

Given the same inputs + same `seed`, the brain returns the same decision. When
no LLM key is configured, a seeded fallback policy runs (reputation + persona
biased concession). The end-to-end test asserts the **same deal + same
transcript hash** across runs.

## Negotiation §1 presence: offer pulse + registry feed

A seller offer can include `pulseMinutes` (default 145). The intake `PulseService`
re-asserts it ACTIVE and re-runs the matchmaker on that cadence; a seller agent
polls `GET /offers/:id/registry` and watches `registryVersion` — when it changes,
the seller reconnects to the room and resumes negotiating. Full spec in
`packages/skill/finality-agent-skill.md` §11.

## Env

```
OPENROUTER_API_KEY / OPENAI_API_KEY   LLM key (absent → deterministic fallback)
OPENROUTER_BASE_URL                   default https://openrouter.ai/api/v1
NEGOTIATE_MODEL                       e.g. openai/gpt-4o-mini
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=...                 LangSmith project key
FIMALITY_GUARDRAILS=1                 enable NeMo sidecar calls
GUARDRAILS_URL=http://localhost:5050/guard
PULSE_ENABLED=1                       server-side automatic offer pulse
DEFAULT_PULSE_MINUTES=145
```

## Run

```bash
npm install
npm run build --workspace=@finality/negotiate-brain
npm test   --workspace=@finality/negotiate-brain   # 8 tests incl. e2e deal

# NeMo sidecar (optional)
pip3 install nemoguardrails
FIMALITY_GUARDRAILS=1 python3 packages/negotiate-brain/guardrails/sidecar.py
```

## Layout

- `src/brain.ts`     — LLM/structured brain + seeded deterministic fallback
- `src/flow.ts`      — LangGraph turn (think → validate → guard)
- `src/agent.ts`     — WebSocket client that plays the role via the brain
- `src/guard.ts`     — NeMo sidecar client (passthrough when disabled)
- `guardrails/sidecar.py` — NeMo Guardrails HTTP server
- `src/tests/`       — unit + e2e (real negotiate Room) tests
