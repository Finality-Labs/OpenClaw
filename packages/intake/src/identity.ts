export interface AgentIdentity {
  agentRegistry: string;
  agentId: string;
  wallet: string;
}

// Local verify/register. Returns ok; `registered` reflects whether an on-chain
// registration was performed (false here — see TODO).
//
// TODO (real ERC-8004, MVP4): call IdentityRegistry.register(agentURI) on Base:
//   mainnet 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432
//   sepolia 0x8004A818BFB912233c491871b3d84c89A494BD9e
// then setAgentURI(agentId, <registration-file-url>) and setAgentWallet(...) with EIP-712.
export function verifyOrRegister(agent: AgentIdentity): { ok: boolean; registered: boolean } {
  if (!agent.agentRegistry.startsWith("eip155:")) return { ok: false, registered: false };
  // Real ERC-8004 wallets are hex (^0x[a-fA-F0-9]+$); placeholder wallets (0xBUYER) allowed.
  if (!/^0x[0-9a-zA-Z]+$/.test(agent.wallet)) return { ok: false, registered: false };
  // TODO: real ERC-8004 on-chain registration (seam above).
  return { ok: true, registered: false };
}
