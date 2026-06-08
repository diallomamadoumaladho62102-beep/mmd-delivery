export type TaxiRpcResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export function mapTaxiRpcError(errorCode: string): {
  status: number;
  message: string;
} {
  switch (errorCode) {
    case "not_authenticated":
      return { status: 401, message: "Unauthorized" };
    case "driver_not_eligible":
      return { status: 403, message: "Driver is not eligible for taxi rides" };
    case "offer_not_found":
    case "ride_not_found":
      return { status: 404, message: "Not found" };
    case "driver_already_has_active_taxi_ride":
      return {
        status: 409,
        message: "Driver already has an active taxi ride",
      };
    case "invalid_status":
    case "offer_not_available":
    case "ride_not_available":
    case "ride_no_longer_available":
    case "already_assigned":
    case "ride_not_paid":
      return { status: 409, message: "Ride or offer status changed" };
    default:
      return { status: 400, message: errorCode || "Request failed" };
  }
}
