/**
 * Shared FlatList tuning for Marketplace / Seller lists.
 * Keep values conservative for mid-range Android devices.
 */
export const MARKETPLACE_LIST_PERF = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 8,
  windowSize: 7,
  updateCellsBatchingPeriod: 50,
  removeClippedSubviews: true,
} as const;
