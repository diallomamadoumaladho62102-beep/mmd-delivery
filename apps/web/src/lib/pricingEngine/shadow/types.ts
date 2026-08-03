/**
 * Shadow compare ports — Phase 0.
 * When enabled later: compute both paths, log diffs, charge = legacy.
 */

export type ShadowCompareSide = {
  customerTotalCents: number;
  currency: string;
  lineCount: number;
  source: "legacy" | "engine";
};

export type ShadowCompareResult = {
  service: string;
  equal: boolean;
  diffCents: number;
  legacy: ShadowCompareSide;
  engine: ShadowCompareSide;
  at: string;
};

export interface IShadowComparer {
  compare(input: {
    service: string;
    legacy: ShadowCompareSide;
    engine: ShadowCompareSide;
  }): ShadowCompareResult;
}

export const defaultShadowComparer: IShadowComparer = {
  compare({ service, legacy, engine }) {
    const diffCents = engine.customerTotalCents - legacy.customerTotalCents;
    return {
      service,
      equal: diffCents === 0 && legacy.currency === engine.currency,
      diffCents,
      legacy,
      engine,
      at: new Date().toISOString(),
    };
  },
};
