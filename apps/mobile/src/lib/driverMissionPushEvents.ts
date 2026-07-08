type DriverMissionPushListener = (payload: { type: string }) => void;

const listeners = new Set<DriverMissionPushListener>();

export function subscribeDriverMissionPushRefresh(listener: DriverMissionPushListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyDriverMissionPushReceived(type: string) {
  listeners.forEach((listener) => {
    try {
      listener({ type });
    } catch (error) {
      console.log("[driverMissionPushEvents] listener error", error);
    }
  });
}
