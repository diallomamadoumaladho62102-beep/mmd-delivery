import {
  formatSocialLinksPlainText,
  getActiveSocialLinks,
} from "@mmd/social-links";
import { htmlLangForLocale, normalizeAppLocale, type AppLocale } from "./userLocale";

export type TransactionalEmailTemplate = {
  subject: string;
  previewText: string;
  headline: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  locale?: AppLocale;
};

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function socialFooterHtml(): string {
  const links = getActiveSocialLinks()
    .map(
      (link, index) =>
        `${index > 0 ? "&nbsp;·&nbsp;" : ""}<a href="${escapeHtml(link.url)}" style="color:#ea580c;text-decoration:none;">${escapeHtml(link.label)}</a>`,
    )
    .join("");
  return links
    ? `<span style="display:inline-block;margin-top:8px;">${links}</span>`
    : "";
}

export function renderTransactionalEmailHtml(
  template: TransactionalEmailTemplate,
): string {
  const locale = normalizeAppLocale(template.locale);
  const headline = escapeHtml(template.headline);
  const preview = escapeHtml(template.previewText);
  const cta =
    template.ctaLabel && template.ctaUrl
      ? `<p style="margin:28px 0 0;">
          <a href="${escapeHtml(template.ctaUrl)}"
             style="display:inline-block;background:#f97316;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:700;">
            ${escapeHtml(template.ctaLabel)}
          </a>
        </p>`
      : "";

  return `<!DOCTYPE html>
<html lang="${htmlLangForLocale(locale)}" dir="${locale === "ar" ? "rtl" : "ltr"}">
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
              <td style="padding:24px 28px;background:#0f172a;color:#ffffff;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding-right:14px;">
                      <img src="https://www.mmddelivery.com/brand/email-logo-transparent-v2.png"
                           width="64" height="64" alt="MMD Delivery"
                           style="display:block;width:64px;height:64px;border-radius:14px;" />
                    </td>
                    <td>
                      <div style="font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#fb923c;">MMD Delivery</div>
                      <div style="margin-top:4px;font-size:12px;color:#cbd5e1;">We Deliver With Heart</div>
                    </td>
                  </tr>
                </table>
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
                Besoin d'aide ? Répondez à cet email ou contactez le support dans l'application.<br />
                ${socialFooterHtml()}
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
  lines.push("", "MMD Delivery", formatSocialLinksPlainText());
  return lines.join("\n");
}

export function accountCreatedEmail(params: {
  name?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const name = String(params.name ?? "").trim();
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; hello: string; body: string; cta: string }> = {
    en: { subject: "Welcome to MMD Delivery", preview: "Your MMD Delivery account is ready.", headline: "Account created", hello: "Hello", body: "Your MMD Delivery account was created. You can now order, track deliveries, and message teams securely.", cta: "Open MMD Delivery" },
    fr: { subject: "Bienvenue sur MMD Delivery", preview: "Votre compte MMD Delivery est prêt.", headline: "Compte créé", hello: "Bonjour", body: "Votre compte MMD Delivery a bien été créé. Vous pouvez maintenant commander, suivre vos livraisons et communiquer avec les équipes en toute sécurité.", cta: "Ouvrir MMD Delivery" },
    es: { subject: "Bienvenido a MMD Delivery", preview: "Tu cuenta de MMD Delivery está lista.", headline: "Cuenta creada", hello: "Hola", body: "Tu cuenta de MMD Delivery se creó. Ya puedes pedir, seguir entregas y escribir al equipo de forma segura.", cta: "Abrir MMD Delivery" },
    ar: { subject: "مرحبًا بك في MMD Delivery", preview: "حسابك جاهز.", headline: "تم إنشاء الحساب", hello: "مرحبًا", body: "تم إنشاء حسابك في MMD Delivery. يمكنك الآن الطلب وتتبع التوصيل والتواصل بأمان.", cta: "فتح MMD Delivery" },
    zh: { subject: "欢迎使用 MMD Delivery", preview: "您的账户已就绪。", headline: "账户已创建", hello: "您好", body: "您的 MMD Delivery 账户已创建。现在可以下单、跟踪配送并安全联系团队。", cta: "打开 MMD Delivery" },
    ff: { subject: "A jaɓɓaama e MMD Delivery", preview: "Account maa hebiima.", headline: "Account sosaama", hello: "Jam", body: "Account MMD Delivery maa sosaama. A waawi jooni soodde, rewde livraison e winndude e kippu e kisal.", cta: "Uddit MMD Delivery" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${escapeHtml(t.hello)}${name ? ` ${escapeHtml(name)}` : ""},</p>
      <p>${escapeHtml(t.body)}</p>`,
    ctaLabel: t.cta,
    ctaUrl: "https://mmddelivery.com/download",
  };
}

