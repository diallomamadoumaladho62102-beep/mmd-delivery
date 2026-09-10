/**
 * Turn-based MMD AI voice conversation phases.
 * This is not WebRTC duplex: listen → transcribe → chat → speak → listen.
 */

export type MmdAiVoicePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error"
  | "ended";

export function voiceFabIcon(
  phase: MmdAiVoicePhase,
): "mic" | "mic-outline" | "hourglass-outline" | "volume-high" | "alert-circle" | "checkmark" {
  switch (phase) {
    case "listening":
      return "mic";
    case "connecting":
    case "thinking":
      return "hourglass-outline";
    case "speaking":
      return "volume-high";
    case "error":
      return "alert-circle";
    case "ended":
      return "checkmark";
    default:
      return "mic-outline";
  }
}

export function voiceFabTint(phase: MmdAiVoicePhase): string {
  switch (phase) {
    case "listening":
      return "#059669";
    case "connecting":
    case "thinking":
      return "#D97706";
    case "speaking":
      return "#2563EB";
    case "error":
      return "#DC2626";
    case "ended":
      return "#334155";
    default:
      return "#003399";
  }
}

export type VoiceFabTapAction = "start" | "stop-listen" | "barge-in" | "retry";

export function voiceFabTapAction(phase: MmdAiVoicePhase): VoiceFabTapAction {
  switch (phase) {
    case "listening":
      return "stop-listen";
    case "speaking":
    case "thinking":
    case "connecting":
      return "barge-in";
    case "error":
      return "retry";
    default:
      return "start";
  }
}

export function isVoiceSessionActive(phase: MmdAiVoicePhase): boolean {
  return (
    phase === "connecting" ||
    phase === "listening" ||
    phase === "thinking" ||
    phase === "speaking"
  );
}

export function voiceFabLabelKey(phase: MmdAiVoicePhase): string {
  switch (phase) {
    case "connecting":
      return "mmd.ai.voice.ride.labelConnecting";
    case "listening":
      return "mmd.ai.voice.ride.labelListening";
    case "thinking":
      return "mmd.ai.voice.ride.labelThinking";
    case "speaking":
      return "mmd.ai.voice.ride.labelSpeaking";
    case "error":
      return "mmd.ai.voice.ride.labelError";
    case "ended":
      return "mmd.ai.voice.ride.labelEnded";
    default:
      return "mmd.ai.voice.ride.labelIdle";
  }
}

export function voiceFabHintKey(phase: MmdAiVoicePhase): string {
  switch (phase) {
    case "listening":
      return "mmd.ai.voice.ride.hintListening";
    case "connecting":
    case "thinking":
    case "speaking":
      return "mmd.ai.voice.ride.hintBargeIn";
    case "error":
      return "mmd.ai.voice.ride.hintRetry";
    default:
      return "mmd.ai.voice.ride.hintIdle";
  }
}

export function voiceFabStateKey(phase: MmdAiVoicePhase): string {
  switch (phase) {
    case "connecting":
      return "mmd.ai.voice.state.connecting";
    case "listening":
      return "mmd.ai.voice.state.listening";
    case "thinking":
      return "mmd.ai.voice.state.thinking";
    case "speaking":
      return "mmd.ai.voice.state.speaking";
    case "error":
      return "mmd.ai.voice.state.error";
    case "ended":
      return "mmd.ai.voice.state.ended";
    default:
      return "mmd.ai.voice.state.idle";
  }
}
