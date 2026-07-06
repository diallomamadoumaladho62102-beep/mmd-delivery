import { Audio } from "expo-av";
import * as ImagePicker from "expo-image-picker";

let activeRecording: Audio.Recording | null = null;

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

  if (!uri) return null;
  return { uri, mimeType: "audio/m4a", extension: "m4a" };
}

export async function captureDriverSafetyVideo(): Promise<{
  uri: string;
  mimeType: string;
  extension: string;
} | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error("camera_permission_denied");
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["videos"],
    videoMaxDuration: 3600,
    quality: 0.8,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null;
  }

  const asset = result.assets[0];
  const mimeType = asset.mimeType ?? "video/mp4";
  const extension = mimeType.includes("quicktime") ? "mov" : "mp4";
  return { uri: asset.uri, mimeType, extension };
}
