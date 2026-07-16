export type TransactionalEmailTemplate = {
  subject: string;
  previewText: string;
  headline: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderTransactionalEmailHtml(
  template: TransactionalEmailTemplate,
): string {
  const headline = escapeHtml(template.headline);
  const preview = escapeHtml(template.previewText);
  const cta =
    template.ctaLabel && template.ctaUrl
      ? `<p style="margin:28px 0 0;">
          <a href="${escapeHtml(template.ctaUrl)}"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;">
            ${escapeHtml(template.ctaLabel)}
          </a>
        </p>`
      : "";

  return `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${headline}</title>
  </head>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preview}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(135deg,#0f172a,#1d4ed8);color:#ffffff;">
                <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">MMD Delivery</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${headline}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;font-size:16px;line-height:1.6;">
                ${template.bodyHtml}
                ${cta}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 24px;font-size:12px;line-height:1.5;color:#64748b;background:#f8fafc;">
                MMD Delivery — livraison, courses et marketplace.<br />
                Besoin d'aide ? Répondez à cet email ou contactez le support dans l'application.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderTransactionalEmailText(
  template: TransactionalEmailTemplate,
): string {
  const lines = [template.headline, "", template.previewText];
  if (template.ctaLabel && template.ctaUrl) {
    lines.push("", `${template.ctaLabel}: ${template.ctaUrl}`);
  }
  lines.push("", "MMD Delivery");
  return lines.join("\n");
}

export function accountCreatedEmail(params: {
  name?: string | null;
}): TransactionalEmailTemplate {
  const name = String(params.name ?? "").trim();
  return {
    subject: "Bienvenue sur MMD Delivery",
    previewText: "Votre compte MMD Delivery est prêt.",
    headline: "Compte créé",
    bodyHtml: `<p>Bonjour${name ? ` ${escapeHtml(name)}` : ""},</p>
      <p>Votre compte MMD Delivery a bien été créé. Vous pouvez maintenant commander, suivre vos livraisons et communiquer avec les équipes en toute sécurité.</p>`,
    ctaLabel: "Ouvrir MMD Delivery",
    ctaUrl: "https://mmddelivery.com/download",
  };
}

export function orderConfirmationEmail(params: {
  orderId: string;
  restaurantName?: string | null;
}): TransactionalEmailTemplate {
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const restaurant = String(params.restaurantName ?? "votre restaurant").trim();
  return {
    subject: `Commande #${shortId} confirmée`,
    previewText: `Votre commande #${shortId} est confirmée.`,
    headline: "Commande confirmée",
    bodyHtml: `<p>Votre paiement a été reçu pour la commande <strong>#${escapeHtml(shortId)}</strong> chez ${escapeHtml(restaurant)}.</p>
      <p>Nous vous informerons dès qu'elle sera acceptée et prise en charge.</p>`,
    ctaLabel: "Suivre la commande",
    ctaUrl: `https://mmddelivery.com/orders/${encodeURIComponent(params.orderId)}`,
  };
}

export function orderAcceptedEmail(params: {
  orderId: string;
  prepMinutes?: number | null;
}): TransactionalEmailTemplate {
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const prep =
    params.prepMinutes && params.prepMinutes > 0
      ? `<p>Temps de préparation estimé : <strong>${params.prepMinutes} min</strong>.</p>`
      : "";
  return {
    subject: `Commande #${shortId} acceptée`,
    previewText: `Le restaurant a accepté votre commande #${shortId}.`,
    headline: "Commande acceptée",
    bodyHtml: `<p>Le restaurant a accepté votre commande <strong>#${escapeHtml(shortId)}</strong>.</p>${prep}`,
    ctaLabel: "Voir la commande",
    ctaUrl: `https://mmddelivery.com/orders/${encodeURIComponent(params.orderId)}`,
  };
}

