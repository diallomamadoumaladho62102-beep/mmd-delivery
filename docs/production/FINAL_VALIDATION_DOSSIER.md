# MMD Delivery — Dossier unique de validation pré-BUILD ALL

**Date :** 2026-11-11  
**Branche :** `main`  
**HEAD au démarrage de la mission :** `02e14a57`  
**Pin App Store 1.0.1 (89) :** `3152ebf28d4da7eb648827c64a7f0a6130dec8c3`  
**Host :** Windows + vérifications API/Android config (pas de Xcode)

**Interdit sans nouvel ordre fondateur :** EAS Build, IPA, OTA, Submit, Deploy.

---

## A. Comparaison détaillée build 89 / main

### Identité native (doit rester alignée)

| Champ | Build 89 (pin) | HEAD | Statut |
|---|---|---|---|
| `ios.bundleIdentifier` | `com.maladho2025.mmddelivery` | identique | **PASS** |
| `ios.version` | `1.0.1` | identique | **PASS** |
| `runtimeVersion` | `1.0.0` | identique | **PASS** (freeze OTA armé) |
| Apple Pay merchant | `merchant.com.maladho2025.mmddelivery` | identique | **PASS** |
| Associated Domains | `applinks:www.mmddelivery.com` | identique | **PASS** |
| BG modes | `location`, `remote-notification` | identique | **PASS** |
| Locales | en fr es ar zh ff | identique | **PASS** |
| Android package | `com.maladho2025.mmddelivery` | identique | **PASS** |
| Scheme | `mmddelivery` | identique | **PASS** |

Preuve automatisée : `scripts/store89-main-compat.regression.test.mjs`.

### Delta fonctionnel depuis 89 (~33 commits, ~231 fichiers)

| Modification | Pourquoi | Comportement | Nécessaire | Risque US/GN |
|---|---|---|---|---|
| PaymentSheet natif carte (`presentCardPaymentSheet`) | Remplacer Checkout navigateur pour US card sur **nouveaux** binaires | Taxi/food/delivery carte → sheet native ; confirm serveur inchangé | Oui (cert US) | US : changement UX intentionnel. **Binaire 89 intact** (toujours Checkout). GN cash inchangé |
| Retry `quote_price_changed` | Mapbox drift cents | 1 retry avec total serveur | Oui | Faible |
| Autocomplete `onSelect` only | Fix race lat/lng null | Coords conservées à la sélection | Oui (bugfix) | Positif US+GN |
| `CountryWelcomeScreen` + marchés | Entrée pays avant RoleSelect | GN/US currency & dial | Oui | Isolé par marché |
| `guineaTestIsolation` + US cert IDs | Bloquer dispatch live des 8 comptes test | Pros non approuvés isolés | Oui | Protection |
| Sécurité deps (Next, Snyk, vendor) | CI/audit | Pas de changement produit UX | Oui | Faible |
| OTA freeze script | Empêcher OTA production → 89 | `eas update --channel production` bloqué | Oui | Protection 89 |
| Fallback `IOS_BUILD_NUMBER` local 90 | Éviter collision ≤89 en prebuild local | N’affecte pas le binaire publié | Oui | Aucun |

**Verdict comparaison :** aucune régression d’identité store. Le seul delta paiement US card est **volontaire pour le prochain binaire** ; le build 89 n’est pas modifié et ne reçoit pas ce JS tant que le freeze OTA tient.

---

## B. Régressions identifiées et corrections

| Anomalie | Cause | Correction | Test |
|---|---|---|---|
| ZIP `10007` forcé dans PaymentSheet pour tout merchant | Prefill cert US trop large | Prefill ZIP **uniquement si** `merchantCountry === "US"` | `present-card-paymentsheet.regression.test.mjs` |
| Risque OTA → 89 | Même `runtimeVersion` | Garde-fou déjà en place + maintenu | `assert-store89-ota-freeze.mjs` |
| Absence de contrat pin↔HEAD | — | Ajout `store89-main-compat.regression.test.mjs` dans `test:ci` | **PASS** |

