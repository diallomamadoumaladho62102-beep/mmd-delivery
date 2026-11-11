# Proposition — comptes professionnels US isolés (certification)

**Statut :** comptes créés (2026-11-11) — non approuvés, non publics, hors dispatch.  
**Protection App Store :** build **1.0.1 / 89** (`3152ebf2`) — non concerné (comptes serveur uniquement).  
**Isolation code :** `US_ISOLATED_TEST_EMAILS` + `US_ISOLATED_TEST_USER_IDS` dans `guineaTestIsolation.ts`.

## Inventaire final (2026-11-11)

| Source | Résultat |
|---|---|
| `docs/production/final-certification.env` | `US_ISOLATED_*` **absents** ; seuls `GUINEA_ISOLATED_*` + `E2E_TEST_*` (client) sont SET |
| `final-certification.env.example` | Placeholders `US_ISOLATED_*` documentés, vides |
| Code isolation | `guineaTestIsolation.ts` liste uniquement `@example.com` Guinée — **pas d’équivalent US** |
| Recherche repo | Aucun email chauffeur/restaurant/vendeur US de cert trouvé |

**Conclusion :** aucun compte professionnel US isolé de certification n’est disponible aujourd’hui.

## Ce qui serait créé (après votre autorisation explicite)

| Rôle | Email proposé | Mot de passe |
|---|---|---|
| Chauffeur US | `us-cert-driver@example.com` | Généré localement (24+ chars), écrit **uniquement** dans `final-certification.env` (gitignored) |
| Restaurant US | `us-cert-restaurant@example.com` | Idem |
| Vendeur US | `us-cert-seller@example.com` | Idem |

Métadonnées Auth (proposées) :
- `user_metadata.cert_isolated = true`
- `user_metadata.cert_market = "US"`
- `email_confirm = true` (pas d’email réel envoyé via confirmation manuelle admin)
- `profiles.role` = `driver` | `restaurant` | `seller`

## Protections obligatoires (non négociables)

1. **Aucune approbation professionnelle** — `restaurant_profiles.status` reste non-`approved` ; vendeur non publié ; chauffeur non mis en ligne / hors dispatch public.  
2. **Aucune commande / course / listing public.** Smoke = login → shell d’accueil / setup → logout.  
3. **Aucun SMS / email marketing réel.**  
4. **Aucun secret prod modifié** (Stripe / webhooks / EAS).  
5. **Isolation :** ajouter les 3 emails + user ids à une liste `US_ISOLATED_TEST_*` miroir de Guinée (`isIsolatedFromLiveDispatch` / garde paiement) **avant** tout usage métier.  
6. **Visibilité :** tout artefact créé par erreur doit porter `is_test=true` + `hidden_from_user=true` (comme Guinée).  
7. **Restaurant ≠ Marketplace** — comptes et tables distincts.  
8. Script de création : dry-run d’abord ; création seulement avec flag `--i-authorize-us-cert-create`.

## Procédure demandée (après « OK créer »)

```text
1. Dry-run : afficher emails / rôles / protections (aucune écriture).
2. createUser admin (service role local) × 3 — email @example.com.
3. Upsert profiles.role uniquement (pas d’approval).
4. Écrire US_ISOLATED_* dans final-certification.env (local).
5. PR code : liste d’isolation US + tests de non-dispatch.
6. Smoke login-only sur emulator (3 rôles) — preuves UI.
7. Pas d’OTA / pas d’IPA store.
```

## Ce dont j’ai besoin de vous

Répondez explicitement par une des options :

- **A)** « Autorisé à créer les 3 comptes `us-cert-*@example.com` selon cette procédure »  
- **B)** « Utiliser plutôt ces comptes existants : … » (emails + mots de passe isolés)  
- **C)** « Ne pas créer — laisser BLOCKED »

Sans A ou B, les rôles US restent **BLOCKED**.