export function orderConfirmationEmail(params: {
  orderId: string;
  restaurantName?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const fallbackRestaurant: Record<AppLocale, string> = {
    en: "your restaurant",
    fr: "votre restaurant",
    es: "tu restaurante",
    ar: "مطعمك",
    zh: "您的餐厅",
    ff: "restoran maa",
  };
  const restaurant = String(params.restaurantName ?? fallbackRestaurant[locale]).trim();
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; paid: string; next: string; cta: string }> = {
    en: { subject: `Order #${shortId} confirmed`, preview: `Your order #${shortId} is confirmed.`, headline: "Order confirmed", paid: `Your payment was received for order <strong>#${escapeHtml(shortId)}</strong> at ${escapeHtml(restaurant)}.`, next: "We will notify you as soon as it is accepted and picked up.", cta: "Track order" },
    fr: { subject: `Commande #${shortId} confirmée`, preview: `Votre commande #${shortId} est confirmée.`, headline: "Commande confirmée", paid: `Votre paiement a été reçu pour la commande <strong>#${escapeHtml(shortId)}</strong> chez ${escapeHtml(restaurant)}.`, next: "Nous vous informerons dès qu'elle sera acceptée et prise en charge.", cta: "Suivre la commande" },
    es: { subject: `Pedido #${shortId} confirmado`, preview: `Tu pedido #${shortId} está confirmado.`, headline: "Pedido confirmado", paid: `Recibimos tu pago del pedido <strong>#${escapeHtml(shortId)}</strong> en ${escapeHtml(restaurant)}.`, next: "Te avisaremos cuando sea aceptado y recogido.", cta: "Seguir pedido" },
    ar: { subject: `تم تأكيد الطلب #${shortId}`, preview: `تم تأكيد طلبك #${shortId}.`, headline: "تم تأكيد الطلب", paid: `تم استلام دفعتك للطلب <strong>#${escapeHtml(shortId)}</strong> لدى ${escapeHtml(restaurant)}.`, next: "سنُعلمك فور قبوله واستلامه.", cta: "تتبع الطلب" },
    zh: { subject: `订单 #${shortId} 已确认`, preview: `您的订单 #${shortId} 已确认。`, headline: "订单已确认", paid: `已收到订单 <strong>#${escapeHtml(shortId)}</strong> 在 ${escapeHtml(restaurant)} 的付款。`, next: "接受并取件后我们会通知您。", cta: "跟踪订单" },
    ff: { subject: `Odaare #${shortId} jaɓaama`, preview: `Odaare maa #${shortId} jaɓaama.`, headline: "Odaare jaɓaama", paid: `Yoɓgol maa jaɓaama e odaare <strong>#${escapeHtml(shortId)}</strong> to ${escapeHtml(restaurant)}.`, next: "Min njettoto maa so jaɓaama e ƴettaama.", cta: "Rew odaare" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.paid}</p><p>${t.next}</p>`,
    ctaLabel: t.cta,
    ctaUrl: `https://mmddelivery.com/orders/${encodeURIComponent(params.orderId)}`,
  };
}

