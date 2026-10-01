export function freezeTimestamp(
  previous: string | null | undefined,
  next: unknown
): string | null {
  if (previous == null || previous === "") {
    return next == null || next === "" ? null : String(next);
  }
  return previous;
}

export function clientCannotWriteOfficialClock(fields: {
  driverAcceptedAt?: unknown;
  tripStart?: unknown;
  tripEnd?: unknown;
  officialDuration?: unknown;
  earnings?: unknown;
  anomalyResult?: unknown;
  reviewDecision?: unknown;
  sanctionDecision?: unknown;
}): boolean {
  return Object.values(fields).every((value) => value == null);
}

export function disputeCannotMutateTripClock(): {
  driverAcceptedAt: "immutable";
  tripStart: "immutable";
  tripEnd: "immutable";
  officialDuration: "immutable";
  earnings: "immutable";
} {
  return {
    driverAcceptedAt: "immutable",
    tripStart: "immutable",
    tripEnd: "immutable",
    officialDuration: "immutable",
    earnings: "immutable",
  };
}
