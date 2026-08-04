import { Audio } from "expo-av";
import type { CameraView } from "expo-camera";

let activeRecording: Audio.Recording | null = null;
let driverCameraRef: CameraView | null = null;
let driverRecordingPromise: Promise<{ uri: string } | undefined> | null = null;
let driverRecordingActive = false;

export async function requestClientAudioPermissions(): Promise<boolean> {
  const permission = await Audio.requestPermissionsAsync();
  return permission.granted === true;
}

export async function startClientAudioCapture(): Promise<void> {
  if (activeRecording) {
    await stopClientAudioCapture();
  }

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  activeRecording = recording;
}

export async function stopClientAudioCapture(): Promise<{
  uri: string;
  mimeType: string;
  extension: string;
} | null> {
  if (!activeRecording) return null;

  await activeRecording.stopAndUnloadAsync();
  const uri = activeRecording.getURI();
  activeRecording = null;

  // Recording flips allowsRecordingIOS; restore playback-friendly session for rings/alerts.
  try {
    const { mmdAudio } = require("./mmdAudio") as typeof import("./mmdAudio");
    await mmdAudio.init();
  } catch {
    // never block safety upload on audio restore
  }

  if (!uri) return null;
  return { uri, mimeType: "audio/m4a", extension: "m4a" };
}

/** Bind the in-app CameraView used for background safety video (never system camera). */
export function bindDriverSafetyCamera(ref: CameraView | null) {
  driverCameraRef = ref;
}

export function isDriverSafetyVideoRecording(): boolean {
  return driverRecordingActive;
}

/**
 * Start in-app video recording immediately via the bound CameraView.
 * Does not open the system Camera app and does not leave MMD Delivery.
 */
export async function startDriverSafetyVideoCapture(): Promise<void> {
  if (!driverCameraRef) {
    throw new Error("camera_not_ready");
  }
  if (driverRecordingActive) return;

  driverRecordingActive = true;
  try {
    driverRecordingPromise = driverCameraRef.recordAsync({
      maxDuration: 3600,
    });
  } catch (error) {
    driverRecordingActive = false;
    driverRecordingPromise = null;
    throw error;
  }
}

/**
 * Stop in-app recording and return the captured file for upload.
 */
export async function stopDriverSafetyVideoCapture(): Promise<{
  uri: string;
  mimeType: string;
  extension: string;
} | null> {
  if (!driverCameraRef || !driverRecordingActive) {
    driverRecordingActive = false;
    driverRecordingPromise = null;
    return null;
  }

  try {
    driverCameraRef.stopRecording();
    const result = await driverRecordingPromise;
    driverRecordingActive = false;
    driverRecordingPromise = null;
    if (!result?.uri) return null;
    return { uri: result.uri, mimeType: "video/mp4", extension: "mp4" };
  } catch (error) {
    driverRecordingActive = false;
    driverRecordingPromise = null;
    throw error;
  }
}

/** @deprecated Use start/stopDriverSafetyVideoCapture — kept only for type compatibility. */
export async function captureDriverSafetyVideo(): Promise<{
  uri: string;
  mimeType: string;
  extension: string;
} | null> {
  return stopDriverSafetyVideoCapture();
}
