# Stripe US — procédure manuelle PaymentSheet (sk_test only)

**Référence App Store à protéger :** version **1.0.1**, build **89**, commit `3152ebf28d4da7eb648827c64a7f0a6130dec8c3`.  
**Ne pas** publier OTA / nouvel IPA / secrets live pour cette procédure.

Objectif : prouver accept / refus / annulation **dans la sheet native** quand l’automation ADB ne peut pas taper les champs sécurisés Stripe.

## Prérequis

- Build mobile avec **`pk_test`** (dev client / preview / Expo local) — pas le binaire store live.
- Backend local ou preview avec **`sk_test`** uniquement.
- Compte client E2E US existant (pas de création / pas de mutation de profil).
- Cartes Stripe test uniquement (jamais de vraie carte).

## Chemin taxi US (cert)

1. Ouvrir l’app → rôle Client → marché **US**.
2. Accueil Taxi. En `__DEV__`, utiliser **Load US cert addresses** si présent.
3. **Get estimate** → écran devis → **Pay with card**.
4. Vérifier ouverture PaymentSheet (déjà validé : open PASS).

## Cas à valider (saisie manuelle dans la sheet)

| Cas | Carte | Attendu |
|---|---|---|
| Acceptation | `4242 4242 4242 4242` · exp future · CVC quelconque · ZIP US | Paiement accepté ; confirm serveur ; **pas** `livemode=true` |
| Refus | `4000 0000 0000 0002` · mêmes infos | Refus carte ; aucune course créée comme payée |
| Annulation | Ouvrir la sheet → fermer / Cancel avant confirm | Sheet fermée ; pas de PaymentIntent succeeded |

## Preuves à conserver

- Capture sheet ouverte + résultat (succès / declined / canceled).
- IDs PaymentIntent test (`pi_…`) depuis Stripe Dashboard **test mode**.
- Confirmer que le binaire App Store 89 n’a **pas** reçu d’OTA pendant le test.

## Interdits

- Modifier `app.json` / merchant / webhooks prod / clés live.
- Remplacer le Checkout navigateur du build 89 « pour faciliter le test ».
- Approuver des pros fictifs ou créer des commandes live.
