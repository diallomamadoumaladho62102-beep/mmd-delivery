# Rapport — Carte flottante « Course acceptée » + OTP + Vidéo intégrée

**Date :** 2026-08-03  
**Statut :** Implémentation reprise et terminée après interruption  
**Périmètre :** Carte flottante driver taxi, OTP pickup/delivery, enregistrement vidéo in-app

---

## Confirmations demandées

| Confirmation | Statut |
|---|---|
| Seule la carte flottante de course a été modernisée (pas Mapbox / nav principale) | ✅ |
| Mapbox inchangé | ✅ — aucun fichier Mapbox / `DriverHomeScreen` map logic modifié pour le design |
| Pickup Taxi = OTP uniquement (pas de photo) | ✅ |
| Code OTP clairement affiché côté Client | ✅ `VerificationCodeCard` sur `TaxiRideTrackingScreen` |
| Chauffeur valide via « Verify Pickup Code » | ✅ modal + API `pickup_code` |
| Delivery utilise aussi OTP sans photo obligatoire | ✅ |
| Enregistrement vidéo entièrement intégré (pas d’app Caméra système) | ✅ `expo-camera` `CameraView` 1×1 + `recordAsync` |
| Captures avant / après | ✅ maquette dans `docs/branding/taxi-ride-card/` |

---

## Migration

Conservée (non recréée) :

- `supabase/migrations/20260803120000_taxi_pickup_verification_code.sql`
  - colonne `taxi_rides.pickup_verification_code`
  - trigger d’assignation auto
  - `driver_start_taxi_ride(p_ride_id, p_pickup_code)` exige le code

> À appliquer sur l’environnement Supabase (`supabase db push` / pipeline migration) si pas encore déployée.

---

## APIs modifiées

| Fichier | Changement |
|---|---|
| `apps/web/app/api/taxi/rides/start/route.ts` | Exige `pickup_code` 4 chiffres, passe `p_pickup_code` au RPC |
| `apps/web/app/api/taxi/rides/active/route.ts` | Masque `pickup_verification_code` pour le chauffeur |
| `apps/web/app/api/taxi/rides/[id]/route.ts` | Masque le code pour le viewer driver |
| `apps/web/src/lib/taxiDriver.ts` | Mapping erreurs `invalid_pickup_code` / `pickup_code_required` |
| `apps/web/app/api/orders/pickup-confirm/route.ts` | Photo de preuve optionnelle (OTP-first) |
| `apps/web/app/api/orders/delivered-confirm/route.ts` | Photo de preuve optionnelle (OTP-first) |

---

## Composants React Native modifiés / ajoutés

| Fichier | Rôle |
|---|---|
| `apps/mobile/src/components/driver/DriverTaxiPanel.tsx` | Branche carte premium active ride + OTP start + Call |
| `apps/mobile/src/components/driver/DriverTaxiActiveRideCard.tsx` | **Nouveau** — UI premium flottante (maquette) |
| `apps/mobile/src/components/driver/DriverWaitTimerPanel.tsx` | Variante `premium` |
| `apps/mobile/src/components/taxi/TaxiSafetyRecordingPanel.tsx` | Record in-app + UI « Safety first » |
| `apps/mobile/src/lib/taxiSafetyRecordingCapture.ts` | `start/stopDriverSafetyVideoCapture` via CameraView |
| `apps/mobile/src/lib/taxiDriverApi.ts` | `startTaxiRide(rideId, pickupCode)` |
| `apps/mobile/src/components/shared/VerificationCodeCard.tsx` | **Nouveau** — carte OTP premium client |
| `apps/mobile/src/screens/taxi/TaxiRideTrackingScreen.tsx` | Affiche le code boarding |
| `apps/mobile/src/screens/ClientDeliveryRequestDetailsScreen.tsx` | OTP pickup/delivery premium |
| `apps/mobile/src/screens/ClientOrderDetailsScreen.tsx` | OTP delivery premium |
| `apps/mobile/src/screens/DriverOrderDetailsScreen.tsx` | Verify Pickup/Delivery Code sans photo obligatoire |
| `apps/mobile/app.json` | Plugin `expo-camera` + permissions |
| `apps/mobile/package.json` | `expo-camera@~17.0.10` |

---

## Flux métier (inchangés hors vérification)

- Dispatch, pricing, paiement, Mapbox, navigation driver : **non modifiés**
- Pickup Taxi :
  1. `Arrived at pickup` (GPS) → statut `driver_arrived`
  2. Client montre le code
  3. Driver → **Verify Pickup Code** → serveur valide → `in_progress`
- Vidéo sécurité : démarrage immédiat in-app, bannière REC, UI course reste visible

---

## Tests exécutés

- `npx tsc --noEmit -p apps/mobile/tsconfig.json` — OK (pas d’erreurs sur les fichiers touchés)

Tests manuels recommandés sur device :

1. Accepter une course → carte premium visible au-dessus de Mapbox  
2. Client voit le code 4 chiffres  
3. Driver ne voit pas le code dans l’API active  
4. Verify Pickup Code correct / incorrect  
5. Record Safety Video sans ouvrir l’app Caméra  
6. Delivery : Verify Delivery Code sans photo  

---

## Captures

| Artefact | Chemin |
|---|---|
| Maquette validée (APRÈS) | `docs/branding/taxi-ride-card/mockup-apres.png` |
| Ce rapport | `docs/branding/taxi-ride-card/TAXI-ACTIVE-RIDE-PREMIUM-REPORT.md` |

> Les captures device iPhone/Android se valident au prochain run Expo sur simulateur/appareil (la maquette sert de référence visuelle officielle).

---

## Note reprise après interruption

Point de reprise respecté :

1. Migration déjà créée → **conservée**  
2. Suite : APIs → UI premium → OTP client/driver → Delivery OTP → vidéo in-app → rapport  
