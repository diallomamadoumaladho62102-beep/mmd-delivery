import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

export async function getStableDriverDeviceId(): Promise<string> {
  if (Platform.OS === "android") {
    const androidId = Application.getAndroidId?.();
    if (androidId) return `android:${androidId}`;
  }

  if (Platform.OS === "ios") {
    const iosId = await Application.getIosIdForVendorAsync?.();
    if (iosId) return `ios:${iosId}`;
  }

  const installationId = Constants.installationId;
  if (installationId) return `install:${installationId}`;

  const model = Device.modelName ?? "unknown";
  const os = Device.osName ?? Platform.OS;
  return `${os}:${model}:${Constants.sessionId ?? "session"}`;
}