export function orderAcceptedEmail(params: {
  orderId: string;
  prepMinutes?: number | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const prepCopy: Record<AppLocale, string> = {
    en: `Estimated prep time: <strong>${params.prepMinutes} min</strong>.`,
    fr: `Temps de préparation estimé : <strong>${params.prepMinutes} min</strong>.`,
    es: `Tiempo de preparación estimado: <strong>${params.prepMinutes} min</strong>.`,
    ar: `وقت التحضير التقريبي: <strong>${params.prepMinutes} د</strong>.`,
    zh: `预计备餐时间：<strong>${params.prepMinutes} 分钟</strong>。`,
    ff: `Waktu gardo: <strong>${params.prepMinutes} min</strong>.`,
  };
  const prep =
    params.prepMinutes && params.prepMinutes > 0 ? `<p>${prepCopy[locale]}</p>` : "";
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string; cta: string }> = {
    en: { subject: `Order #${shortId} accepted`, preview: `The restaurant accepted your order #${shortId}.`, headline: "Order accepted", body: `The restaurant accepted your order <strong>#${escapeHtml(shortId)}</strong>.`, cta: "View order" },
    fr: { subject: `Commande #${shortId} acceptée`, preview: `Le restaurant a accepté votre commande #${shortId}.`, headline: "Commande acceptée", body: `Le restaurant a accepté votre commande <strong>#${escapeHtml(shortId)}</strong>.`, cta: "Voir la commande" },
    es: { subject: `Pedido #${shortId} aceptado`, preview: `El restaurante aceptó tu pedido #${shortId}.`, headline: "Pedido aceptado", body: `El restaurante aceptó tu pedido <strong>#${escapeHtml(shortId)}</strong>.`, cta: "Ver pedido" },
    ar: { subject: `تم قبول الطلب #${shortId}`, preview: `قبل المطعم طلبك #${shortId}.`, headline: "تم قبول الطلب", body: `قبل المطعم طلبك <strong>#${escapeHtml(shortId)}</strong>.`, cta: "عرض الطلب" },
    zh: { subject: `订单 #${shortId} 已接受`, preview: `餐厅已接受您的订单 #${shortId}。`, headline: "订单已接受", body: `餐厅已接受您的订单 <strong>#${escapeHtml(shortId)}</strong>。`, cta: "查看订单" },
    ff: { subject: `Odaare #${shortId} jaɓaama`, preview: `Restoran jaɓii odaare maa #${shortId}.`, headline: "Odaare jaɓaama", body: `Restoran jaɓii odaare maa <strong>#${escapeHtml(shortId)}</strong>.`, cta: "Yiy odaare" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.body}</p>${prep}`,
    ctaLabel: t.cta,
    ctaUrl: `https://mmddelivery.com/orders/${encodeURIComponent(params.orderId)}`,
  };
}

