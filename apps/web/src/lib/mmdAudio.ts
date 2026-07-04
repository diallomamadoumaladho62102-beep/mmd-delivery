/**
 * MMD Signature Collection — centralized web audio.
 */
import { MMD_PUSH_SOUNDS } from "./mmdPushSounds";

export type MmdWebSoundKey = keyof typeof WEB_SOUND_PATHS;
export type MmdLongRingKind = "driver" | "restaurant";

const WEB_SOUND_PATHS = {
  driverRing: `/sounds/${MMD_PUSH_SOUNDS.driverRing}`,
  restaurantRing: `/sounds/${MMD_PUSH_SOUNDS.restaurantRing}`,
  client: `/sounds/${MMD_PUSH_SOUNDS.client}`,
  chat: `/sounds/${MMD_PUSH_SOUNDS.chat}`,
  paymentSuccess: `/sounds/${MMD_PUSH_SOUNDS.paymentSuccess}`,
  paymentFailed: `/sounds/${MMD_PUSH_SOUNDS.paymentFailed}`,
  success: `/sounds/${MMD_PUSH_SOUNDS.success}`,
  error: `/sounds/${MMD_PUSH_SOUNDS.error}`,
  warning: `/sounds/${MMD_PUSH_SOUNDS.warning}`,
  promo: `/sounds/${MMD_PUSH_SOUNDS.promo}`,
  reward: `/sounds/${MMD_PUSH_SOUNDS.reward}`,
  system: `/sounds/${MMD_PUSH_SOUNDS.system}`,
  rideAccepted: `/sounds/${MMD_PUSH_SOUNDS.rideAccepted}`,
  orderAccepted: `/sounds/${MMD_PUSH_SOUNDS.orderAccepted}`,
  driverArrived: `/sounds/${MMD_PUSH_SOUNDS.driverArrived}`,
  deliveryCompleted: `/sounds/${MMD_PUSH_SOUNDS.deliveryCompleted}`,
} as const;

const LONG_RING_CONFIG: Record<
  MmdLongRingKind,
  { key: MmdWebSoundKey; maxDurationMs: number; initialVolume: number }
> = {
  driver: { key: "driverRing", maxDurationMs: 60_000, initialVolume: 0.35 },
  restaurant: { key: "restaurantRing", maxDurationMs: 120_000, initialVolume: 0.3 },
};

class MmdWebAudioService {
  private longRingAudio: HTMLAudioElement | null = null;
  private longRingKind: MmdLongRingKind | null = null;
  private isLongRingPlaying = false;
  private volumeRampTimeout: ReturnType<typeof setTimeout> | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private oneShotCache = new Map<MmdWebSoundKey, HTMLAudioElement>();
  private oneShotLock = false;
  private unlocked = false;

  private ensureUnlocked(): void {
    if (typeof window === "undefined") return;
    this.unlocked = true;
  }

  private getOneShot(key: MmdWebSoundKey): HTMLAudioElement {
    let audio = this.oneShotCache.get(key);
    if (!audio) {
      audio = new Audio(WEB_SOUND_PATHS[key]);
      audio.preload = "auto";
      this.oneShotCache.set(key, audio);
    }
    return audio;
  }

  private clearLongRingTimers(): void {
    if (this.volumeRampTimeout) {
      clearTimeout(this.volumeRampTimeout);
      this.volumeRampTimeout = null;
    }
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.maxDurationTimeout) {
      clearTimeout(this.maxDurationTimeout);
      this.maxDurationTimeout = null;
    }
  }

  stopLongRing(): void {
    this.clearLongRingTimers();

    const audio = this.longRingAudio;
    this.longRingAudio = null;
    this.longRingKind = null;
    this.isLongRingPlaying = false;

    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.loop = false;
      audio.onended = null;
    } catch {
      // ignore pause/reset errors during teardown
    }
  }

  startLongRing(kind: MmdLongRingKind): void {
    if (typeof window === "undefined") return;

    this.ensureUnlocked();

    if (this.longRingKind === kind && this.isLongRingPlaying) return;

    this.stopLongRing();

    const config = LONG_RING_CONFIG[kind];
    const audio = new Audio(WEB_SOUND_PATHS[config.key]);
    audio.preload = "auto";
    audio.loop = true;
    audio.volume = config.initialVolume;

    this.longRingAudio = audio;
    this.longRingKind = kind;
    this.isLongRingPlaying = true;

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        this.isLongRingPlaying = false;
      });
    }

    this.volumeRampTimeout = setTimeout(() => {
      let volume = config.initialVolume;
      this.volumeInterval = setInterval(() => {
        if (!this.longRingAudio) return;
        volume = Math.min(1, volume + 0.1);
        this.longRingAudio.volume = volume;
        if (volume >= 1 && this.volumeInterval) {
          clearInterval(this.volumeInterval);
          this.volumeInterval = null;
        }
      }, 1000);
    }, 10_000);

    this.maxDurationTimeout = setTimeout(() => {
      this.stopLongRing();
    }, config.maxDurationMs);
  }

  async play(key: MmdWebSoundKey): Promise<void> {
    if (typeof window === "undefined") return;
    if (this.oneShotLock) return;

    this.ensureUnlocked();
    this.oneShotLock = true;

    try {
      const audio = this.getOneShot(key);
      audio.currentTime = 0;
      audio.volume = 1;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        await p.catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      this.oneShotLock = false;
    }
  }

  playForOrderStatus(status: string | null | undefined): void {
    const s = String(status ?? "").trim().toLowerCase();
    switch (s) {
      case "accepted":
      case "assigned":
        void this.play("orderAccepted");
        break;
      case "dispatched":
      case "picked_up":
        void this.play("client");
        break;
      case "ready":
        void this.play("driverArrived");
        break;
      case "delivered":
        void this.play("deliveryCompleted");
        break;
      case "canceled":
        void this.play("warning");
        break;
      default:
        break;
    }
  }

  unlockOnInteraction(): void {
    if (typeof window === "undefined") return;
    const unlock = () => this.ensureUnlocked();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }
}

export const mmdAudio = new MmdWebAudioService();

/** @deprecated Use mmdAudio.startLongRing('restaurant') */
export function startRingtone(): void {
  mmdAudio.startLongRing("restaurant");
}

/** @deprecated Use mmdAudio.stopLongRing() */
export function stopRingtone(): void {
  mmdAudio.stopLongRing();
}

export { WEB_SOUND_PATHS };
