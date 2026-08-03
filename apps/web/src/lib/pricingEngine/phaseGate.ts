/**
 * Migration phase gate. Increment only when a phase is human-validated to start.
 * Phase 5: Marketplace cutover / unification.
 */
export const PRICING_ENGINE_MIGRATION_PHASE = 5 as const;

export type PricingEngineMigrationPhase =
  | 0 // Freeze
  | 1 // Configuration
  | 2 // Parallel / shadow
  | 3 // Food & Package
  | 4 // Ride
  | 5 // Marketplace
  | 6; // Cleanup
