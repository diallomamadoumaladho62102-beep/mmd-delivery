# MMD Delivery — Dossier unique de validation pré-build

**Date :** 2026-11-11  
**HEAD cert :** `919b7c5e513905eeee6b1c5f793b0625a13ad44b`  
**Pin App Store 1.0.1 (89) :** `3152ebf28d4da7eb648827c64a7f0a6130dec8c3`  
**Host de préparation :** Windows + Android `emulator-5556`  
**Interdit sans autorisation fondateur :** commit, push, EAS build, IPA, OTA, submit, deploy

Ce dossier remplace les rapports intermédiaires. Il décrit l’état prêt pour le prochain build de validation et les tests iPhone.

---

## A. État Git initial et protection du build 89

| Item | Valeur / résultat |
|---|---|
| Branche | `main` (alignée `origin/main` au démarrage de la passe) |
| HEAD | `919b7c5e` — **PASS** |
| Pin store | `3152ebf2` — **intact** (aucun rebuild / OTA / submit) |
| Identité iOS store | version **1.0.1**, build **89**, bundle `com.maladho2025.mmddelivery` |
| `runtimeVersion` HEAD | **1.0.0** (= runtime du binaire 89) → risque OTA production |
| Neutralisation OTA | Script `scripts/assert-store89-ota-freeze.mjs` + `pnpm ota:block-production` + accroche `test:ci` |
| Preuve freeze | Default **PASS** (freeze armed) ; `--channel=production` **exit 1** ; `--channel=preview` **PASS** |
| `eas.json` production | channel `production`, `autoIncrement`, `ascAppId` 6761693075 — **non exécuté** |
| Fallback `IOS_BUILD_NUMBER` local | corrigé **72 → 90** dans `app.config.ts` (évite collision locale ≤89 ; ne modifie pas le binaire publié) |

**Règle absolue :** une correction du code source ne modifie **jamais** le binaire App Store déjà publié. Seul un `eas update --channel production` avec le même `runtimeVersion` pourrait infecter 89 — désormais **bloqué** par le garde-fou tant que `runtimeVersion` reste `1.0.0`.

---

## B. Corrections réalisées (cette finalisation)

1. **`scripts/assert-store89-ota-freeze.mjs`** — garde-fou OTA store 89 (CI + blocage production).
2. **`package.json`** — `test:ci` démarre par le freeze ; scripts `ota:assert-store89-freeze` / `ota:block-production`.
3. **`app.config.ts`** — fallback `buildNumber` local `90` (après 89).
4. **`scripts/verify-paymentsheet-manual-session.mjs`** — vérifieur honnête (UI PASS seulement avec `--accept-pi` / `--decline-pi` explicites).
5. **Docs** — `STRIPE_US_PAYMENTSHEET_MANUAL_UI.md`, `CERTIFICATION_REMAINING_MATRIX.md` (cancel UI prouvé).

Aucun commit. Aucun push. Aucun EAS.

---

## C–E. Tests exécutés, preuves, non-régressions

### Stripe

| Test | Statut | Preuve |
|---|---|---|
| Clés test | **PASS** | `pk_test_…` / `sk_test_…` |
| API succeed / decline / cancel | **PASS** | `scripts/stripe-us-paymentsheet-cert.mjs` + `stripe-us-taxi-native-pi-cert.mjs` (`livemode=false`) |
| Montants / devise USD | **PASS** | PI taxi 2333–2788 USD |
| Idempotence / abandon / unpaid 409 | **PASS** | `taxiPaymentAbandonFlow.test.ts`, `applePayCheckout.test.ts` |
| Anti course non payée | **PASS** | 0 `taxi_rides` payées client E2E depuis fenêtre cert |
| Double paiement | **PASS** | `double_pay_guard` + 0 paid rides |
| PaymentSheet ouverte Android | **PASS** | `PaymentSheetActivity` + formulaire Card |
| Cancel UI PaymentSheet | **PASS** | Close sheet → PI `requires_payment_method`, 0 ride |
| Accept UI `4242` | **BLOCKED** | Champs sécurisés Stripe — saisie humaine |
| Decline UI `4000…0002` | **BLOCKED** | Idem |
| Confirm serveur post-UI | **BLOCKED** | Dépend saisie manuelle |

**Session manuelle unique (Android ou iPhone pk_test) :**

1. Taxi US → devis → Carte → sheet.  
2. `4242 4242 4242 4242` · exp future · CVC · ZIP US → Pay.  
3. Nouveau devis → `4000 0000 0000 0002` → constater refus.  
4. Vérifier : `node scripts/verify-paymentsheet-manual-session.mjs --accept-pi=pi_… --decline-pi=pi_…`

### iOS config (Windows — pas de Simulator)

| Test | Statut |
|---|---|
| Bundle / ios.version 1.0.1 / merchant / associatedDomains / BG location+push / 6 locales / Stripe plugin / scheme | **PASS** (config) |
| Cohérence pin ↔ HEAD identité store | **PASS** |
| Xcode / Simulator / device / Apple Pay réel / APNs réel / PaymentSheet iOS | **BLOCKED** |

### GPS

