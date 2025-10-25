import { useEffect, useState } from "react";
import { View, Text, Button } from "react-native";
import * as Location from "expo-location";

export default function App() {
  const [loc, setLoc] = useState<Location.LocationObject | null>(null);
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const current = await Location.getCurrentPositionAsync({});
      setLoc(current);
    })();
  }, []);

  return (
    <View style={{ flex:1, alignItems:'center', justifyContent:'center' }}>
      <Text style={{ fontSize:18, marginBottom:8 }}>MMD Delivery – Livreur</Text>
      <Text>{loc ? `GPS: ${loc.coords.latitude.toFixed(4)}, ${loc.coords.longitude.toFixed(4)}` : 'GPS en attente…'}</Text>
      <Button title="Mettre à jour position" onPress={async ()=>{
        const current = await Location.getCurrentPositionAsync({});
        setLoc(current);
        // TODO: POST vers backend
      }} />
    </View>
  );
}
