/** Default Delivery Request driver search / dispatch radius (miles). */
export const DELIVERY_REQUEST_MAX_DISPATCH_MILES = 15;

export const DELIVERY_REQUEST_DISPATCH_WAVES: Record<
  number,
  { maxDrivers: number; maxMiles: number }
> = {
  1: { maxDrivers: 3, maxMiles: DELIVERY_REQUEST_MAX_DISPATCH_MILES },
  2: { maxDrivers: 6, maxMiles: DELIVERY_REQUEST_MAX_DISPATCH_MILES },
  3: { maxDrivers: 10, maxMiles: DELIVERY_REQUEST_MAX_DISPATCH_MILES },
};
