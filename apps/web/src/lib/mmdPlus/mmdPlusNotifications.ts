import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientGenericPush } from "@/lib/mmdPlus/mmdPlusPush";
import { notifyUserTransactional } from "@/lib/transactionalOutbound";

export type MmdPlusNotifyEvent =
  | "created"
  | "trial_started"
  | "trial_ended"
  | "payment_succeeded"
  | "payment_failed"
  | "renewed"
  | "expired"
  | "plan_changed"
  | "canceled";

const COPY: Record<
  MmdPlusNotifyEvent,
  { title: string; body: string; emailSubject: string; emailBody: string }
> = {
  created: {
    title: "MMD+ activé",
    body: "Votre abonnement MMD+ est actif. Profitez de vos avantages sur Food, Delivery, Taxi et Marketplace.",
    emailSubject: "Bienvenue sur MMD+",
    emailBody: "Votre abonnement MMD+ est maintenant actif.",
  },
  trial_started: {
    title: "Essai MMD+ commencé",
    body: "Votre période d'essai MMD+ a démarré. Découvrez tous vos avantages.",
    emailSubject: "Essai MMD+ commencé",
    emailBody: "Votre période d'essai MMD+ a commencé.",
  },
  trial_ended: {
    title: "Essai MMD+ terminé",
    body: "Votre essai MMD+ est terminé. Renouvelez pour conserver vos avantages.",
    emailSubject: "Essai MMD+ terminé",
    emailBody: "Votre essai MMD+ est terminé.",
  },
  payment_succeeded: {
    title: "Paiement MMD+ réussi",
    body: "Votre paiement MMD+ a été confirmé. Merci !",
    emailSubject: "Paiement MMD+ confirmé",
    emailBody: "Nous avons bien reçu votre paiement MMD+.",
  },
  payment_failed: {
    title: "Paiement MMD+ échoué",
    body: "Le paiement de votre abonnement MMD+ a échoué. Mettez à jour votre moyen de paiement.",
    emailSubject: "Paiement MMD+ échoué",
    emailBody: "Le paiement de votre abonnement MMD+ a échoué.",
  },
  renewed: {
    title: "MMD+ renouvelé",
    body: "Votre abonnement MMD+ a été renouvelé avec succès.",
    emailSubject: "MMD+ renouvelé",
    emailBody: "Votre abonnement MMD+ a été renouvelé.",
  },
  expired: {
    title: "MMD+ expiré",
    body: "Votre abonnement MMD+ a expiré. Réabonnez-vous pour retrouver vos avantages.",
    emailSubject: "MMD+ expiré",
    emailBody: "Votre abonnement MMD+ a expiré.",
  },
  plan_changed: {
    title: "Plan MMD+ modifié",
    body: "Votre plan MMD+ a été mis à jour.",
    emailSubject: "Plan MMD+ modifié",
    emailBody: "Votre plan MMD+ a été modifié.",
  },
  canceled: {
    title: "MMD+ annulé",
    body: "Votre abonnement MMD+ a été annulé. Vous conservez l'accès jusqu'à la fin de la période en cours si applicable.",
    emailSubject: "MMD+ annulé",
    emailBody: "Votre abonnement MMD+ a été annulé.",
  },
};

/** Best-effort notifications via existing push + transactional email. */
export async function notifyMmdPlusEvent(
  supabaseAdmin: SupabaseClient,
  params: { userId: string; event: MmdPlusNotifyEvent; detail?: string }
): Promise<void> {
  const copy = COPY[params.event];
  const body = params.detail ? `${copy.body} ${params.detail}` : copy.body;

  try {
    await notifyClientGenericPush({
      supabaseAdmin,
      userIds: [params.userId],
      title: copy.title,
      body,
      data: { type: `mmd_plus_${params.event}`, module: "mmd_plus" },
    });
  } catch (e) {
    console.warn("[mmd-plus] push notify failed", e instanceof Error ? e.message : e);
  }

  try {
    await notifyUserTransactional({
      supabaseAdmin,
      recipient: { userId: params.userId },
      subject: copy.emailSubject,
      body,
      html: `<p>${body}</p>`,
    });
  } catch (e) {
    console.warn("[mmd-plus] email notify failed", e instanceof Error ? e.message : e);
  }
}
