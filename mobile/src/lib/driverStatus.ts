import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mmd_driver_is_online";

export async function setDriverOnlineStatus(isOnline: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, isOnline ? "1" : "0");
  } catch (e) {
    console.log("❌ Erreur setDriverOnlineStatus:", e);
  }
}

export async function getDriverOnlineStatus(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === "1";
  } catch (e) {
    console.log("❌ Erreur getDriverOnlineStatus:", e);
    return false;
  }
}