Aucune autre régression logicielle correctible détectée sur Windows dans cette passe.

---

## C. Validation marché américain

| Test | Statut | Preuve |
|---|---|---|
| Login/logout client US | **PASS** | 8-rôles smoke |
| Pros US login + non-approuvés / offline / isolés | **PASS** | isolation script |
| Devise USD / marché | **PASS** | `marketCurrency('US')==='USD'` + Stripe USD PI |
| Taxi quote + PaymentIntent USD | **PASS** | `stripe-us-*-cert.mjs` |
| PaymentSheet cancel UI | **PASS** | preuves antérieures emulator |
| PaymentSheet accept/decline UI | **BLOCKED** | saisie manuelle |
| Autocomplete coords | **PASS** | cert-fill + code contract |
| Checkout food/delivery PaymentSheet wiring | **PASS** | regression present-card |
| Apple Pay logique (unit) | **PASS** | `applePayCheckout.test.ts` |
| Apple Pay device | **BLOCKED** | iPhone |
| Notifications APNs | **BLOCKED** | device |
| Géoloc device | **BLOCKED** / code **PASS** | unit + permissions FG émulateur antérieur |

**Non-régression vs 89 :** parcours US métier préservés ; carte native = évolution du **prochain** binaire uniquement.

---

## D. Validation marché guinéen

| Test | Statut | Preuve |
|---|---|---|
| Country before RoleSelect | **PASS** (code) | `CountryWelcomeScreen` + navigator |
| RoleSelect préservé | **PASS** | diff RoleSelect limité |
| +224 / GNF | **PASS** | comptes `+224…` ; `marketCurrency('GN')==='GNF'` |
| Code postal facultatif GN | **PASS** | `taxiAddressConfig` WEST_AFRICA `postal_code_required: false` |
| Pin manuel / landmark GN | **PASS** (config) | WEST_AFRICA flags |
| 4 rôles GN login/logout | **PASS** | smoke |
| Chauffeur/restaurant pending (non approuvés) | **PASS** | `status: pending`, online false |
| Cash GN API smoke | **PASS** | stripe cert cash samples `is_test` |
| Activation restaurants publique | **NOT TESTED** live catalog | selon flags prod — pas d’approbation artificielle |

Règles US non altérées par config GN (postal/currency séparés).

---

## E. Huit rôles

| Rôle | Login | Logout | Isolation / statut |
|---|---|---|---|
| Client GN | **PASS** | **PASS** | isolé |
| Chauffeur GN | **PASS** | **PASS** | pending, offline |
| Restaurant GN | **PASS** | **PASS** | non approuvé artificiellement |
| Vendeur GN | **PASS** | **PASS** | isolé |
| Client US | **PASS** | **PASS** | E2E |
| Chauffeur US | **PASS** | **PASS** | dispatch-isolated |
| Restaurant US | **PASS** | **PASS** | dispatch-isolated |
| Vendeur US | **PASS** | **PASS** | dispatch-isolated |

---

## F. Stripe / paiements

| Test | Statut |
|---|---|
| Clés `pk_test` / `sk_test` | **PASS** |
| PI succeed / decline / cancel API | **PASS** |
| Idempotence / abandon / unpaid 409 / anti double-pay | **PASS** |
| Montants USD taxi | **PASS** |
| Cash GN test | **PASS** |
| PaymentSheet cancel UI | **PASS** |
| Accept `4242` UI | **BLOCKED** |
| Decline `4000…0002` UI | **BLOCKED** |
| Apple Pay réel | **BLOCKED** |
| Remboursement live | **NOT TESTED** (hors scope ; pas de transaction réelle) |

**Session manuelle unique :**  
1) `4242…` → Pay → noter `pi_`  
2) Nouveau devis → `4000…0002`  
3) `node scripts/verify-paymentsheet-manual-session.mjs --accept-pi=… --decline-pi=…`

---

## G. Android