| Test | Statut |
|---|---|
| Autocomplete onSelect-only + cert-fill | **PASS** |
| `verifiedClientGps`, tracker, disclosure BG, abandon GPS AI | **PASS** |
| Permissions FG émulateur | **PASS** (`ACCESS_FINE/COARSE=granted`) |
| Refus permission (code paths) | **PASS** |
| GPS / BG / pin carte iPhone | **BLOCKED** |

### 8 rôles

| Rôle | Login+logout | Isolation |
|---|---|---|
| Client/Chauffeur/Restaurant/Vendeur GN | **PASS** | pending / non approuvés |
| Client + 3 pros US | **PASS** | `approved:false`, offline, dispatch-isolated |

Aucune approbation artificielle. Aucun nouveau compte.

### i18n / marchés

| Test | Statut |
|---|---|
| Coverage 6 langues + fullScreenI18n (103 routes) | **PASS** |
| RTL arabe (code `forceRTL`) | **PASS** (code) — **NOT TESTED** visuel device |
| GNF/USD, +224 comptes GN, +1 US normalize | **PASS** |
| Guest / marketplace seller / gates pro / checkout i18n | **PASS** |

### Sécurité / qualité

| Test | Statut |
|---|---|
| `secret-scan.mjs` | **PASS** (0 findings) |
| `pnpm test:ci` (batterie locale complète) | **PASS** (exit 0) |
| Stripe test-mode guards / presentCardPaymentSheet / taxi-us-cert-fill | **PASS** |
| Semgrep / CodeQL / ZAP remote CI | **NOT TESTED** cette passe (dépend GitHub Actions / push) |

---

## F. Problèmes restants (impossibles ici)

1. Saisie manuelle PaymentSheet accept + decline (Android ou iPhone).  
2. Toute validation runtime iOS (Xcode / device).  
3. Preuve visuelle RTL / overflow sur appareil.  
4. APNs + Apple Pay Wallet sandbox.  
5. CI distante Semgrep/CodeQL/ZAP sans push.  
6. Tant que `runtimeVersion=1.0.0`, **aucun** OTA production (garde-fou actif).

---

## G. Procédure exacte du prochain build de validation

**À n’exécuter qu’après autorisation explicite.** Profil recommandé : **`preview`** ou **`ios-simulator`** — **pas** `production` / submit.

```bash
# macOS
cd /path/to/MMD-Delivery
git rev-parse HEAD   # doit être le SHA autorisé
pnpm install
node scripts/assert-store89-ota-freeze.mjs
node scripts/assert-store89-ota-freeze.mjs --channel=production  # doit EXIT 1

# Confirmer pk_test dans l’env du profil preview (pas sk_live / pk_live)
cd apps/mobile

# Option A — simulateur (dev Mac)
npx expo prebuild --platform ios --clean
npx expo run:ios

# Option B — distribution interne (après OK fondateur)
# eas build --platform ios --profile ios-simulator
# eas build --platform ios --profile preview
```

**Interdit sans nouvel ordre :**  
`eas build --profile production` · `eas submit` · `eas update --channel production` · OTA quelconque vers le runtime 1.0.0 production.

Avant le **prochain** binaire App Store (après 89) : bumper `runtimeVersion` **puis seulement** envisager OTA production avec `MMD_ALLOW_PRODUCTION_OTA=1`.

Android validation actuelle = build **dev/pk_test** sur `emulator-5556`, distinct du store.

---

## H. Checklist unique iPhone (une seule session)

Build : **preview/pk_test** (pas App Store 89).

1. Boot → marché → rôle → login Client US → logout → relogin.  
2. Langues : en, fr, es, **ar (RTL)**, zh, ff — parcourir Accueil / Taxi / Réglages.  
3. GPS : accepter → coords OK ; refuser → message ; rouvrir Réglages.  
4. Taxi US : autocomplete + pin carte → lat/lng conservés → devis USD.  
5. PaymentSheet : cancel (si pas déjà) → **4242** → nouveau devis → **4000…0002**.  
6. Noter les `pi_` → lancer le vérifieur avec `--accept-pi` / `--decline-pi`.  
7. Apple Pay sandbox (si Wallet) : cancel / success / pas de double charge.  
8. Push test → notification reçue.  
9. Deep link `https://www.mmddelivery.com/...` + `mmddelivery://`.  
10. Login des 7 autres rôles ; vérifier pros **non** online / non dispatch public.  
11. Client GN : +224 / GNF / cash path smoke (pas de fausse course publique).  
12. Confirmer : pas d’OTA pendant la session ; binaire ≠ 89 si PaymentSheet natif.

---

## I. Conditions pour certification complète

Toutes doivent être **PASS** (jamais un BLOCKED promu) :

- [x] Build 89 intact + freeze OTA armed  
- [x] Stripe API succeed/decline/cancel + anti double-pay (test)  
- [x] Cancel PaymentSheet UI (Android)  
- [ ] Accept + decline PaymentSheet UI (manuel)  
- [x] 8 rôles login/logout + isolation  
- [x] i18n coverage + gates marchés  
- [x] `test:ci` local vert  
- [ ] Build validation iOS installé sur iPhone  
- [ ] Checklist H exécutée sur iPhone  
- [ ] Aucun FAIL ouvert  
- [ ] Autorisation fondateur pour tout publish ultérieur  

**Statut global aujourd’hui :** prêt technique Windows/Android pour build de validation ; certification complète **non** déclarable tant que PaymentSheet UI accept/decline + iPhone restent ouverts.
