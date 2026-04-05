# MMD Delivery – Monorepo Starter (Next.js + Expo + Supabase)

## Prérequis
- Node.js >= 18
- pnpm (ou npm/yarn)
- Compte Supabase + projet Postgres
- Compte Stripe (paiements) – mode test
- Clé Mapbox (affichage carte / géocodage)

## Installation rapide
1. Installe les dépendances à la racine :
   ```bash
   pnpm install # ou npm install
   ```
2. Crée un projet Supabase, récupère les variables et copie `.env.example` en `.env` (à la racine et dans `apps/web/.env.local` et `apps/mobile/.env` si nécessaire)
3. Applique le schéma SQL :
   ```bash
   # Installe l'outil CLI supabase sur ton PC si besoin
   # puis applique :
   supabase db push --file supabase/schema.sql
   supabase db push --file supabase/policies.sql
   ```
4. Lance le web (Next.js) :
   ```bash
   cd apps/web && pnpm dev
   ```
5. Lance le mobile (Expo) :
   ```bash
   cd apps/mobile && pnpm start
   ```

## Déploiement
- Web : Vercel
- Backend : Supabase (DB/Auth/Storage/Realtime)
- Mobile : Expo (EAS build en prod)