export function orderCancelledEmail(params: {
  orderId: string;
  refund?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const refund = String(params.refund ?? "").trim();
  const refundLineCopy: Record<AppLocale, string> = {
    en: "<p>A refund is being processed.</p>",
    fr: "<p>Un remboursement est en cours de traitement.</p>",
    es: "<p>Se está procesando un reembolso.</p>",
    ar: "<p>جارٍ معالجة استرداد المبلغ.</p>",
    zh: "<p>正在处理退款。</p>",
    ff: "<p>Nattinal njoɓdi ina yahra.</p>",
  };
  const refundLine =
    refund === "FULL" || refund === "REQUIRED" ? refundLineCopy[locale] : "";
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string }> = {
    en: { subject: `Order #${shortId} cancelled`, preview: `Your order #${shortId} was cancelled.`, headline: "Order cancelled", body: `Your order <strong>#${escapeHtml(shortId)}</strong> was cancelled.` },
    fr: { subject: `Commande #${shortId} annulée`, preview: `Votre commande #${shortId} a été annulée.`, headline: "Commande annulée", body: `Votre commande <strong>#${escapeHtml(shortId)}</strong> a été annulée.` },
    es: { subject: `Pedido #${shortId} cancelado`, preview: `Tu pedido #${shortId} fue cancelado.`, headline: "Pedido cancelado", body: `Tu pedido <strong>#${escapeHtml(shortId)}</strong> fue cancelado.` },
    ar: { subject: `تم إلغاء الطلب #${shortId}`, preview: `تم إلغاء طلبك #${shortId}.`, headline: "تم إلغاء الطلب", body: `تم إلغاء طلبك <strong>#${escapeHtml(shortId)}</strong>.` },
    zh: { subject: `订单 #${shortId} 已取消`, preview: `您的订单 #${shortId} 已取消。`, headline: "订单已取消", body: `您的订单 <strong>#${escapeHtml(shortId)}</strong> 已取消。` },
    ff: { subject: `Odaare #${shortId} haaltinaama`, preview: `Odaare maa #${shortId} haaltinaama.`, headline: "Odaare haaltinaama", body: `Odaare maa <strong>#${escapeHtml(shortId)}</strong> haaltinaama.` },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.body}</p>${refundLine}`,
  };
}

export function driverApprovedEmail(params?: {
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params?.locale);
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string; cta: string }> = {
    en: { subject: "Driver account approved", preview: "Your MMD Delivery driver account is approved.", headline: "Driver approved", body: "Congratulations! Your driver account was approved by the MMD Delivery team. You can now go online and accept missions.", cta: "Open driver app" },
    fr: { subject: "Compte chauffeur validé", preview: "Votre compte chauffeur MMD Delivery est approuvé.", headline: "Chauffeur validé", body: "Félicitations ! Votre compte chauffeur a été validé par l'équipe MMD Delivery. Vous pouvez maintenant passer en ligne et accepter des missions.", cta: "Ouvrir l'app chauffeur" },
    es: { subject: "Cuenta de conductor aprobada", preview: "Tu cuenta de conductor MMD Delivery está aprobada.", headline: "Conductor aprobado", body: "¡Enhorabuena! El equipo de MMD Delivery aprobó tu cuenta de conductor. Ya puedes conectarte y aceptar misiones.", cta: "Abrir app de conductor" },
    ar: { subject: "تمت الموافقة على حساب السائق", preview: "حساب السائق معتمد.", headline: "تمت الموافقة على السائق", body: "تهانينا! وافق فريق MMD Delivery على حساب السائق. يمكنك الآن الاتصال وقبول المهام.", cta: "فتح تطبيق السائق" },
    zh: { subject: "司机账户已通过", preview: "您的 MMD Delivery 司机账户已获批。", headline: "司机已通过", body: "恭喜！MMD Delivery 团队已批准您的司机账户。现在可以上线并接单。", cta: "打开司机应用" },
    ff: { subject: "Account driwer jaɓaama", preview: "Account driwer MMD Delivery maa jaɓaama.", headline: "Driwer jaɓaama", body: "A jaaraama! Kippu MMD Delivery jaɓii account driwer maa. A waawi jooni naatde e jaɓde golle.", cta: "Uddit app driwer" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${escapeHtml(t.body)}</p>`,
    ctaLabel: t.cta,
    ctaUrl: "https://mmddelivery.com/download",
  };
}

