/**
 * Official Pricing Engine contracts (ADR-001 Final).
 * Engines may communicate only through these types — never internal structs.
 */

export type PricingService = "ride" | "food" | "package" | "marketplace";

export type MoneyLineType =
  | "rate"
  | "tax"
  | "fee"
  | "discount"
  | "policy"
  | "earning";

export type MoneyParty =
  | "customer"
  | "driver"
  | "restaurant"
  | "seller"
  | "platform"
  | "partner";

export type IMoneyLine = {
  lineType: MoneyLineType;
  code: string;
  label?: string;
  amountCents: number;
  party: MoneyParty;
  meta?: Record<string, unknown>;
};

export type IQuoteContext = {
  service: PricingService;
  country: string;
  currency: string;
  zone?: string;
  distance?: number;
  distanceUnit?: "mile" | "km";
  durationMinutes?: number;
  vehicleClass?: string;
  cart?: Record<string, unknown>;
  actors?: Record<string, unknown>;
  promoCodes?: string[];
  eventTags?: string[];
  mode?: "live" | "simulation" | "shadow";
};

export type IRateCardRef = {
  rateCardId: string;
  version: string;
  code: string;
};

export type IRateResult = {
  baseAmountCents: number;
  lines: IMoneyLine[];
  rateCardRef: IRateCardRef;
};

export type ITaxResult = {
  taxTotalCents: number;
  lines: IMoneyLine[];
};

export type IFeeResult = {
  feeTotalCents: number;
  lines: IMoneyLine[];
};

export type IFundingSplit = {
  mmdCents: number;
  partnerCents: number;
  meta?: Record<string, unknown>;
};

export type IPromotionResult = {
  discountTotalCents: number;
  lines: IMoneyLine[];
  funding: IFundingSplit[];
};

export type IPolicyResult = {
  lines: IMoneyLine[];
};

export type ICommissionResult = {
  earningLines: IMoneyLine[];
  platformCents: number;
};

export type IValidationViolation = {
  code: string;
  message: string;
  path?: string;
};

export type IValidationResult = {
  ok: boolean;
  violations: IValidationViolation[];
};

export type IQuoteSnapshot = {
  snapshotId: string;
  pricingVersion: string;
  algorithmSemver: string;
  service: PricingService;
  country: string;
  currency: string;
  customerTotalCents: number;
  rateCardRef: IRateCardRef;
  ruleSetHash: string;
  lines: IMoneyLine[];
  context: IQuoteContext;
  createdAt: string;
};

export type IExplanationNode = {
  code: string;
  label: string;
  amountCents?: number;
  children?: IExplanationNode[];
};

export type IExplanationTree = {
  snapshotId?: string;
  title: string;
  root: IExplanationNode;
  customerTotalCents: number;
};

export type IAuditChange = {
  actorUserId: string;
  entityType: string;
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  pricingVersion?: string;
};

export type ITransferPlan = {
  transfers: Array<{
    party: MoneyParty;
    amountCents: number;
    destinationRef: string;
    idempotencyKey: string;
  }>;
};

/** Port interfaces — implementations come in later phases. */

export interface IRateEngine {
  compute(ctx: IQuoteContext, rateCard: IRateCardRef): Promise<IRateResult>;
}

export interface ITaxEngine {
  compute(ctx: IQuoteContext, rate: IRateResult): Promise<ITaxResult>;
}

export interface IFeeEngine {
  compute(
    ctx: IQuoteContext,
    rate: IRateResult,
    tax?: ITaxResult
  ): Promise<IFeeResult>;
}

export interface IPromotionEngine {
  apply(
    ctx: IQuoteContext,
    bundle: {
      rate: IRateResult;
      tax: ITaxResult;
      fee: IFeeResult;
    }
  ): Promise<IPromotionResult>;
}

export interface IPolicyEngine {
  apply(
    ctx: IQuoteContext,
    bundle: {
      rate: IRateResult;
      tax: ITaxResult;
      fee: IFeeResult;
      promotion: IPromotionResult;
    }
  ): Promise<IPolicyResult>;
}

export interface ICommissionEngine {
  split(
    ctx: IQuoteContext,
    bundle: {
      customerTotalCents: number;
      lines: IMoneyLine[];
    }
  ): Promise<ICommissionResult>;
}

export interface IValidationEngine {
  validate(bundle: {
    customerTotalCents: number;
    lines: IMoneyLine[];
    currency: string;
    commission: ICommissionResult;
  }): Promise<IValidationResult>;
}

export interface ISnapshotStore {
  commit(input: Omit<IQuoteSnapshot, "snapshotId" | "createdAt"> & {
    snapshotId?: string;
  }): Promise<IQuoteSnapshot>;
}

export interface ISettlementEngine {
  settle(
    snapshotId: string,
    paymentEvent: Record<string, unknown>
  ): Promise<ITransferPlan>;
}

export interface IExplainEngine {
  explain(
    input: { snapshotId: string } | { dryRun: IQuoteSnapshot }
  ): Promise<IExplanationTree>;
}

export interface IAuditEngine {
  record(change: IAuditChange): Promise<void>;
}

export interface IPricingSimulator {
  run(scenario: Record<string, unknown>): Promise<{
    dryRun: IQuoteSnapshot;
    explanation?: IExplanationTree;
  }>;
}

export interface IPricingEngineFacade {
  quote(ctx: IQuoteContext): Promise<IQuoteSnapshot>;
  simulate(scenario: Record<string, unknown>): Promise<{
    dryRun: IQuoteSnapshot;
    explanation?: IExplanationTree;
  }>;
  explain(snapshotId: string): Promise<IExplanationTree>;
}
