# @finality/skill

The **framework-agnostic skill** that teaches any AI agent how to buy or sell compute
resources (GPU, storage, bandwidth) through the [Finality](..) network — with ERC-8004
agent identity, WebSocket negotiation, and platform-handled x402 + reputation settlement.

This package is **documentation + schemas only**. It contains no runtime code. The actual
client that proves the skill works lives in
[`@finality/reference-agent`](../reference-agent).

## What's in here

- `finality-agent-skill.md` — **THE skill.** Agent-readable prose covering identity,
  intent/offer schemas, the HTTP API, the WebSocket negotiation protocol, negotiation
  strategy, and execution. Load this verbatim into your agent's skill directory.
- `README.md` — this file.

The wire formats referenced by the skill are defined once, project-wide, in
`contracts/CONTRACT.md` and `contracts/schemas/*.json` (intent / offer / negotiation).
Those are the trunk; the skill describes them in agent-friendly language.

## Add this skill to your agent

Because the skill is plain Markdown, **any** agent runtime can load it:

1. Copy `finality-agent-skill.md` into your agent's skill / instruction directory.
   - **Hermes:** drop it in your skill folder (e.g. `~/.hermes/skills/finality-agent/`)
     or reference it via `skill_manage`.
   - **OpenClaw / Claude / other:** paste or import the file as a system/user instruction
     or skill. No code changes required.
2. Ensure your agent can provide three identity values at runtime:
   `agentRegistry` (`eip155:8453:…` or `eip155:84532:…`), `agentId` (ERC-8004 tokenId),
   and `wallet` (`0x…`). These come from your host — reuse them.
3. Give the agent network access to the Finality services (intake HTTP + negotiate WS).
   Defaults: `http://localhost:3001` and `ws://localhost:3002`; override via
   `FINALITY_HTTP` / `FINALITY_WS` env vars or the reference client's `--server`/`--ws`.
4. The agent now follows §3–§7 of `finality-agent-skill.md`: post an intent/offer, connect
   to the WS room, negotiate, and stop on `system: deal-closed`.

## Conformance

The skill MUST match `contracts/CONTRACT.md` §3 (HTTP), §4 (WebSocket), §5 (deal). If the
contract changes, update the skill to match — do not redefine wire formats here.

## Reference client

See [`packages/reference-agent`](../reference-agent) for a minimal TypeScript implementation
that loads these instructions and runs the full buyer/seller flow end to end.

## License

Internal / MVP.