| Item | Statut |
|---|---|
| Package / permissions location+BG+notif | **PASS** (config) |
| Stripe RN 0.50.3 / expo-location / notifications / updates | **PASS** (deps résolues) |
| Profils EAS preview / android-smoke / production | **PASS** |
| Compile Gradle local complète | **NOT TESTED** (pas de `eas build` / assemble Release lancé) |
| PaymentSheet sur émulateur (open/cancel) | **PASS** (preuves antérieures) |

---

## H. iOS

| Item | Statut |
|---|---|
| Bundle / version 1.0.1 / merchant / domains / BG / 6 locales / Stripe plugin | **PASS** (config) |
| Fallback buildNumber local ≥90 | **PASS** |
| `pod install` / `xcodebuild` / Simulator | **BLOCKED** (Windows) |
| APNs / Apple Pay Wallet / PaymentSheet iOS device | **BLOCKED** |

---

## I. Six langues

| Test | Statut |
|---|---|
| Coverage i18n 6 locales | **PASS** |
| fullScreenI18n 103 routes / 102 screens | **PASS** |
| Checkout / taxi cancel / guinea market / alert literals | **PASS** |
| RTL arabe (code `forceRTL`) | **PASS** (code) |
| Preuve visuelle overflow device | **NOT TESTED** / **BLOCKED** iPhone |

---

## J. Sécurité

| Test | Statut |
|---|---|
| `secret-scan` | **PASS** (0 findings) |
| OTA freeze production | **PASS** (bloque) |
| Isolation comptes test | **PASS** |
| Gates approval pro | **PASS** |
| Semgrep/CodeQL/ZAP | **PASS** sur dernier push `02e14a57` ; re-vérifier après push de cette mission |

---

## K. CI

- Local : `pnpm test:ci` exécuté dans la mission (inclut nouveaux garde-fous).  
- Distant : vert sur `02e14a57` avant corrections ; **re-check obligatoire** après push des fixes de cette mission.

---

## L. Préparation BUILD ALL

| Check | Statut |
|---|---|
| Expo app identity cohérente Android/iOS | **PASS** |
| EAS profiles présents | **PASS** |
| `runtimeVersion` 1.0.0 + freeze OTA | **PASS** (armé) |
| Secrets Stripe test vs prod non mélangés en local cert | **PASS** (`pk_test`/`sk_test`) |
| Build 89 intact | **PASS** |
| Binaire produit | **NOT RUN** (interdit) |

Commande **après autorisation explicite** :

```bash
cd C:\DEV\MMD-Delivery
node scripts/assert-store89-ota-freeze.mjs
eas build --platform all --profile production
```

Validation interne recommandée avant store :

```bash
eas build --platform all --profile preview
```

---

## M. Interventions physiques restantes (UNE session)

1. macOS : `expo prebuild --platform ios` + `expo run:ios` **ou** `eas build --profile ios-simulator|preview` (après OK).  
2. iPhone : install preview pk_test.  
3. PaymentSheet : cancel (si besoin) + **4242** + **4000…0002** ; lancer vérifieur avec PI ids.  
4. Apple Pay sandbox si Wallet.  
5. Push APNs test.  
6. GPS accept/refus + BG sur trajet.  
7. Langues dont **ar RTL** — parcours Accueil/Taxi/Réglages.  
8. Spot-check 8 rôles sur device.  
9. Confirmer **aucun OTA** pendant la session.

---

## N. Verdict final

| Question | Réponse |
|---|---|
| Prêt technique Windows pour BUILD ALL ? | **OUI** (config + tests auto verts + freeze 89) |
| Certification 100 % USA+GN déclarable ? | **NON** tant que PaymentSheet UI accept/decline + iPhone restent **BLOCKED** |
| Régression du binaire 89 ? | **NON** — identité intacte, OTA production bloquée |
| Correctifs intégrés cette mission | ZIP PaymentSheet US-only ; tests compat 89 ; dossier actualisé |

**Ne pas lancer EAS tant que la checklist M n’est pas planifiée et que le fondateur n’autorise pas le build.**