export function orderCancelledEmail(params: {
  orderId: string;
  refund?: string | null;
}): TransactionalEmailTemplate {
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const refund = String(params.refund ?? "").trim();
  const refundLine =
    refund === "FULL" || refund === "REQUIRED"
      ? "<p>Un remboursement est en cours de traitement.</p>"
      : "";
  return {
    subject: `Commande #${shortId} annulée`,
    previewText: `Votre commande #${shortId} a été annulée.`,
    headline: "Commande annulée",
    bodyHtml: `<p>Votre commande <strong>#${escapeHtml(shortId)}</strong> a été annulée.</p>${refundLine}`,
  };
}

export function driverApprovedEmail(): TransactionalEmailTemplate {
  return {
    subject: "Compte chauffeur validé",
    previewText: "Votre compte chauffeur MMD Delivery est approuvé.",
    headline: "Chauffeur validé",
    bodyHtml:
      "<p>Félicitations ! Votre compte chauffeur a été validé par l'équipe MMD Delivery. Vous pouvez maintenant passer en ligne et accepter des missions.</p>",
    ctaLabel: "Ouvrir l'app chauffeur",
    ctaUrl: "https://mmddelivery.com/download",
  };
}

export function restaurantApprovedEmail(params: {
  restaurantName?: string | null;
}): TransactionalEmailTemplate {
  const name = escapeHtml(String(params.restaurantName ?? "Votre restaurant").trim());
  return {
    subject: "Restaurant validé sur MMD Delivery",
    previewText: "Votre restaurant est approuvé sur MMD Delivery.",
    headline: "Restaurant validé",
    bodyHtml: `<p><strong>${name}</strong> est maintenant approuvé sur MMD Delivery. Vous pouvez recevoir et gérer vos commandes.</p>`,
    ctaLabel: "Ouvrir le centre restaurant",
    ctaUrl: "https://mmddelivery.com/restaurant/profile",
  };
}

export function sellerApprovedEmail(params: {
  businessName?: string | null;
}): TransactionalEmailTemplate {
  const name = escapeHtml(String(params.businessName ?? "Votre boutique").trim());
  return {
    subject: "Boutique marketplace validée",
    previewText: "Votre boutique marketplace est approuvée.",
    headline: "Vendeur validé",
    bodyHtml: `<p><strong>${name}</strong> est maintenant approuvée sur le marketplace MMD Delivery.</p>`,
    ctaLabel: "Ouvrir le tableau vendeur",
    ctaUrl: "https://mmddelivery.com/seller",
  };
}

export function passwordResetEmail(params: {
  resetUrl: string;
}): TransactionalEmailTemplate {
  return {
    subject: "Réinitialisation de votre mot de passe",
    previewText: "Réinitialisez votre mot de passe MMD Delivery.",
    headline: "Mot de passe oublié",
    bodyHtml:
      "<p>Nous avons reçu une demande de réinitialisation de mot de passe. Si vous êtes à l'origine de cette demande, utilisez le bouton ci-dessous.</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>",
    ctaLabel: "Réinitialiser le mot de passe",
    ctaUrl: params.resetUrl,
  };
}

export function teamInvitationEmail(params: {
  inviteeName?: string | null;
  invitedBy?: string | null;
}): TransactionalEmailTemplate {
  const invitee = String(params.inviteeName ?? "").trim();
  const invitedBy = String(params.invitedBy ?? "l'équipe MMD").trim();
  return {
    subject: "Invitation équipe MMD Delivery",
    previewText: "Vous êtes invité à rejoindre MMD Delivery.",
    headline: "Invitation équipe",
    bodyHtml: `<p>Bonjour${invitee ? ` ${escapeHtml(invitee)}` : ""},</p>
      <p>${escapeHtml(invitedBy)} vous invite à rejoindre MMD Delivery. Connectez-vous pour activer votre accès.</p>`,
    ctaLabel: "Rejoindre MMD Delivery",
    ctaUrl: "https://mmddelivery.com/auth/sign-in",
  };
}
