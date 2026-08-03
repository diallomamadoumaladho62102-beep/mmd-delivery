# Finalisation — Taxi OTP · Delivery OTP · Driver Panel Premium

**Date:** 2026-08-03  
**Branche:** `cursor/pe-phase-5b-independence`  
**Projet Supabase:** `mmd_delivery` (`sjmszohmhudayxawfows`)

## 1. Migration Supabase

| Élément | Statut |
|--------|--------|
| Fichier | `supabase/migrations/20260803121000_taxi_pickup_verification_code.sql` |
| Application | Appliquée sur le projet linked (`supabase db query --linked -f …`) |
| Historique | `migration repair --status applied 20260803121000` → local = remote |

**Note version:** le fichier initial portait le préfixe `20260803120000`, déjà pris par `road_safety_events.sql`. Le contenu n’a pas été recréé ; seul le préfixe a été ajusté en `20260803121000` pour permettre l’application et le suivi.

### Objets vérifiés en base

- Colonne `taxi_rides.pickup_verification_code` (`text`)
- Fonction `taxi_generate_pickup_verification_code()`
- Trigger `trg_taxi_rides_assign_pickup_code`
- RPC `driver_start_taxi_ride(uuid)` et `driver_start_taxi_ride(uuid, text)` (code 4 chiffres obligatoire)

## 2. Vérifications fonctionnelles

### Taxi

| Critère | Confirmation |
|--------|--------------|
| Pickup = OTP uniquement | Oui — bouton **Verify Pickup Code**, pas de photo |
| Client voit le code | Oui — `VerificationCodeCard` sur `TaxiRideTrackingScreen` |
| Chauffeur saisit le code | Oui — modal OTP bancaire |
| Validation serveur | Oui — `POST /api/taxi/rides/start` → `driver_start_taxi_ride(..., p_pickup_code)` |
| Course démarre seulement si code valide | Oui — RPC refuse `invalid_pickup_code` |
| Code masqué côté chauffeur (API active/id) | Oui — strip `pickup_verification_code` |

### Delivery

| Critère | Confirmation |
|--------|--------------|
| Client voit le code | Oui — `VerificationCodeCard` (pickup / dropoff) |
| Livreur valide facilement | Oui — **Verify Pickup / Delivery Code** + cases OTP |
| Pas de photo obligatoire si OTP | Oui — `pickup-confirm` / `delivered-confirm` + flux mobile OTP-first |

### Driver Taxi Panel

| Critère | Confirmation |
|--------|--------------|
| Seule la carte flottante modernisée | Oui — `DriverTaxiActiveRideCard` |
| Mapbox inchangé | Oui — aucun changement de config / couches Mapbox pour ce flux |
| Navigation principale inchangée | Oui — overlay carte uniquement |

### Enregistrement vidéo

| Critère | Confirmation |
|--------|--------------|
| Pas d’app Caméra système | Oui — `expo-camera` `CameraView` + `recordAsync` |
| Intégré dans MMD Delivery | Oui — `TaxiSafetyRecordingPanel` |
| Arrière-plan / UI course visible | Oui — caméra 1×1, carte flottante reste utilisable |

## 3. Amélioration UX OTP (style banque)

Nouveau composant : `apps/mobile/src/components/shared/OtpDigitInput.tsx`

- Clavier numérique (taxi) / alphanumérique (delivery 6 cases)
- Cases individuelles, auto-avance, auto-submit au dernier chiffre
- Animation succès + message d’erreur clair + shake
- Branché sur **Verify Pickup Code** (taxi) et **Verify Pickup/Delivery Code** (delivery)

## 4. Fichiers modifiés (périmètre finalisation)

### Mobile (React Native)

- `apps/mobile/src/components/shared/OtpDigitInput.tsx` *(nouveau)*
- `apps/mobile/src/components/shared/VerificationCodeCard.tsx` *(nouveau)*
- `apps/mobile/src/components/driver/DriverTaxiActiveRideCard.tsx` *(nouveau)*
- `apps/mobile/src/components/driver/DriverTaxiPanel.tsx`
- `apps/mobile/src/components/driver/DriverWaitTimerPanel.tsx`
- `apps/mobile/src/components/taxi/TaxiSafetyRecordingPanel.tsx`
- `apps/mobile/src/lib/taxiDriverApi.ts`
- `apps/mobile/src/lib/taxiSafetyRecordingCapture.ts`
- `apps/mobile/src/screens/taxi/TaxiRideTrackingScreen.tsx`
- `apps/mobile/src/screens/ClientDeliveryRequestDetailsScreen.tsx`
- `apps/mobile/src/screens/ClientOrderDetailsScreen.tsx`
- `apps/mobile/src/screens/DriverOrderDetailsScreen.tsx`
- `apps/mobile/package.json` / `apps/mobile/app.json` (`expo-camera`)

### APIs Web

- `apps/web/app/api/taxi/rides/start/route.ts`
- `apps/web/app/api/taxi/rides/active/route.ts`
- `apps/web/app/api/taxi/rides/[id]/route.ts`
- `apps/web/app/api/orders/pickup-confirm/route.ts`
- `apps/web/app/api/orders/delivered-confirm/route.ts`
- `apps/web/src/lib/taxiDriver.ts`

### Supabase

- `supabase/migrations/20260803121000_taxi_pickup_verification_code.sql`

### Captures / docs

- Avant / après carte course : `docs/branding/taxi-ride-card/`
- Rapport orientations : `docs/branding/taxi-ride-card/TAXI-ACTIVE-RIDE-PREMIUM-REPORT.md`

## 5. Tests exécutés

| Suite | Résultat |
|------|----------|
| `apps/web` `taxiPhase5.test.ts` | OK |
| `apps/web` `deliveryProofUrl.test.ts` | OK |
| `apps/web` `userFacingError.test.ts` | OK |
| `apps/mobile` `taxiOfferExpiry.test.ts` | OK |
| `apps/mobile` `taxiPaymentAbandonFlow.test.ts` | OK |
| `apps/mobile` `userFacingError.test.ts` | OK |
| `apps/mobile` `waitTimerApi.test.ts` | OK |
| `tsc --noEmit` mobile | exit 0 |
| `tsc --noEmit` web | exit 0 |

## 6. iOS / Android

| Plateforme | Confirmation |
|-----------|--------------|
| iOS | Code Expo / RN partagé ; `expo-camera` plugin ; OTP `number-pad` / autofill ; pas d’ouverture Caméra système pour la safety video |
| Android | Même code partagé ; adaptive icon / mipmaps régénérés ; clavier numérique OTP ; enregistrement via `CameraView` in-app |

> Validation runtime device complète (course live) hors scope CI ; vérifications schema + TypeScript + tests unitaires ciblés OK.

## 7. Git

| Étape | Statut |
|------|--------|
| Commit | `ad09f3d8` — `feat(taxi/delivery): finalize OTP pickup and premium driver ride card` |
| Push | `origin/cursor/pe-phase-5b-independence` |
| PR | https://github.com/diallomamadoumaladho62102-beep/mmd-delivery/pull/67 |
| Merge `main` | `948fd4bd` — commit OTP présent sur `origin/main` |

> Note: le checkout local de `main` était bloqué par des fichiers WIP non liés (icon/home/admin). Fusion effectuée via PR GitHub sans force-push.
