export type AdminVoiceRingingDeps = {
  start: () => void;
  stop: () => void;
};

/**
 * Single cleanup path for admin incoming-call ringing.
 * Any non-incoming phase must release audio + timers via stop().
 */
export function createAdminVoiceRingingController(deps: AdminVoiceRingingDeps) {
  let playing = false;

  function stopAll(): void {
    playing = false;
    deps.stop();
  }

  function sync(params: { shouldRing: boolean; audioBlocked: boolean }): void {
    if (!params.shouldRing || params.audioBlocked) {
      stopAll();
      return;
    }
    if (playing) return;
    playing = true;
    try {
      deps.start();
    } catch {
      playing = false;
    }
  }

  return {
    sync,
    stopAll,
    isPlaying: () => playing,
  };
}

export function incomingStatusesShouldRing(statuses: string[]): boolean {
  return statuses.some((status) =>
    ["incoming", "in_ivr", "ringing", "queued"].includes(
      String(status ?? "").trim().toLowerCase(),
    ),
  );
}
