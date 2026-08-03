/**
 * Migration phase gate.
 * Phase 6: Legacy cleanup — PE is the sole calculation engine.
 */
export const PRICING_ENGINE_MIGRATION_PHASE = 6 as const;

export type PricingEngineMigrationPhase =
  | 0 // Freeze
  | 1 // Configuration
  | 2 // Parallel / shadow
  | 3 // Food & Package
  | 4 // Ride
  | 5 // Marketplace
  | 6; // Cleanup
