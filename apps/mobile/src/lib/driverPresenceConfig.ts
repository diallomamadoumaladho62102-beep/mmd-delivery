/** Grace period before treating transient network/restore failures as offline. */
export const DRIVER_ONLINE_GRACE_MS = Number(
  process.env.EXPO_PUBLIC_DRIVER_ONLINE_GRACE_MS ?? 90_000,
);

export const DRIVER_PRESENCE_HEARTBEAT_MS = 15_000;

export const DRIVER_ONLINE_RESTORE_RETRY_MS = 5_000;
