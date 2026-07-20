/**
 * MMD Signature Collection — centralized mobile audio (expo-av).
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";
import { AppState, type AppStateStatus } from "react-native";
import { MMD_SOUND_ASSETS, type MmdSoundKey } from "./mmdPushSounds";

export type MmdLongRingKind = "driver" | "restaurant";

const LONG_RING_CONFIG: Record<
  MmdLongRingKind,
  { asset: number; maxDurationMs: number; initialVolume: number }
> = {
  driver: {
    asset: MMD_SOUND_ASSETS.driverRing,
    maxDurationMs: 90_000,
    initialVolume: 0.85,
  },
  restaurant: {
    asset: MMD_SOUND_ASSETS.restaurantRing,
    maxDurationMs: 120_000,
    initialVolume: 0.3,
  },
};

class MmdAudioService {
  private initialized = false;
  private longRingSound: Audio.Sound | null = null;
  private longRingKind: MmdLongRingKind | null = null;
  private volumeRampTimeout: ReturnType<typeof setTimeout> | null = null;
  private volumeInterval: ReturnType<typeof setInterval> | null = null;
  private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
  private oneShotSound: Audio.Sound | null = null;
  private oneShotLock = false;
  private appStateSub: { remove: () => void } | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      playThroughEarpieceAndroid: false,
    });

    this.appStateSub = AppState.addEventListener("change", this.onAppStateChange);
    this.initialized = true;
  }

  private onAppStateChange = (state: AppStateStatus) => {
    if (state === "background" || state === "inactive") {
      // Long ring continues in background for driver/restaurant alerts.
      return;
    }
  };

  private clearVolumeRamp(): void {
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

  async stopLongRing(): Promise<void> {
    this.clearVolumeRamp();

    const sound = this.longRingSound;
    this.longRingSound = null;
    this.longRingKind = null;

    if (!sound) return;

    try {
      sound.setOnPlaybackStatusUpdate(null);
    } catch {}

    try {
      await sound.stopAsync();
    } catch {}

    try {
      await sound.unloadAsync();
    } catch {}
  }

  async startLongRing(kind: MmdLongRingKind): Promise<void> {
    await this.init();

    if (this.longRingKind === kind && this.longRingSound) return;

    await this.stopLongRing();

    const config = LONG_RING_CONFIG[kind];

    const { sound } = await Audio.Sound.createAsync(config.asset, {
      shouldPlay: false,
      isLooping: true,
      volume: config.initialVolume,
    });

    this.longRingSound = sound;
    this.longRingKind = kind;

    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      if (
        status.didJustFinish &&
        this.longRingSound === sound &&
        this.longRingKind === kind
      ) {
        sound.replayAsync().catch(() => {});
      }
    });

    await sound.setPositionAsync(0);
    await sound.playAsync();

    this.volumeRampTimeout = setTimeout(() => {
      let volume = config.initialVolume;
      this.volumeInterval = setInterval(() => {
        if (!this.longRingSound) return;
        volume = Math.min(1, volume + 0.1);
        this.longRingSound.setVolumeAsync(volume).catch(() => {});
        if (volume >= 1 && this.volumeInterval) {
          clearInterval(this.volumeInterval);
          this.volumeInterval = null;
        }
      }, 1000);
    }, 10_000);

    this.maxDurationTimeout = setTimeout(() => {
      void this.stopLongRing();
    }, config.maxDurationMs);
  }

  async play(key: MmdSoundKey): Promise<void> {
    await this.init();

    if (this.oneShotLock) return;
    this.oneShotLock = true;

    try {
      if (this.oneShotSound) {
        try {
          await this.oneShotSound.unloadAsync();
        } catch {}
        this.oneShotSound = null;
      }

      const { sound } = await Audio.Sound.createAsync(MMD_SOUND_ASSETS[key], {
        shouldPlay: false,
        volume: 1,
      });

      this.oneShotSound = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        if (status.didJustFinish && this.oneShotSound === sound) {
          sound.unloadAsync().catch(() => {});
          if (this.oneShotSound === sound) this.oneShotSound = null;
        }
      });

      await sound.playAsync();
    } catch {
      // ignore playback errors
    } finally {
      this.oneShotLock = false;
    }
  }

  /** Map order status transitions to client-facing sounds. */
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

  async dispose(): Promise<void> {
    await this.stopLongRing();

    if (this.oneShotSound) {
      try {
        await this.oneShotSound.unloadAsync();
      } catch {}
      this.oneShotSound = null;
    }

    this.appStateSub?.remove();
    this.appStateSub = null;
    this.initialized = false;
  }
}

export const mmdAudio = new MmdAudioService();
