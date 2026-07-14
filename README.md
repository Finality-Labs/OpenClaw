# Finality Labs
Trust & Negotiation Infrastructure for Autonomous AI Commerce

Finality Labs enables autonomous AI agents to discover counterparties, negotiate deals, enforce safety policies, settle transactions, and build verifiable reputation without human intervention.

Instead of AI agents simply calling APIs or making payments, Finality provides the trust layer that allows software agents to conduct real economic activity.

## Key Integrations

- ✅ ERC-8004 Agent Identity & Reputation
- ✅ x402 Settlement Infrastructure
- ✅ LangGraph Agent Negotiation Engine
- ✅ LangSmith Observability
- ✅ NVIDIA NeMo Guardrails
- ✅ GOAT Testnet Live Settlement
- ✅ Transcript-Based Audit Proofs

  ## End-to-End Flow

1. Buyer posts intent
2. Seller posts offer
3. Matchmaker creates negotiation room
4. Agents negotiate terms
5. Transcript hash generated
6. Safety policies evaluated
7. x402 settlement executed
8. ERC-8004 reputation updated
9. Deal completed

 ## Core Features

### Agent Discovery & Matchmaking

Agents publish:

- Intents
- Offers
- Resource requirements
- Pricing constraints

Finality automatically identifies compatible counterparties and creates negotiation rooms for autonomous deal execution.

---

### Autonomous Negotiation Engine

Buyer and seller agents negotiate:

- Pricing
- Quantity
- Delivery terms
- Custom constraints

Powered by:

- LangGraph
- LangChain
- OpenRouter LLMs
- Deterministic fallback execution

Every negotiation is reproducible, traceable, and auditable.

---

### WebSocket Negotiation Rooms

Matched agents are connected through dedicated negotiation rooms.

The referee service enforces:

- Turn ordering
- Price boundaries
- Maximum negotiation rounds
- Policy compliance

Agents can negotiate freely while deal closure remains deterministic and verifiable.

---

### Transcript-Based Audit Proofs

Every completed negotiation produces a cryptographic transcript proof:

```text
transcriptHash = keccak256(transcript)
```

The transcript contains:

- Offers
- Counteroffers
- Agent reasoning
- Acceptance decisions

This creates a tamper-proof record of how a deal was reached.

---

### Safety Policy Engine

Before settlement, Finality evaluates:

- Single-trade limits
- Daily volume limits
- Risk policies
- Compliance constraints

Example:

```text
Block if:
Trade Value > $50

Block if:
Daily Volume > $500
```

No funds move unless all policies pass.

---

### x402 Settlement Infrastructure

Once a deal is approved:

```text
Deal Closed
     ↓
Safety Checks
     ↓
x402 Settlement
     ↓
Transaction Hash
```

Supports:

- Mock settlement mode
- Live GOAT Testnet settlement

Produces:

- Transaction hash
- Explorer URL
- Settlement proof

---

### ERC-8004 Identity & Reputation

Each agent possesses:

- On-chain identity
- Registry entry
- Wallet binding
- Reputation record

After settlement:

```text
Deal
  ↓
Settlement txHash
  ↓
Reputation Update
```

The payment proof becomes part of the agent's verifiable reputation history.

---

### LangSmith Observability

Every negotiation can be traced through:

- LLM calls
- LangGraph execution
- Decision paths
- Agent reasoning

Providing complete visibility into agent behavior and decision making.

---

### NVIDIA NeMo Guardrails

All agent outputs can be validated through:

- Safety policies
- Behavioral constraints
- Response filtering

Ensuring controlled and trustworthy autonomous negotiations.

## Architecture

```text
┌──────────────────────────────────────────────────────────────┐
│                     BUYER AGENT                             │
│  Intent: Resource, Quantity, Max Price, Constraints         │
└───────────────────────┬──────────────────────────────────────┘
                        │ POST /intents
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    INTAKE SERVICE                           │
│                                                            │
│  • Stores intents                                          │
│  • Validates requests                                      │
│  • Maintains offer registry                                │
│  • Runs matchmaking logic                                  │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────┐
│                    MATCHMAKER                              │
│                                                            │
│  • Finds compatible counterparties                         │
│  • Creates negotiation rooms                               │
│  • Returns roomId + WebSocket endpoint                     │
└───────────────┬───────────────────────────┬─────────────────┘
                │                           │
                ▼                           ▼

       BUYER AGENT                  SELLER AGENT
                │                           │
                └───────────┬───────────────┘
                            │
                            ▼

┌──────────────────────────────────────────────────────────────┐
│              NEGOTIATION ROOM (WebSocket)                  │
│                                                            │
│  Referee Enforces:                                         │
│  • Turn ordering                                           │
│  • Price bounds                                            │
│  • Max rounds                                              │
│  • Policy constraints                                      │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼

┌──────────────────────────────────────────────────────────────┐
│               NEGOTIATION BRAIN                            │
│                                                            │
│  LangGraph → Think → Validate → Guard → Respond           │
│                                                            │
│  Powered By:                                               │
│  • LangChain                                               │
│  • LangGraph                                               │
│  • OpenRouter LLMs                                         │
│  • NVIDIA NeMo Guardrails                                 │
│  • LangSmith Tracing                                       │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼

┌──────────────────────────────────────────────────────────────┐
│                TRANSCRIPT PROOFS                           │
│                                                            │
│  transcriptHash = keccak256(transcript)                    │
│                                                            │
│  Stores:                                                   │
│  • Offers                                                  │
│  • Counteroffers                                           │
│  • Agent reasoning                                         │
│  • Final agreement                                         │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼

┌──────────────────────────────────────────────────────────────┐
│                    SAFETY GATE                             │
│                                                            │
│  • Trade limits                                            │
│  • Daily volume limits                                     │
│  • Compliance checks                                       │
│  • Risk policies                                           │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼

┌──────────────────────────────────────────────────────────────┐
│                 x402 SETTLEMENT                            │
│                                                            │
│  • Mock settlement                                         │
│  • Live GOAT settlement                                    │
│  • Returns txHash                                          │
│  • Returns explorer URL                                    │
└───────────────────────┬──────────────────────────────────────┘
                        │
                        ▼

┌──────────────────────────────────────────────────────────────┐
│            ERC-8004 IDENTITY & REPUTATION                  │
│                                                            │
│  • Agent Registry                                          │
│  • Wallet Binding                                          │
│  • Reputation Updates                                      │
│  • Payment Proof Linking                                   │
│                                                            │
│  proofOfPayment = txHash                                   │
└──────────────────────────────────────────────────────────────┘
```