export function restaurantApprovedEmail(params: {
  restaurantName?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const fallback: Record<AppLocale, string> = {
    en: "Your restaurant",
    fr: "Votre restaurant",
    es: "Tu restaurante",
    ar: "مطعمك",
    zh: "您的餐厅",
    ff: "Restoran maa",
  };
  const name = escapeHtml(String(params.restaurantName ?? fallback[locale]).trim());
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string; cta: string }> = {
    en: { subject: "Restaurant approved on MMD Delivery", preview: "Your restaurant is approved on MMD Delivery.", headline: "Restaurant approved", body: `<strong>${name}</strong> is now approved on MMD Delivery. You can receive and manage your orders.`, cta: "Open restaurant hub" },
    fr: { subject: "Restaurant validé sur MMD Delivery", preview: "Votre restaurant est approuvé sur MMD Delivery.", headline: "Restaurant validé", body: `<strong>${name}</strong> est maintenant approuvé sur MMD Delivery. Vous pouvez recevoir et gérer vos commandes.`, cta: "Ouvrir le centre restaurant" },
    es: { subject: "Restaurante aprobado en MMD Delivery", preview: "Tu restaurante está aprobado en MMD Delivery.", headline: "Restaurante aprobado", body: `<strong>${name}</strong> ya está aprobado en MMD Delivery. Puedes recibir y gestionar tus pedidos.`, cta: "Abrir centro de restaurante" },
    ar: { subject: "تمت الموافقة على المطعم في MMD Delivery", preview: "مطعمك معتمد على MMD Delivery.", headline: "تمت الموافقة على المطعم", body: `أصبح <strong>${name}</strong> معتمدًا على MMD Delivery. يمكنك استلام الطلبات وإدارتها.`, cta: "فتح مركز المطعم" },
    zh: { subject: "餐厅已在 MMD Delivery 通过审核", preview: "您的餐厅已在 MMD Delivery 获批。", headline: "餐厅已通过", body: `<strong>${name}</strong> 现已在 MMD Delivery 获批。您可以接收并管理订单。`, cta: "打开餐厅中心" },
    ff: { subject: "Restoran jaɓaama e MMD Delivery", preview: "Restoran maa jaɓaama e MMD Delivery.", headline: "Restoran jaɓaama", body: `<strong>${name}</strong> jaɓaama e MMD Delivery. A waawi heɓde e toppitaade odaare maa.`, cta: "Uddit nokku restoran" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.body}</p>`,
    ctaLabel: t.cta,
    ctaUrl: "https://mmddelivery.com/restaurant/profile",
  };
}

export function sellerApprovedEmail(params: {
  businessName?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const fallback: Record<AppLocale, string> = {
    en: "Your store",
    fr: "Votre boutique",
    es: "Tu tienda",
    ar: "متجرك",
    zh: "您的店铺",
    ff: "Dukaan maa",
  };
  const name = escapeHtml(String(params.businessName ?? fallback[locale]).trim());
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string; cta: string }> = {
    en: { subject: "Marketplace store approved", preview: "Your marketplace store is approved.", headline: "Seller approved", body: `<strong>${name}</strong> is now approved on the MMD Delivery marketplace.`, cta: "Open seller dashboard" },
    fr: { subject: "Boutique marketplace validée", preview: "Votre boutique marketplace est approuvée.", headline: "Vendeur validé", body: `<strong>${name}</strong> est maintenant approuvée sur le marketplace MMD Delivery.`, cta: "Ouvrir le tableau vendeur" },
    es: { subject: "Tienda de marketplace aprobada", preview: "Tu tienda de marketplace está aprobada.", headline: "Vendedor aprobado", body: `<strong>${name}</strong> ya está aprobada en el marketplace de MMD Delivery.`, cta: "Abrir panel de vendedor" },
    ar: { subject: "تمت الموافقة على متجر السوق", preview: "متجرك في السوق معتمد.", headline: "تمت الموافقة على البائع", body: `أصبح <strong>${name}</strong> معتمدًا في سوق MMD Delivery.`, cta: "فتح لوحة البائع" },
    zh: { subject: "商城店铺已通过", preview: "您的商城店铺已获批。", headline: "卖家已通过", body: `<strong>${name}</strong> 现已在 MMD Delivery 商城获批。`, cta: "打开卖家后台" },
    ff: { subject: "Dukaan marketplace jaɓaama", preview: "Dukaan marketplace maa jaɓaama.", headline: "Jeeyoowo jaɓaama", body: `<strong>${name}</strong> jaɓaama e marketplace MMD Delivery.`, cta: "Uddit tableau jeeyoowo" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${t.body}</p>`,
    ctaLabel: t.cta,
    ctaUrl: "https://mmddelivery.com/seller",
  };
}

