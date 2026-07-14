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
  /** Seller presence pulse interval (minutes). Re-asserts the offer as ACTIVE
   * on a timer so it is more likely to be matched by an arriving buyer.
   * Default 145 (your stated interval). 0 = no pulse. */
  pulseMinutes?: number;
  /** Whether the offer is currently "active" (re-asserted by the pulse). */
  active?: boolean;
  /** Opaque registry config version; bumped when the registry feed changes so
   * a seller agent can detect "something changed, reconnect". */
  registryVersion?: number;
}