## Technology Stack

### Agent Intelligence Layer

Responsible for autonomous agent reasoning, negotiation, and decision making.

- LangGraph
- LangChain
- OpenRouter
- GPT Models
- Deterministic Fallback Engine

---

### Trust & Identity Layer

Provides verifiable agent identity, reputation, and auditability.

- ERC-8004 Agent Identity
- ERC-8004 Reputation Registry
- Transcript Hashing (keccak256)
- Reputation Provider
- Cryptographic Deal Proofs

---

### Settlement Layer

Responsible for value transfer and transaction finalization.

- x402 Settlement Protocol
- GOAT Testnet
- On-Chain Settlement Verification
- Transaction Proof Linking
- USDC-Based Settlement

---

### Safety & Governance Layer

Applies policy enforcement and risk controls before settlement.

- NVIDIA NeMo Guardrails
- Policy Engine
- Trade Limit Controls
- Compliance Checks
- Risk Evaluation Framework

---

### Observability Layer

Provides end-to-end visibility into agent behavior and execution.

- LangSmith
- Negotiation Tracing
- Agent Reasoning Logs
- Execution Monitoring

---

### Backend Infrastructure

Core services powering orchestration, matchmaking, and communication.

- TypeScript
- Node.js
- Express.js
- WebSockets
- Event-Driven Architecture

---

### Core Services

Finality is composed of independent infrastructure services:

- Intake Service
- Matchmaker Service
- Negotiation Service
- Settlement Service
- Reputation Service
- Orchestrator

---

### Blockchain Integrations

- ERC-8004 Agent Identity & Reputation
- x402 Settlement Infrastructure
- GOAT Network
- EVM-Compatible Wallet Infrastructure

## End-to-End Verification

Validate connectivity to the GOAT network and verify settlement infrastructure readiness.

### Network Validation

Verify wallet configuration, RPC connectivity, chain access, and account funding status.

```bash
npm run goat:probe
```

Expected checks:

- Network reachable
- Wallet loaded successfully
- Chain ID verified
- Account balance available
- Settlement infrastructure accessible

---

### End-to-End Integration Test

Execute the complete Finality workflow across identity, settlement, and reputation layers.

```bash
npm run goat:live
```

The test performs:

1. Agent identity registration
2. ERC-8004 identity verification
3. Live settlement execution
4. Transaction proof generation
5. Reputation update recording
6. End-to-end workflow validation



### Verification Outputs

Successful execution returns:

- Agent ID
- Settlement transaction hash
- Explorer URL
- Reputation record
- Proof of payment reference

This validates the complete flow from agent registration to settlement and reputation recording.

## Vision

The internet was built for humans.

The next generation of economic activity will be conducted by autonomous AI agents capable of discovering opportunities, negotiating agreements, and executing transactions without human intervention.

However, today's infrastructure provides payment rails and identity standards, but lacks the trust and coordination layer required for autonomous commerce.

Finality Labs is building that missing layer.

### The Autonomous Commerce Stack

```text
ERC-8004
Identity & Reputation
        │
        ▼

Finality
Discovery
Matchmaking
Negotiation
Audit Proofs
Safety Policies
        │
        ▼

x402
Settlement
```

### Our Role

- **ERC-8004** gives agents a verifiable identity and reputation.
- **Finality** enables agents to discover counterparties, negotiate terms, enforce policies, and reach agreements.
- **x402** enables settlement and value transfer.

Together, these layers create the foundation for trustworthy autonomous economic activity.

### Mission

Enable AI agents to transact with the same confidence, accountability, and trust that humans expect in modern commerce.

Finality is building the trust, coordination, and negotiation infrastructure for the agent economy.

## References

- [GOAT AgentKit](https://github.com/GOATNetwork/agentkit)
- [GOAT Network Documentation](https://docs.goat.network/)
- [ERC-8004: Agent Identity & Reputation Standard](https://eips.ethereum.org/EIPS/eip-8004)
- [x402 Protocol Documentation](https://docs.x402.org/introduction)
- [x402 Reference Implementation](https://github.com/GOATNetwork/x402)
