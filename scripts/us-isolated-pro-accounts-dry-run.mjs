/**
 * Dry-run only: print the US isolated pro-account creation plan.
 * Never creates users. Never approves. Never prints passwords.
 *
 *   node scripts/us-isolated-pro-accounts-dry-run.mjs
 */
const plan = {
  mode: "dry-run",
  creates: false,
  store_build_protected: "1.0.1 / 89",
  accounts: [
    {
      role: "driver",
      email: "us-cert-driver@example.com",
      approval: "none",
      public_listing: false,
      go_online: false,
    },
    {
      role: "restaurant",
      email: "us-cert-restaurant@example.com",
      approval: "none — restaurant_profiles.status must stay non-approved",
      public_listing: false,
    },
    {
      role: "seller",
      email: "us-cert-seller@example.com",
      approval: "none — marketplace seller unpublished",
      public_listing: false,
    },
  ],
  protections: [
    "No professional approval",
    "No public restaurant/seller publish",
    "No live dispatch / fake drivers online",
    "No real SMS/email",
    "No Stripe live keys",
    "Passwords only in gitignored final-certification.env",
    "Add US isolation list (mirror Guinea) before any journey beyond login",
    "Smoke = login → home/setup shell → logout only",
  ],
  requires_founder_phrase:
    "Autorisé à créer les 3 comptes us-cert-*@example.com selon US_ISOLATED_PRO_ACCOUNTS_PROPOSAL.md",
  doc: "docs/production/US_ISOLATED_PRO_ACCOUNTS_PROPOSAL.md",
};

console.log(JSON.stringify(plan, null, 2));
