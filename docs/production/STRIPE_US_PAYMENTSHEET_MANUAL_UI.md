# Stripe US — procédure manuelle PaymentSheet (sk_test only)

**Référence App Store à protéger :** version **1.0.1**, build **89**, commit `3152ebf28d4da7eb648827c64a7f0a6130dec8c3`.  
**Ne pas** publier OTA / nouvel IPA / secrets live pour cette procédure.  
**Binaire store 89 :** carte taxi = Checkout **navigateur** — ne pas le remplacer. Cette procédure cible un build **dev / pk_test** (HEAD `a811101f`+).

Objectif : prouver accept / refus / annulation **dans la sheet native** (ADB ne peut pas fiabiliser les champs sécurisés Stripe).

## Prérequis (vérifiés côté agent)

- Mobile `EXPO_PUBLIC_STRIPE_PK` = **`pk_test`**
- Backend local / cert = **`sk_test`**
- Compte client E2E US existant (pas de création)
- Émulateur `emulator-5556` ou appareil de test
- Metro / app avec code HEAD (PaymentSheet) — pas l’IPA App Store

## Chemin taxi US (UI française actuelle)

1. Client → Accueil → **Taxi**.
2. Pastille marché **US** (libellé « Estimation en USD »).
3. Adresses (une des options) :
   - **`__DEV__` :** bouton **Load US cert addresses** / équivalent i18n — charge coords NYC.
   - **Sinon :** saisie manuelle puis **Épingler … sur la carte** pour fixer lat/lng, **ou** sélection Mapbox (ne pas retaper après sélection — coords conservées depuis `a811101f`).
4. Route cert de référence :
   - Pickup : autour de `40.7128, -74.0060` (ex. Lower Manhattan)
   - Dropoff : autour de `40.7484, -73.9857` (ex. Empire State area)
5. **Obtenir un devis** / Get estimate.
6. Sur l’écran devis → faire défiler → **Carte bancaire**.
7. PaymentSheet s’ouvre (Sandbox). Si **Link** (`checkout.link.com`) apparaît : **Retour** puis choisir **Card**.
8. Formulaire attendu : `Card number` · CVC · ZIP Code · Pay $…  

**Preuve agent 2026-11-11 (emulator-5556, pk_test) :** devis US **23,33 $US** · sheet ouverte · formulaire Card visible. Accept/refus = saisie manuelle (ADB insecure).

## Cas à valider (saisie **manuelle** dans la sheet)

| # | Cas | Carte | Attendu | Preuve |
|---|---|---|---|---|
| 1 | Annulation | (aucune) | Fermer / Cancel avant Pay | Sheet fermée ; pas de PI `succeeded` |
| 2 | Acceptation | `4242 4242 4242 4242` · exp future · CVC · ZIP US | Succès ; confirm serveur ; course ou message « pending confirm » ; **`livemode=false`** | Capture + `pi_…` Dashboard **Test** |
| 3 | Refus | `4000 0000 0000 0002` · mêmes infos | Refus carte ; **aucune** course payée | Capture erreur declined + PI non succeeded |

Ordre recommandé : **1 → 2 → 3** (cancel d’abord, puis nouveau devis pour chaque carte).

## Checklist opérateur (cocher)

- [ ] Build = pk_test (pas App Store 89)
- [ ] Marché US / USD
- [ ] Coords pickup + dropoff présentes
- [ ] Sheet ouverte
- [ ] Cancel PASS
- [ ] 4242 PASS (`livemode=false`)
- [ ] 4000…0002 PASS (declined)
- [ ] Aucun OTA pendant le test

## Preuves API déjà vertes (ne pas rejouer sans cause)

`node scripts/stripe-us-paymentsheet-cert.mjs` — succeed / decline / cancel + Cash GN smoke (**PASS**, sk_test).

## Interdits

- Clés / webhooks Stripe **live**
- Modifier le Checkout navigateur du binaire **89**
- Approuver des pros / commandes publiques
- Forcer un correctif app uniquement pour contourner ADB
