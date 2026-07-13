export interface Intent {
  resource: string;
  qty: number;
  unit: string;
  maxUnitPrice: number;
  requirements: Record<string, unknown>;
  agentRegistry: string;
  agentId: string;
  wallet: string;
}

export interface Offer {
  resource: string;
  unit: string;
  unitPrice: number;
  terms: string;
  requirements: Record<string, unknown>;
  agentRegistry: string;
  agentId: string;
  wallet: string;
}