export function passwordResetEmail(params: {
  resetUrl: string;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; asked: string; ignore: string; cta: string }> = {
    en: { subject: "Reset your password", preview: "Reset your MMD Delivery password.", headline: "Forgot password", asked: "We received a password reset request. If you made this request, use the button below.", ignore: "If you did not request this, ignore this email.", cta: "Reset password" },
    fr: { subject: "Réinitialisation de votre mot de passe", preview: "Réinitialisez votre mot de passe MMD Delivery.", headline: "Mot de passe oublié", asked: "Nous avons reçu une demande de réinitialisation de mot de passe. Si vous êtes à l'origine de cette demande, utilisez le bouton ci-dessous.", ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.", cta: "Réinitialiser le mot de passe" },
    es: { subject: "Restablece tu contraseña", preview: "Restablece tu contraseña de MMD Delivery.", headline: "Contraseña olvidada", asked: "Recibimos una solicitud para restablecer la contraseña. Si fuiste tú, usa el botón de abajo.", ignore: "Si no lo solicitaste, ignora este correo.", cta: "Restablecer contraseña" },
    ar: { subject: "إعادة تعيين كلمة المرور", preview: "أعد تعيين كلمة مرور MMD Delivery.", headline: "نسيت كلمة المرور", asked: "تلقينا طلب إعادة تعيين كلمة المرور. إذا كنت أنت من طلب ذلك، استخدم الزر أدناه.", ignore: "إذا لم تطلب ذلك، تجاهل هذا البريد.", cta: "إعادة تعيين كلمة المرور" },
    zh: { subject: "重置密码", preview: "重置您的 MMD Delivery 密码。", headline: "忘记密码", asked: "我们收到了密码重置请求。如果是您本人操作，请使用下方按钮。", ignore: "如果不是您发起的，请忽略此邮件。", cta: "重置密码" },
    ff: { subject: "Hesɗin finnde maa", preview: "Hesɗin finnde MMD Delivery maa.", headline: "Finnde yejjitaama", asked: "Min njeɓii ɗaɓɓitannde hesɗitinal finnde. So ko aan wiɗi ɗum, huutoro butoŋ oo les.", ignore: "So wonaa aan wiɗi ɗum, accu ndee iimeel.", cta: "Hesɗin finnde" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${escapeHtml(t.asked)}</p><p>${escapeHtml(t.ignore)}</p>`,
    ctaLabel: t.cta,
    ctaUrl: params.resetUrl,
  };
}

export function teamInvitationEmail(params: {
  inviteeName?: string | null;
  invitedBy?: string | null;
  locale?: AppLocale | string | null;
}): TransactionalEmailTemplate {
  const locale = normalizeAppLocale(params.locale);
  const invitee = String(params.inviteeName ?? "").trim();
  const fallbackInviter: Record<AppLocale, string> = {
    en: "the MMD team",
    fr: "l'équipe MMD",
    es: "el equipo MMD",
    ar: "فريق MMD",
    zh: "MMD 团队",
    ff: "kippu MMD",
  };
  const invitedBy = String(params.invitedBy ?? fallbackInviter[locale]).trim();
  const hello: Record<AppLocale, string> = {
    en: "Hello",
    fr: "Bonjour",
    es: "Hola",
    ar: "مرحبًا",
    zh: "您好",
    ff: "Jam",
  };
  const copy: Record<AppLocale, { subject: string; preview: string; headline: string; body: string; cta: string }> = {
    en: { subject: "MMD Delivery team invitation", preview: "You are invited to join MMD Delivery.", headline: "Team invitation", body: `${escapeHtml(invitedBy)} invited you to join MMD Delivery. Sign in to activate your access.`, cta: "Join MMD Delivery" },
    fr: { subject: "Invitation équipe MMD Delivery", preview: "Vous êtes invité à rejoindre MMD Delivery.", headline: "Invitation équipe", body: `${escapeHtml(invitedBy)} vous invite à rejoindre MMD Delivery. Connectez-vous pour activer votre accès.`, cta: "Rejoindre MMD Delivery" },
    es: { subject: "Invitación al equipo MMD Delivery", preview: "Estás invitado a unirte a MMD Delivery.", headline: "Invitación de equipo", body: `${escapeHtml(invitedBy)} te invita a unirte a MMD Delivery. Inicia sesión para activar tu acceso.`, cta: "Unirse a MMD Delivery" },
    ar: { subject: "دعوة فريق MMD Delivery", preview: "تمت دعوتك للانضمام إلى MMD Delivery.", headline: "دعوة الفريق", body: `يدعوك ${escapeHtml(invitedBy)} للانضمام إلى MMD Delivery. سجّل الدخول لتفعيل وصولك.`, cta: "الانضمام إلى MMD Delivery" },
    zh: { subject: "MMD Delivery 团队邀请", preview: "您受邀加入 MMD Delivery。", headline: "团队邀请", body: `${escapeHtml(invitedBy)} 邀请您加入 MMD Delivery。请登录以激活访问权限。`, cta: "加入 MMD Delivery" },
    ff: { subject: "Noddaango kippu MMD Delivery", preview: "A noddaama ngam naatde MMD Delivery.", headline: "Noddaango kippu", body: `${escapeHtml(invitedBy)} noddii ma ngam naatde MMD Delivery. Seŋo ngam huɓɓude naatgol maa.`, cta: "Naatu MMD Delivery" },
  };
  const t = copy[locale];
  return {
    locale,
    subject: t.subject,
    previewText: t.preview,
    headline: t.headline,
    bodyHtml: `<p>${escapeHtml(hello[locale])}${invitee ? ` ${escapeHtml(invitee)}` : ""},</p>
      <p>${t.body}</p>`,
    ctaLabel: t.cta,
    ctaUrl: "https://mmddelivery.com/auth/sign-in",
  };
}

export function staffAdminInvitationEmail(params: {
  inviteeName?: string | null;
  invitedBy?: string | null;
  roleLabel: string;
  inviteUrl: string;
  /** Absolute expiry instant for the invite/recovery link (ISO or Date). */
  expiresAt?: Date | string | null;
  /** Fallback relative TTL when expiresAt is omitted (default 24h). */
  expiresInHours?: number | null;
}): TransactionalEmailTemplate {
  const invitee = String(params.inviteeName ?? "").trim();
  const invitedBy = String(params.invitedBy ?? "MMD Delivery").trim();
  const roleLabel = String(params.roleLabel ?? "Administrator").trim();
  const hours = Math.max(1, Number(params.expiresInHours ?? 24) || 24);
  const expiresAt = params.expiresAt
    ? new Date(params.expiresAt)
    : new Date(Date.now() + hours * 60 * 60 * 1000);
  const expiresLabel = Number.isFinite(expiresAt.getTime())
    ? expiresAt.toLocaleString("fr-FR", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      }) + " UTC"
    : `dans ${hours} heures`;

  return {
    subject: `Invitation administrateur MMD Delivery — ${roleLabel}`,
    previewText: `${invitee || "Administrateur"} · ${roleLabel} · Définissez votre mot de passe.`,
    headline: "Bienvenue dans l'administration",
    bodyHtml: `<p>Bonjour${invitee ? ` <strong>${escapeHtml(invitee)}</strong>` : ""},</p>
      <p>${escapeHtml(invitedBy)} vous invite à rejoindre l'équipe MMD Delivery en tant qu'administrateur.</p>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0;width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:14px 16px;background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;">
            <div style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#9a3412;font-weight:700;">Votre rôle</div>
            <div style="margin-top:4px;font-size:18px;font-weight:700;color:#9a3412;">${escapeHtml(roleLabel)}</div>
          </td>
        </tr>
      </table>
      <p>Pour activer votre accès, définissez votre mot de passe via le bouton ci-dessous, puis connectez-vous sur la page d'administration.</p>
      <p style="margin:16px 0 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #f97316;border-radius:0 10px 10px 0;font-size:14px;color:#334155;">
        <strong>Sécurité :</strong> ce lien est personnel, à usage unique et expire le <strong>${escapeHtml(expiresLabel)}</strong>. Ne le partagez avec personne. Si vous n'attendiez pas cet email, ignorez-le et contactez le Founder MMD Delivery.
      </p>`,
    ctaLabel: "Définir mon mot de passe",
    ctaUrl: params.inviteUrl,
  };
}
