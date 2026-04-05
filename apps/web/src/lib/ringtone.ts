let audio: HTMLAudioElement | null = null;
let isPlaying = false;

function ensureAudio() {
  if (typeof window === "undefined") return null;
  if (!audio) {
    audio = new Audio("/sounds/notify.mp3");
    audio.preload = "auto";
    audio.loop = true; // ✅ boucle
    audio.volume = 1.0;
  }
  return audio;
}

export function startRingtone() {
  const a = ensureAudio();
  if (!a) return;

  // ✅ évite de relancer 100 fois
  if (isPlaying) return;
  isPlaying = true;

  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && typeof (p as any).catch === "function") {
      (p as any).catch(() => {
        // autoplay bloqué -> on ne crash pas
        isPlaying = false;
      });
    }
  } catch {
    isPlaying = false;
  }
}

export function stopRingtone() {
  const a = ensureAudio();
  if (!a) return;

  try {
    a.pause();
    a.currentTime = 0;
  } catch {
    // ignore
  } finally {
    isPlaying = false;
  }
}
