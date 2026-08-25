import { normalizeAppLocale, type AppLocale } from "./userLocale";

export type PushCopy = { title: string; body: string };

type CopyMap = Record<AppLocale, PushCopy>;

function fill(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : "",
  );
}

function pick(map: CopyMap, locale: AppLocale, vars?: Record<string, string | number>): PushCopy {
  const row = map[locale] ?? map.en;
  return {
    title: fill(row.title, vars),
    body: fill(row.body, vars),
  };
}

const L = (
  en: PushCopy,
  fr: PushCopy,
  es: PushCopy,
  ar: PushCopy,
  zh: PushCopy,
  ff: PushCopy,
): CopyMap => ({ en, fr, es, ar, zh, ff });

export const PUSH_CATALOG = {
  order_confirmed: L(
    { title: "Order confirmed", body: "Your payment was received. We are preparing your order." },
    { title: "Commande confirmée", body: "Votre paiement a été reçu. Nous préparons votre commande." },
    { title: "Pedido confirmado", body: "Hemos recibido tu pago. Estamos preparando tu pedido." },
    { title: "تم تأكيد الطلب", body: "تم استلام دفعتك. نجهّز طلبك الآن." },
    { title: "订单已确认", body: "已收到付款，正在准备您的订单。" },
    { title: "Odaare jaɓaama", body: "Yoɓgol maa jaɓaama. Min njogiima odaare maa." },
  ),
  order_accepted: L(
    { title: "Order accepted", body: "The restaurant accepted your order.{{prep}}" },
    { title: "Commande acceptée", body: "Le restaurant a accepté votre commande.{{prep}}" },
    { title: "Pedido aceptado", body: "El restaurante aceptó tu pedido.{{prep}}" },
    { title: "تم قبول الطلب", body: "قبل المطعم طلبك.{{prep}}" },
    { title: "餐厅已接单", body: "餐厅已接受您的订单。{{prep}}" },
    { title: "Odaare jaɓaama", body: "Restoran jaɓii odaare maa.{{prep}}" },
  ),
  delivery_confirmed: L(
    { title: "Delivery confirmed", body: "Your delivery request is paid. Finding a driver." },
    { title: "Livraison confirmée", body: "Votre demande de livraison est payée. Recherche d'un chauffeur en cours." },
    { title: "Entrega confirmada", body: "Tu solicitud de entrega está pagada. Buscando un conductor." },
    { title: "تم تأكيد التوصيل", body: "تم دفع طلب التوصيل. جارٍ البحث عن سائق." },
    { title: "配送已确认", body: "配送请求已支付，正在寻找司机。" },
    { title: "Livraison jaɓaama", body: "Ɗaɓɓitannde livraison maa yoɓaama. Min njiyla driwer." },
  ),
  order_cancelled: L(
    { title: "Order cancelled", body: "Your order was cancelled." },
    { title: "Commande annulée", body: "Votre commande a été annulée." },
    { title: "Pedido cancelado", body: "Tu pedido fue cancelado." },
    { title: "تم إلغاء الطلب", body: "تم إلغاء طلبك." },
    { title: "订单已取消", body: "您的订单已取消。" },
    { title: "Odaare haaltinaama", body: "Odaare maa haaltinaama." },
  ),
  order_cancelled_refund: L(
    { title: "Order cancelled", body: "Your order was cancelled. A refund is in progress." },
    { title: "Commande annulée", body: "Votre commande a été annulée. Un remboursement est en cours." },
    { title: "Pedido cancelado", body: "Tu pedido fue cancelado. El reembolso está en curso." },
    { title: "تم إلغاء الطلب", body: "تم إلغاء طلبك. جارٍ استرداد المبلغ." },
    { title: "订单已取消", body: "您的订单已取消，正在退款。" },
    { title: "Odaare haaltinaama", body: "Odaare maa haaltinaama. Nattinal njoɓdi ina yahra." },
  ),
  delivery_cancelled: L(
    { title: "Delivery cancelled", body: "Your delivery was cancelled." },
    { title: "Livraison annulée", body: "Votre livraison a été annulée." },
    { title: "Entrega cancelada", body: "Tu entrega fue cancelada." },
    { title: "تم إلغاء التوصيل", body: "تم إلغاء توصيلك." },
    { title: "配送已取消", body: "您的配送已取消。" },
    { title: "Livraison haaltinaama", body: "Livraison maa haaltinaama." },
  ),
  delivery_cancelled_refund: L(
    { title: "Delivery cancelled", body: "Your delivery was cancelled. A refund is in progress." },
    { title: "Livraison annulée", body: "Votre livraison a été annulée. Un remboursement est en cours." },
    { title: "Entrega cancelada", body: "Tu entrega fue cancelada. El reembolso está en curso." },
    { title: "تم إلغاء التوصيل", body: "تم إلغاء توصيلك. جارٍ استرداد المبلغ." },
    { title: "配送已取消", body: "您的配送已取消，正在退款。" },
    { title: "Livraison haaltinaama", body: "Livraison maa haaltinaama. Nattinal njoɓdi ina yahra." },
  ),
  driver_arrived_taxi: L(
    { title: "Your driver has arrived", body: "Your driver is at the pickup point. Join your driver when ready." },
    { title: "Votre chauffeur est arrivé", body: "Votre chauffeur est au point de prise en charge. Rejoignez-le quand vous êtes prêt." },
    { title: "Tu conductor ha llegado", body: "Tu conductor está en el punto de recogida. Únete cuando estés listo." },
    { title: "وصل السائق", body: "سائقك عند نقطة الاستلام. انضم إليه عندما تكون جاهزًا." },
    { title: "司机已到达", body: "司机已在上车点，准备好后请上车。" },
    { title: "Driwer maa arii", body: "Driwer maa woni e pickup. Taw e makko so a hebiima." },
  ),
  driver_arrived_delivery: L(
    { title: "Your driver has arrived", body: "Your driver has arrived. You have 5 minutes of free wait time." },
    { title: "Votre chauffeur est arrivé", body: "Votre chauffeur est arrivé. Vous avez 5 minutes d'attente gratuite." },
    { title: "Tu conductor ha llegado", body: "Tu conductor ha llegado. Tienes 5 minutos de espera gratis." },
    { title: "وصل السائق", body: "وصل السائق. لديك 5 دقائق انتظار مجانية." },
    { title: "司机已到达", body: "司机已到达。您有 5 分钟免费等待时间。" },
    { title: "Driwer maa arii", body: "Driwer maa arii. A heɓii hojomaaji 5 njeddaango tawaaka." },
  ),
  wait_fee_started: L(
    { title: "Wait fee started", body: "Late wait fees are starting now." },
    { title: "Frais de retard", body: "Les frais de retard commencent maintenant." },
    { title: "Cargo por espera", body: "Los cargos por espera extra comienzan ahora." },
    { title: "بدأت رسوم الانتظار", body: "بدأت رسوم التأخير الآن." },
    { title: "等候费已开始", body: "超时等候费现已开始计费。" },
    { title: "Njoɓdi njeddaango fuɗɗii", body: "Njoɓdi njeddaango caggal waktu fuɗɗii jooni." },
  ),
  wait_final_warning_taxi: L(
    { title: "Wait time ended", body: "Your free wait time is over. Please join your driver." },
    { title: "Temps d'attente écoulé", body: "Votre temps d'attente gratuit est terminé. Veuillez rejoindre votre chauffeur." },
    { title: "Tiempo de espera agotado", body: "Tu tiempo de espera gratis terminó. Únete a tu conductor." },
    { title: "انتهى وقت الانتظار", body: "انتهى وقت الانتظار المجاني. يرجى الانضمام إلى سائقك." },
    { title: "等候时间已结束", body: "免费等候时间已结束，请尽快上车。" },
    { title: "Waktu njeddaango timmii", body: "Waktu njeddaango tawaaka timmii. Taw e driwer maa." },
  ),
  wait_final_warning_delivery: L(
    { title: "Wait time ended", body: "Your free wait time is over. Please collect your order or join your driver." },
    { title: "Temps d'attente écoulé", body: "Votre temps d'attente gratuit est terminé. Veuillez récupérer votre commande ou rejoindre votre livreur." },
    { title: "Tiempo de espera agotado", body: "Tu tiempo de espera gratis terminó. Recoge tu pedido o únete al conductor." },
    { title: "انتهى وقت الانتظار", body: "انتهى وقت الانتظار المجاني. استلم طلبك أو انضم إلى السائق." },
    { title: "等候时间已结束", body: "免费等候时间已结束，请取件或与司机会合。" },
    { title: "Waktu njeddaango timmii", body: "Waktu njeddaango tawaaka timmii. Ƴettu odaare maa walla taw e driwer." },
  ),
  taxi_completed: L(
    { title: "Ride completed", body: "Your ride is complete. Thank you for traveling with MMD." },
    { title: "Course terminée", body: "Votre course est terminée. Merci d’avoir voyagé avec MMD." },
    { title: "Viaje completado", body: "Tu viaje ha terminado. Gracias por viajar con MMD." },
    { title: "اكتملت الرحلة", body: "اكتملت رحلتك. شكرًا لسفرك مع MMD." },
    { title: "行程已完成", body: "行程已结束，感谢您选择 MMD。" },
    { title: "Yahdu timmii", body: "Yahdu maa timmii. A jaaraama yahde e MMD." },
  ),
  taxi_cancelled: L(
    { title: "Ride cancelled", body: "Your ride was cancelled." },
    { title: "Course annulée", body: "Votre course a été annulée." },
    { title: "Viaje cancelado", body: "Tu viaje fue cancelado." },
    { title: "تم إلغاء الرحلة", body: "تم إلغاء رحلتك." },
    { title: "行程已取消", body: "您的行程已取消。" },
    { title: "Yahdu haaltinaama", body: "Yahdu maa haaltinaama." },
  ),
  taxi_cancelled_refund: L(
    { title: "Ride cancelled", body: "Your ride was cancelled. A refund is being processed." },
    { title: "Course annulée", body: "Votre course a été annulée. Un remboursement est en cours de traitement." },
    { title: "Viaje cancelado", body: "Tu viaje fue cancelado. El reembolso está en proceso." },
    { title: "تم إلغاء الرحلة", body: "تم إلغاء رحلتك. جارٍ معالجة الاسترداد." },
    { title: "行程已取消", body: "您的行程已取消，正在处理退款。" },
    { title: "Yahdu haaltinaama", body: "Yahdu maa haaltinaama. Nattinal njoɓdi ina yahra." },
  ),
  taxi_accepted: L(
    { title: "Driver assigned", body: "Your driver has been assigned and is on the way." },
    { title: "Chauffeur assigné", body: "Votre chauffeur a été assigné et est en route." },
    { title: "Conductor asignado", body: "Tu conductor fue asignado y está en camino." },
    { title: "تم تعيين السائق", body: "تم تعيين سائقك وهو في الطريق." },
    { title: "已分配司机", body: "司机已分配，正在赶来。" },
    { title: "Driwer toɗɗaama", body: "Driwer maa toɗɗaama e ina yaha." },
  ),
  taxi_en_route: L(
    { title: "Driver on the way", body: "Your driver is arriving in approximately {{minutes}} minutes." },
    { title: "Chauffeur en route", body: "Votre chauffeur arrive dans environ {{minutes}} minutes." },
    { title: "Conductor en camino", body: "Tu conductor llega en aproximadamente {{minutes}} minutos." },
    { title: "السائق في الطريق", body: "سائقك يصل خلال حوالي {{minutes}} دقيقة." },
    { title: "司机正在赶来", body: "司机大约 {{minutes}} 分钟后到达。" },
    { title: "Driwer e laawol", body: "Driwer maa ara e hojomaaji {{minutes}}." },
  ),
  new_order: L(
    { title: "New order", body: "A paid order just arrived." },
    { title: "Nouvelle commande", body: "Une commande payée vient d'arriver." },
    { title: "Nuevo pedido", body: "Acaba de llegar un pedido pagado." },
    { title: "طلب جديد", body: "وصل طلب مدفوع للتو." },
    { title: "新订单", body: "一笔已付款订单刚到达。" },
    { title: "Odaare hesere", body: "Odaare yoɓaande hesiri jooni." },
  ),
  new_marketplace_order: L(
    { title: "New Marketplace order", body: "A paid marketplace order just arrived." },
    { title: "Nouvelle commande Marketplace", body: "Une commande payée vient d'arriver." },
    { title: "Nuevo pedido Marketplace", body: "Acaba de llegar un pedido de marketplace pagado." },
    { title: "طلب سوق جديد", body: "وصل طلب سوق مدفوع للتو." },
    { title: "新的商城订单", body: "一笔已付款的商城订单刚到达。" },
    { title: "Odaare Marketplace hesere", body: "Odaare marketplace yoɓaande hesiri jooni." },
  ),
  new_message: L(
    { title: "New message", body: "{{preview}}" },
    { title: "Nouveau message", body: "{{preview}}" },
    { title: "Mensaje nuevo", body: "{{preview}}" },
    { title: "رسالة جديدة", body: "{{preview}}" },
    { title: "新消息", body: "{{preview}}" },
    { title: "Ɓataaku kesu", body: "{{preview}}" },
  ),
  taxi_offer: L(
    { title: "New taxi ride available 🚕", body: "A nearby taxi ride is available." },
    { title: "Nouvelle course taxi disponible 🚕", body: "Une course taxi proche est disponible." },
    { title: "Nuevo viaje taxi disponible 🚕", body: "Hay un viaje de taxi cercano disponible." },
    { title: "رحلة تاكسي جديدة 🚕", body: "تتوفر رحلة تاكسي قريبة." },
    { title: "新的出租车行程 🚕", body: "附近有一趟出租车行程可接。" },
    { title: "Yahdu taxi hesere 🚕", body: "Yahdu taxi ɓadiinde woodi." },
  ),
  taxi_offer_payout: L(
    { title: "New taxi ride available 🚕", body: "Nearby ride • Estimated payout {{payout}} USD" },
    { title: "Nouvelle course taxi disponible 🚕", body: "Course proche • Gain estimé {{payout}} USD" },
    { title: "Nuevo viaje taxi disponible 🚕", body: "Viaje cercano • Ganancia estimada {{payout}} USD" },
    { title: "رحلة تاكسي جديدة 🚕", body: "رحلة قريبة • الأجر التقديري {{payout}} USD" },
    { title: "新的出租车行程 🚕", body: "附近行程 • 预估收入 {{payout}} USD" },
    { title: "Yahdu taxi hesere 🚕", body: "Yahdu ɓadiinde • Njoɓdi {{payout}} USD" },
  ),
  taxi_favorite: L(
    { title: "Favorite client ride ⭐", body: "A client chose you for their taxi ride." },
    { title: "Course favori client ⭐", body: "Un client vous a choisi pour sa course taxi." },
    { title: "Viaje de cliente favorito ⭐", body: "Un cliente te eligió para su viaje de taxi." },
    { title: "رحلة عميل مفضل ⭐", body: "اختارك عميل لرحلته." },
    { title: "收藏客户行程 ⭐", body: "一位客户指定了您来接这趟车。" },
    { title: "Yahdu jeyaaɗo cuɓaaɗo ⭐", body: "Jeyaaɗo suɓii ma e yahdu taxi." },
  ),
  taxi_favorite_payout: L(
    { title: "Favorite client ride ⭐", body: "A client chose you • Estimated payout {{payout}} USD" },
    { title: "Course favori client ⭐", body: "Un client vous a choisi • Gain estimé {{payout}} USD" },
    { title: "Viaje de cliente favorito ⭐", body: "Un cliente te eligió • Ganancia estimada {{payout}} USD" },
    { title: "رحلة عميل مفضل ⭐", body: "اختارك عميل • الأجر التقديري {{payout}} USD" },
    { title: "收藏客户行程 ⭐", body: "客户指定了您 • 预估收入 {{payout}} USD" },
    { title: "Yahdu jeyaaɗo cuɓaaɗo ⭐", body: "Jeyaaɗo suɓii ma • Njoɓdi {{payout}} USD" },
  ),
  delivery_offer: L(
    { title: "New delivery available 🚗", body: "A nearby delivery is available." },
    { title: "Nouvelle livraison disponible 🚗", body: "Une livraison proche est disponible." },
    { title: "Nueva entrega disponible 🚗", body: "Hay una entrega cercana disponible." },
    { title: "توصيل جديد متاح 🚗", body: "يتوفر توصيل قريب." },
    { title: "新的配送任务 🚗", body: "附近有一笔配送任务。" },
    { title: "Livraison hesere 🚗", body: "Livraison ɓadiinde woodi." },
  ),
  delivery_offer_payout: L(
    { title: "New delivery available 🚗", body: "Nearby request • Estimated payout {{payout}} USD" },
    { title: "Nouvelle livraison disponible 🚗", body: "Demande proche • Gain estimé {{payout}} USD" },
    { title: "Nueva entrega disponible 🚗", body: "Solicitud cercana • Ganancia estimada {{payout}} USD" },
    { title: "توصيل جديد متاح 🚗", body: "طلب قريب • الأجر التقديري {{payout}} USD" },
    { title: "新的配送任务 🚗", body: "附近请求 • 预估收入 {{payout}} USD" },
    { title: "Livraison hesere 🚗", body: "Ɗaɓɓitannde ɓadiinde • Njoɓdi {{payout}} USD" },
  ),
  driver_offer: L(
    { title: "New trip available 🚗", body: "A nearby trip is available." },
    { title: "Nouvelle course disponible 🚗", body: "Une course proche est disponible." },
    { title: "Nuevo viaje disponible 🚗", body: "Hay un viaje cercano disponible." },
    { title: "رحلة جديدة متاحة 🚗", body: "تتوفر رحلة قريبة." },
    { title: "新行程可接 🚗", body: "附近有一趟行程可接。" },
    { title: "Yahdu hesere 🚗", body: "Yahdu ɓadiinde woodi." },
  ),
  driver_offer_payout: L(
    { title: "New trip available 🚗", body: "Nearby trip • Estimated payout {{payout}} USD" },
    { title: "Nouvelle course disponible 🚗", body: "Course proche • Gain estimé {{payout}} USD" },
    { title: "Nuevo viaje disponible 🚗", body: "Viaje cercano • Ganancia estimada {{payout}} USD" },
    { title: "رحلة جديدة متاحة 🚗", body: "رحلة قريبة • الأجر التقديري {{payout}} USD" },
    { title: "新行程可接 🚗", body: "附近行程 • 预估收入 {{payout}} USD" },
    { title: "Yahdu hesere 🚗", body: "Yahdu ɓadiinde • Njoɓdi {{payout}} USD" },
  ),
  delivery_completed_client: L(
    { title: "Delivery completed", body: "Your package was delivered. Thank you for choosing MMD Delivery." },
    { title: "Livraison terminée", body: "Votre colis a été livré. Merci d’avoir choisi MMD Delivery." },
    { title: "Entrega completada", body: "Tu paquete fue entregado. Gracias por elegir MMD Delivery." },
    { title: "اكتمل التوصيل", body: "تم تسليم طردك. شكرًا لاختيارك MMD Delivery." },
    { title: "配送已完成", body: "包裹已送达，感谢您选择 MMD Delivery。" },
    { title: "Livraison timmii", body: "Pakke maa yettaama. A jaaraama cuɓude MMD Delivery." },
  ),
  delivery_completed_driver: L(
    { title: "Mission completed", body: "Delivery confirmed. Thank you for the trip." },
    { title: "Mission terminée", body: "Livraison confirmée. Merci pour votre course." },
    { title: "Misión completada", body: "Entrega confirmada. Gracias por el viaje." },
    { title: "اكتملت المهمة", body: "تم تأكيد التوصيل. شكرًا على الرحلة." },
    { title: "任务已完成", body: "配送已确认，感谢您完成本次行程。" },
    { title: "Golle timmii", body: "Livraison jaɓaama. A jaaraama e ndee yahdu." },
  ),
  pickup_confirmed: L(
    { title: "Pickup confirmed", body: "Your driver picked up the package from {{pickup}} and is heading to {{dropoff}}." },
    { title: "Prise en charge confirmée", body: "Votre chauffeur a récupéré le colis à {{pickup}} et se dirige vers {{dropoff}}." },
    { title: "Recogida confirmada", body: "Tu conductor recogió el paquete en {{pickup}} y se dirige a {{dropoff}}." },
    { title: "تم تأكيد الاستلام", body: "استلم السائق الطرد من {{pickup}} ويتجه إلى {{dropoff}}." },
    { title: "取件已确认", body: "司机已从 {{pickup}} 取件，正在前往 {{dropoff}}。" },
    { title: "Pickup jaɓaama", body: "Driwer ƴetti pakke to {{pickup}} e ina yaha {{dropoff}}." },
  ),
  food_delivery_completed: L(
    { title: "Delivery completed", body: "Your delivery from {{pickup}} to {{dropoff}} has been completed successfully." },
    { title: "Livraison terminée", body: "Votre livraison de {{pickup}} vers {{dropoff}} a été effectuée." },
    { title: "Entrega completada", body: "Tu entrega de {{pickup}} a {{dropoff}} se completó." },
    { title: "اكتمل التوصيل", body: "اكتمل التوصيل من {{pickup}} إلى {{dropoff}}." },
    { title: "配送已完成", body: "已完成从 {{pickup}} 到 {{dropoff}} 的配送。" },
    { title: "Livraison timmii", body: "Livraison ummoraade {{pickup}} haa {{dropoff}} timmii." },
  ),
  marketplace_accepted: L(
    { title: "Order accepted", body: "The seller accepted your marketplace order." },
    { title: "Commande acceptée", body: "Le vendeur a accepté votre commande Marketplace." },
    { title: "Pedido aceptado", body: "El vendedor aceptó tu pedido de marketplace." },
    { title: "تم قبول الطلب", body: "قبل البائع طلب السوق." },
    { title: "订单已接受", body: "卖家已接受您的商城订单。" },
    { title: "Odaare jaɓaama", body: "Jeeyoowo jaɓii odaare marketplace maa." },
  ),
  marketplace_refused: L(
    { title: "Order declined", body: "The seller declined your order. A deferred refund was recorded." },
    { title: "Commande refusée", body: "Le vendeur a refusé votre commande. Un remboursement différé est enregistré." },
    { title: "Pedido rechazado", body: "El vendedor rechazó tu pedido. Se registró un reembolso diferido." },
    { title: "رُفض الطلب", body: "رفض البائع طلبك. تم تسجيل استرداد مؤجل." },
    { title: "订单被拒绝", body: "卖家拒绝了您的订单。已记录延期退款。" },
    { title: "Odaare jaɓaaka", body: "Jeeyoowo jaɓaaki odaare maa. Nattinal njoɓdi winnditaama." },
  ),
  marketplace_preparing: L(
    { title: "Order in preparation", body: "The seller is preparing your marketplace order." },
    { title: "Commande en préparation", body: "Le vendeur prépare votre commande Marketplace." },
    { title: "Pedido en preparación", body: "El vendedor está preparando tu pedido." },
    { title: "الطلب قيد التحضير", body: "البائع يجهّز طلب السوق." },
    { title: "订单准备中", body: "卖家正在准备您的商城订单。" },
    { title: "Odaare ina garda", body: "Jeeyoowo ina garda odaare marketplace maa." },
  ),
  marketplace_ready: L(
    { title: "Order ready", body: "Your marketplace order is ready." },
    { title: "Commande prête", body: "Votre commande Marketplace est prête." },
    { title: "Pedido listo", body: "Tu pedido de marketplace está listo." },
    { title: "الطلب جاهز", body: "طلب السوق جاهز." },
    { title: "订单已备妥", body: "您的商城订单已备妥。" },
    { title: "Odaare hebiima", body: "Odaare marketplace maa hebiima." },
  ),
  marketplace_out_for_delivery: L(
    { title: "Order out for delivery", body: "Your marketplace order is on the way." },
    { title: "Commande en livraison", body: "Votre commande Marketplace est en cours de livraison." },
    { title: "Pedido en camino", body: "Tu pedido de marketplace está en camino." },
    { title: "الطلب في الطريق", body: "طلب السوق في طريقه إليك." },
    { title: "订单配送中", body: "您的商城订单正在配送。" },
    { title: "Odaare e laawol", body: "Odaare marketplace maa ina yaha." },
  ),
  marketplace_delivered: L(
    { title: "Order delivered", body: "Your marketplace order was delivered." },
    { title: "Commande livrée", body: "Votre commande Marketplace a été livrée." },
    { title: "Pedido entregado", body: "Tu pedido de marketplace fue entregado." },
    { title: "تم تسليم الطلب", body: "تم تسليم طلب السوق." },
    { title: "订单已送达", body: "您的商城订单已送达。" },
    { title: "Odaare yettaama", body: "Odaare marketplace maa yettaama." },
  ),
  marketplace_update: L(
    { title: "Order update", body: "Marketplace status: {{status}}." },
    { title: "Mise à jour commande", body: "Statut Marketplace : {{status}}." },
    { title: "Actualización del pedido", body: "Estado del marketplace: {{status}}." },
    { title: "تحديث الطلب", body: "حالة السوق: {{status}}." },
    { title: "订单更新", body: "商城状态：{{status}}。" },
    { title: "Hesɗitinal odaare", body: "Ngonka marketplace: {{status}}." },
  ),
  category_approved: L(
    { title: "Category approved", body: "Your vehicle is now eligible for {{category}}." },
    { title: "Catégorie approuvée", body: "Votre véhicule est maintenant admissible en {{category}}." },
    { title: "Categoría aprobada", body: "Tu vehículo ahora es elegible para {{category}}." },
    { title: "تمت الموافقة على الفئة", body: "مركبتك أصبحت مؤهلة لفئة {{category}}." },
    { title: "类别已批准", body: "您的车辆现已符合 {{category}} 类别。" },
    { title: "Fedde jaɓaama", body: "Otoo maa jaɓaama e {{category}}." },
  ),
  category_rejected: L(
    { title: "Category declined", body: "Your request for {{category}} was declined." },
    { title: "Catégorie refusée", body: "Votre demande pour la catégorie {{category}} a été refusée." },
    { title: "Categoría rechazada", body: "Tu solicitud para {{category}} fue rechazada." },
    { title: "رُفضت الفئة", body: "رُفض طلبك لفئة {{category}}." },
    { title: "类别未通过", body: "您的 {{category}} 申请未获通过。" },
    { title: "Fedde jaɓaaka", body: "Ɗaɓɓitannde maa e {{category}} jaɓaaka." },
  ),
  category_rejected_reason: L(
    { title: "Category declined", body: "{{category}} declined: {{reason}}" },
    { title: "Catégorie refusée", body: "Catégorie {{category}} refusée : {{reason}}" },
    { title: "Categoría rechazada", body: "{{category}} rechazada: {{reason}}" },
    { title: "رُفضت الفئة", body: "رُفضت {{category}}: {{reason}}" },
    { title: "类别未通过", body: "{{category}} 未通过：{{reason}}" },
    { title: "Fedde jaɓaaka", body: "{{category}} jaɓaaka: {{reason}}" },
  ),
  category_suspended: L(
    { title: "Category suspended", body: "Category {{category}} was suspended for your vehicle." },
    { title: "Catégorie suspendue", body: "La catégorie {{category}} a été suspendue pour votre véhicule." },
    { title: "Categoría suspendida", body: "La categoría {{category}} fue suspendida para tu vehículo." },
    { title: "تم تعليق الفئة", body: "تم تعليق فئة {{category}} لمركبتك." },
    { title: "类别已暂停", body: "您车辆的 {{category}} 类别已暂停。" },
    { title: "Fedde dartinaama", body: "Fedde {{category}} dartinaama e otoo maa." },
  ),
  category_reactivated: L(
    { title: "Category reactivated", body: "Category {{category}} is active again for your vehicle." },
    { title: "Catégorie réactivée", body: "La catégorie {{category}} est de nouveau active pour votre véhicule." },
    { title: "Categoría reactivada", body: "La categoría {{category}} volvió a estar activa para tu vehículo." },
    { title: "أُعيد تفعيل الفئة", body: "فئة {{category}} نشطة مجددًا لمركبتك." },
    { title: "类别已恢复", body: "您车辆的 {{category}} 类别已重新启用。" },
    { title: "Fedde hurmitii", body: "Fedde {{category}} hurmitii e otoo maa." },
  ),
  vehicle_expired_age: L(
    { title: "Vehicle too old", body: "Your vehicle is no longer eligible for {{category}} (age limit exceeded)." },
    { title: "Véhicule trop ancien", body: "Votre véhicule n'est plus admissible en {{category}} (limite d'âge dépassée)." },
    { title: "Vehículo demasiado antiguo", body: "Tu vehículo ya no es elegible para {{category}} (límite de edad)." },
    { title: "المركبة قديمة جدًا", body: "مركبتك لم تعد مؤهلة لفئة {{category}} (تجاوز حد العمر)." },
    { title: "车辆过旧", body: "您的车辆不再符合 {{category}}（已超车龄限制）。" },
    { title: "Otoo ɓooyii", body: "Otoo maa jaɓaaka e {{category}} (duuɓi ɓurtii)." },
  ),
  document_expired: L(
    { title: "Document expired", body: "Your {{document}} document expired. Update it to keep your taxi categories." },
    { title: "Document expiré", body: "Votre document {{document}} a expiré. Mettez-le à jour pour conserver vos catégories taxi." },
    { title: "Documento vencido", body: "Tu documento {{document}} venció. Actualízalo para conservar tus categorías de taxi." },
    { title: "انتهت صلاحية المستند", body: "انتهت صلاحية مستند {{document}}. حدّثه للاحتفاظ بفئات التاكسي." },
    { title: "证件已过期", body: "您的 {{document}} 证件已过期。请更新以保留出租车类别。" },
    { title: "Fiilde timmii", body: "Fiilde {{document}} maa timmii. Hesɗin ngam mooftude feddeeji taxi." },
  ),
  document_validated: L(
    { title: "Document validated", body: "Your {{document}} document was validated by MMD." },
    { title: "Document validé", body: "Votre document {{document}} a été validé par MMD." },
    { title: "Documento validado", body: "Tu documento {{document}} fue validado por MMD." },
    { title: "تم التحقق من المستند", body: "تم التحقق من مستند {{document}} بواسطة MMD." },
    { title: "证件已通过", body: "MMD 已验证您的 {{document}} 证件。" },
    { title: "Fiilde jaɓaama", body: "Fiilde {{document}} maa jaɓaama e MMD." },
  ),
  taxi_accept_rejected: L(
    { title: "Accept declined", body: "You can no longer accept this ride." },
    { title: "Acceptation refusée", body: "Vous ne pouvez plus accepter cette course." },
    { title: "Aceptación rechazada", body: "Ya no puedes aceptar este viaje." },
    { title: "رُفض القبول", body: "لم يعد بإمكانك قبول هذه الرحلة." },
    { title: "无法接单", body: "您无法再接受此行程。" },
    { title: "Jaɓgol jaɓaaka", body: "A waawaa jaɓde ndee yahdu kadi." },
  ),
  taxi_accept_rejected_reason: L(
    { title: "Accept declined", body: "{{reason}}" },
    { title: "Acceptation refusée", body: "{{reason}}" },
    { title: "Aceptación rechazada", body: "{{reason}}" },
    { title: "رُفض القبول", body: "{{reason}}" },
    { title: "无法接单", body: "{{reason}}" },
    { title: "Jaɓgol jaɓaaka", body: "{{reason}}" },
  ),
  vehicle_update_generic: L(
    { title: "MMD Delivery", body: "Driver vehicle update." },
    { title: "MMD Delivery", body: "Mise à jour véhicule chauffeur." },
    { title: "MMD Delivery", body: "Actualización del vehículo del conductor." },
    { title: "MMD Delivery", body: "تحديث مركبة السائق." },
    { title: "MMD Delivery", body: "司机车辆信息已更新。" },
    { title: "MMD Delivery", body: "Hesɗitinal otoo driwer." },
  ),
  identity_verified: L(
    { title: "Identity verified", body: "Your identity verification was successful." },
    { title: "Identité vérifiée", body: "Votre vérification d'identité a réussi." },
    { title: "Identidad verificada", body: "Tu verificación de identidad se completó." },
    { title: "تم التحقق من الهوية", body: "تم التحقق من هويتك بنجاح." },
    { title: "身份已验证", body: "身份验证已成功完成。" },
    { title: "Nenndital jaɓaama", body: "Nenndital maa timmii e jaɓde." },
  ),
  identity_needs_attention: L(
    { title: "Identity verification needs attention", body: "Additional information is required to complete verification." },
    { title: "Vérification d'identité à compléter", body: "Des informations supplémentaires sont requises." },
    { title: "La verificación necesita atención", body: "Se requiere información adicional para completar la verificación." },
    { title: "التحقق من الهوية يحتاج إلى إجراء", body: "يلزم تقديم معلومات إضافية لإكمال التحقق." },
    { title: "身份验证需要补充材料", body: "需补充信息才能完成验证。" },
    { title: "Nenndital ɗaɓɓii hoolaare", body: "Humpito ɓeydaango ɗaɓɓaama ngam timminde." },
  ),
  identity_failed: L(
    { title: "Identity verification failed", body: "Identity verification could not be completed." },
    { title: "Échec de la vérification d'identité", body: "La vérification d'identité n'a pas pu aboutir." },
    { title: "Falló la verificación de identidad", body: "No se pudo completar la verificación de identidad." },
    { title: "فشل التحقق من الهوية", body: "تعذّر إكمال التحقق من الهوية." },
    { title: "身份验证失败", body: "无法完成身份验证。" },
    { title: "Nenndital woorii", body: "Nenndital horiima timminde." },
  ),
  identity_in_progress: L(
    { title: "Identity verification in progress", body: "Stripe is reviewing your identity documents." },
    { title: "Vérification d'identité en cours", body: "Stripe examine vos documents d'identité." },
    { title: "Verificación de identidad en curso", body: "Stripe está revisando tus documentos de identidad." },
    { title: "التحقق من الهوية قيد المراجعة", body: "تقوم Stripe بمراجعة مستندات هويتك." },
    { title: "身份验证进行中", body: "Stripe 正在审核您的身份文件。" },
    { title: "Nenndital ina yahra", body: "Stripe ƴeewtotoo fiilde nenndital maa." },
  ),
  identity_started: L(
    { title: "Identity verification started", body: "Complete the Stripe Identity flow to continue." },
    { title: "Vérification d'identité commencée", body: "Terminez le parcours Stripe Identity pour continuer." },
    { title: "Verificación de identidad iniciada", body: "Completa el flujo de Stripe Identity para continuar." },
    { title: "بدأ التحقق من الهوية", body: "أكمل مسار Stripe Identity للمتابعة." },
    { title: "身份验证已开始", body: "请完成 Stripe Identity 流程以继续。" },
    { title: "Nenndital fuɗɗii", body: "Timmin laawol Stripe Identity ngam jokkude." },
  ),
  identity_update: L(
    { title: "Identity verification update", body: "There is an update on your identity verification." },
    { title: "Mise à jour vérification d'identité", body: "Votre vérification d'identité a une mise à jour." },
    { title: "Actualización de verificación", body: "Hay una actualización en tu verificación de identidad." },
    { title: "تحديث التحقق من الهوية", body: "هناك تحديث بشأن التحقق من هويتك." },
    { title: "身份验证更新", body: "您的身份验证状态有更新。" },
    { title: "Hesɗitinal nenndital", body: "Nenndital maa heɓii hesɗitinal." },
  ),
  safety_recording: L(
    { title: "Safety recording", body: "A safety recording is active for this ride." },
    { title: "Enregistrement de sécurité", body: "Un enregistrement de sécurité est actif pour cette course." },
    { title: "Grabación de seguridad", body: "Hay una grabación de seguridad activa en este viaje." },
    { title: "تسجيل السلامة", body: "تسجيل السلامة نشط لهذه الرحلة." },
    { title: "安全录音", body: "本次行程正在进行安全录音。" },
    { title: "Nanngol kisal", body: "Nanngol kisal ina huɓɓi e ndee yahdu." },
  ),
  safety_recording_started_client: L(
    { title: "Safety recording", body: "The client started a safety audio recording on their device. This does not turn on your microphone." },
    { title: "Enregistrement de sécurité", body: "Le client a démarré un enregistrement audio de sécurité sur son appareil. Cela n'active pas votre microphone." },
    { title: "Grabación de seguridad", body: "El cliente inició una grabación de audio de seguridad en su dispositivo. Esto no activa tu micrófono." },
    { title: "تسجيل السلامة", body: "بدأ العميل تسجيل صوت أمان على جهازه. هذا لا يشغّل ميكروفونك." },
    { title: "安全录音", body: "客户已在其设备上开始安全录音。这不会打开您的麦克风。" },
    { title: "Nanngol kisal", body: "Jeyaaɗo fuɗɗii nanngol daande kisal e kaɓirgal mum. Ɗum huɓɓataa mikoro maa." },
  ),
  safety_recording_started_driver_audio: L(
    { title: "Safety recording", body: "The driver started a safety audio recording on their device. This does not turn on your microphone." },
    { title: "Enregistrement de sécurité", body: "Le chauffeur a démarré un enregistrement audio de sécurité sur son appareil. Cela n'active pas votre microphone." },
    { title: "Grabación de seguridad", body: "El conductor inició una grabación de audio de seguridad en su dispositivo. Esto no activa tu micrófono." },
    { title: "تسجيل السلامة", body: "بدأ السائق تسجيل صوت أمان على جهازه. هذا لا يشغّل ميكروفونك." },
    { title: "安全录音", body: "司机已在其设备上开始安全录音。这不会打开您的麦克风。" },
    { title: "Nanngol kisal", body: "Driwer fuɗɗii nanngol daande kisal e kaɓirgal mum. Ɗum huɓɓataa mikoro maa." },
  ),
  safety_recording_started_driver_video: L(
    { title: "Safety recording", body: "The driver started a safety video recording on their device. This does not turn on your microphone." },
    { title: "Enregistrement de sécurité", body: "Le chauffeur a démarré un enregistrement vidéo de sécurité sur son appareil. Cela n'active pas votre microphone." },
    { title: "Grabación de seguridad", body: "El conductor inició una grabación de video de seguridad en su dispositivo. Esto no activa tu micrófono." },
    { title: "تسجيل السلامة", body: "بدأ السائق تسجيل فيديو أمان على جهازه. هذا لا يشغّل ميكروفونك." },
    { title: "安全录像", body: "司机已在其设备上开始安全录像。这不会打开您的麦克风。" },
    { title: "Nanngol kisal", body: "Driwer fuɗɗii nanngol widewoo kisal e kaɓirgal mum. Ɗum huɓɓataa mikoro maa." },
  ),
  safety_recording_expiry_3d: L(
    { title: "Safety recording", body: "Download your {{kind}}: 3 days before automatic deletion." },
    { title: "Enregistrement de sécurité", body: "Téléchargez votre {{kind}} : 3 jours avant suppression automatique." },
    { title: "Grabación de seguridad", body: "Descarga tu {{kind}}: 3 días antes de la eliminación automática." },
    { title: "تسجيل السلامة", body: "حمّل {{kind}}: قبل 3 أيام من الحذف التلقائي." },
    { title: "安全录音", body: "请下载您的{{kind}}：距自动删除还有 3 天。" },
    { title: "Nanngol kisal", body: "Aawto {{kind}} maa: balɗe 3 hade momtugol otomaatik." },
  ),
  safety_recording_expiry_24h: L(
    { title: "Safety recording", body: "Download your {{kind}}: 24 hours before automatic deletion." },
    { title: "Enregistrement de sécurité", body: "Téléchargez votre {{kind}} : 24 heures avant suppression automatique." },
    { title: "Grabación de seguridad", body: "Descarga tu {{kind}}: 24 horas antes de la eliminación automática." },
    { title: "تسجيل السلامة", body: "حمّل {{kind}}: قبل 24 ساعة من الحذف التلقائي." },
    { title: "安全录音", body: "请下载您的{{kind}}：距自动删除还有 24 小时。" },
    { title: "Nanngol kisal", body: "Aawto {{kind}} maa: waktuuji 24 hade momtugol otomaatik." },
  ),
  taxi_compliance_driver_profile_suspended: L(
    { title: "Action required — MMD Taxi", body: "Your driver account needs to be regularized. You can finish this ride, but you cannot accept new rides until this is resolved." },
    { title: "Action requise — Taxi MMD", body: "Votre compte chauffeur nécessite une régularisation. Vous pourrez terminer cette course, mais vous ne pourrez pas accepter de nouvelles courses tant que votre situation n'est pas résolue." },
    { title: "Acción requerida — Taxi MMD", body: "Tu cuenta de conductor debe regularizarse. Puedes terminar este viaje, pero no podrás aceptar nuevos hasta resolverlo." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "يجب تسوية حساب السائق. يمكنك إنهاء هذه الرحلة، لكن لا يمكنك قبول رحلات جديدة حتى تُحل المسألة." },
    { title: "需要操作 — MMD 出租车", body: "您的司机账户需要整改。您可以完成本次行程，但在问题解决前无法接新单。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Account driwer maa ina ɗaɓɓi moƴƴitingol. A waawi timminde ndee yahdu, kono a waawaa jaɓde yahduuji kesi haa ɗum safratee." },
  ),
  taxi_compliance_client_profile_suspended: L(
    { title: "MMD ride update", body: "MMD is checking your driver's compliance. Your current ride continues as normal; our team will step in if needed." },
    { title: "Information course MMD", body: "MMD vérifie la conformité de votre chauffeur. Votre course en cours se poursuit normalement ; notre équipe interviendra si nécessaire." },
    { title: "Actualización del viaje MMD", body: "MMD está comprobando la conformidad de tu conductor. Tu viaje actual continúa con normalidad; nuestro equipo intervendrá si es necesario." },
    { title: "تحديث رحلة MMD", body: "تتحقق MMD من امتثال سائقك. رحلتك الحالية مستمرة بشكل طبيعي؛ سيتدخل فريقنا عند الحاجة." },
    { title: "MMD 行程更新", body: "MMD 正在核验司机合规情况。当前行程正常继续；如有需要我们的团队会介入。" },
    { title: "Hesɗitinal yahdu MMD", body: "MMD ƴeewtoo driwer maa. Yahdu maa jokkata e no woodi; kippu men naatata so ɗaɓɓaama." },
  ),
  taxi_compliance_driver_not_operational: L(
    { title: "Action required — MMD Taxi", body: "Your driver profile is no longer operational. Finish this ride, then regularize your file before accepting new requests." },
    { title: "Action requise — Taxi MMD", body: "Votre profil chauffeur n'est plus opérationnel. Terminez cette course puis régularisez votre dossier avant d'accepter de nouvelles demandes." },
    { title: "Acción requerida — Taxi MMD", body: "Tu perfil de conductor ya no está operativo. Termina este viaje y regulariza tu expediente antes de aceptar nuevas solicitudes." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "ملف السائق لم يعد تشغيليًا. أنهِ هذه الرحلة ثم سوِّ ملفك قبل قبول طلبات جديدة." },
    { title: "需要操作 — MMD 出租车", body: "您的司机资料已不可用。请完成本次行程，并在接新单前完成整改。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Profil driwer maa wonaa gollotooɗo. Timmin ndee yahdu, moƴƴitin dosie maa hade jaɓde ɗaɓɓite kesi." },
  ),
  taxi_compliance_vehicle_suspended: L(
    { title: "Action required — MMD Taxi", body: "Your active vehicle is suspended. Finish this ride, then update your vehicle before accepting new rides." },
    { title: "Action requise — Taxi MMD", body: "Votre véhicule actif est suspendu. Terminez cette course puis mettez à jour votre véhicule avant d'accepter de nouvelles courses." },
    { title: "Acción requerida — Taxi MMD", body: "Tu vehículo activo está suspendido. Termina este viaje y actualiza tu vehículo antes de aceptar nuevos viajes." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "مركبتك النشطة معلّقة. أنهِ هذه الرحلة ثم حدّث المركبة قبل قبول رحلات جديدة." },
    { title: "需要操作 — MMD 出租车", body: "您的当前车辆已被暂停。请完成本次行程，并在接新单前更新车辆。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Otoo maa huɓɓaaɗo dartinaama. Timmin ndee yahdu, hesɗin otoo maa hade jaɓde yahduuji kesi." },
  ),
  taxi_compliance_insurance_expired: L(
    { title: "Action required — MMD Taxi", body: "Your vehicle insurance has expired. Regularize your file before accepting new taxi rides." },
    { title: "Action requise — Taxi MMD", body: "L'assurance de votre véhicule a expiré. Régularisez votre dossier avant d'accepter de nouvelles courses taxi." },
    { title: "Acción requerida — Taxi MMD", body: "El seguro de tu vehículo ha caducado. Regulariza tu expediente antes de aceptar nuevos viajes de taxi." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "انتهى تأمين مركبتك. سوِّ ملفك قبل قبول رحلات تاكسي جديدة." },
    { title: "需要操作 — MMD 出租车", body: "车辆保险已过期。请在接新的出租车订单前完成整改。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Asuraans otoo maa timmii. Moƴƴitin dosie maa hade jaɓde yahduuji taxi kesi." },
  ),
  taxi_compliance_registration_expired: L(
    { title: "Action required — MMD Taxi", body: "Your vehicle registration has expired. Update it before accepting new rides." },
    { title: "Action requise — Taxi MMD", body: "L'immatriculation de votre véhicule a expiré. Mettez-la à jour avant d'accepter de nouvelles courses." },
    { title: "Acción requerida — Taxi MMD", body: "La matrícula de tu vehículo ha caducado. Actualízala antes de aceptar nuevos viajes." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "انتهت صلاحية تسجيل مركبتك. حدّثها قبل قبول رحلات جديدة." },
    { title: "需要操作 — MMD 出租车", body: "车辆登记已过期。请在接新单前更新。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Immatrikulaasiyoŋ otoo maa timmii. Hesɗin ɗum hade jaɓde yahduuji kesi." },
  ),
  taxi_compliance_vehicle_category_suspended: L(
    { title: "Action required — MMD Taxi", body: "Your vehicle's taxi category was suspended. Finish this ride, then contact support if needed." },
    { title: "Action requise — Taxi MMD", body: "La catégorie taxi de votre véhicule a été suspendue. Terminez cette course puis contactez le support si nécessaire." },
    { title: "Acción requerida — Taxi MMD", body: "La categoría de taxi de tu vehículo fue suspendida. Termina este viaje y contacta con soporte si es necesario." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "تم تعليق فئة التاكسي لمركبتك. أنهِ هذه الرحلة ثم تواصل مع الدعم إن لزم." },
    { title: "需要操作 — MMD 出租车", body: "车辆的出租车类别已被暂停。请完成本次行程，必要时联系支持。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Kategori taxi otoo maa dartinaama. Timmin ndee yahdu, jokku e wallitorde so ɗaɓɓaama." },
  ),
  taxi_compliance_identity_invalid: L(
    { title: "Action required — MMD Taxi", body: "Your identity verification must be completed before accepting new rides." },
    { title: "Action requise — Taxi MMD", body: "Votre vérification d'identité doit être complétée avant d'accepter de nouvelles courses." },
    { title: "Acción requerida — Taxi MMD", body: "Debes completar la verificación de identidad antes de aceptar nuevos viajes." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "يجب إكمال التحقق من الهوية قبل قبول رحلات جديدة." },
    { title: "需要操作 — MMD 出租车", body: "请先完成身份验证再接新单。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Nenndital maa ina haani timmineede hade jaɓde yahduuji kesi." },
  ),
  taxi_action_required: L(
    { title: "Action required — MMD Taxi", body: "Open the app to continue your taxi ride." },
    { title: "Action requise — Taxi MMD", body: "Ouvrez l'application pour continuer votre course taxi." },
    { title: "Acción requerida — Taxi MMD", body: "Abre la app para continuar tu viaje de taxi." },
    { title: "إجراء مطلوب — تاكسي MMD", body: "افتح التطبيق لمتابعة رحلة التاكسي." },
    { title: "需要操作 — MMD 出租车", body: "请打开应用以继续本次出租车行程。" },
    { title: "Golle ɗaɓɓaama — Taxi MMD", body: "Uddit app ngam jokkude yahdu taxi maa." },
  ),
  taxi_ride_info: L(
    { title: "MMD ride update", body: "There is an update on your taxi ride." },
    { title: "Information course MMD", body: "Votre course taxi a une mise à jour." },
    { title: "Actualización del viaje MMD", body: "Hay una actualización en tu viaje de taxi." },
    { title: "تحديث رحلة MMD", body: "هناك تحديث بشأن رحلة التاكسي." },
    { title: "MMD 行程更新", body: "您的出租车行程有更新。" },
    { title: "Hesɗitinal yahdu MMD", body: "Yahdu taxi maa heɓii hesɗitinal." },
  ),
  plus_created: L(
    { title: "MMD+ activated", body: "Your MMD+ subscription is active. Enjoy benefits on Food, Delivery, Taxi and Marketplace." },
    { title: "MMD+ activé", body: "Votre abonnement MMD+ est actif. Profitez de vos avantages sur Food, Delivery, Taxi et Marketplace." },
    { title: "MMD+ activado", body: "Tu suscripción MMD+ está activa. Disfruta beneficios en Food, Delivery, Taxi y Marketplace." },
    { title: "تم تفعيل MMD+", body: "اشتراك MMD+ نشط. استمتع بالمزايا على الطعام والتوصيل والتاكسي والسوق." },
    { title: "MMD+ 已开通", body: "您的 MMD+ 订阅已生效，可在餐饮、配送、出租车和商城享受权益。" },
    { title: "MMD+ huɓɓii", body: "Abonma MMD+ maa huɓɓii. Huutoro nafoore e Food, Delivery, Taxi e Marketplace." },
  ),
  plus_trial_started: L(
    { title: "MMD+ trial started", body: "Your MMD+ trial has started. Discover all your benefits." },
    { title: "Essai MMD+ commencé", body: "Votre période d'essai MMD+ a démarré. Découvrez tous vos avantages." },
    { title: "Prueba MMD+ iniciada", body: "Tu prueba de MMD+ ha comenzado. Descubre todos tus beneficios." },
    { title: "بدأت تجربة MMD+", body: "بدأت فترة تجربة MMD+. اكتشف جميع مزاياك." },
    { title: "MMD+ 试用已开始", body: "MMD+ 试用已开始，了解全部权益。" },
    { title: "Jarribo MMD+ fuɗɗii", body: "Jarribo MMD+ maa fuɗɗii. Yiyu nafoore maa fow." },
  ),
  plus_trial_ended: L(
    { title: "MMD+ trial ended", body: "Your MMD+ trial ended. Renew to keep your benefits." },
    { title: "Essai MMD+ terminé", body: "Votre essai MMD+ est terminé. Renouvelez pour conserver vos avantages." },
    { title: "Prueba MMD+ finalizada", body: "Tu prueba de MMD+ terminó. Renueva para conservar tus beneficios." },
    { title: "انتهت تجربة MMD+", body: "انتهت تجربتك. جدّد للاحتفاظ بالمزايا." },
    { title: "MMD+ 试用已结束", body: "试用已结束，续订以保留权益。" },
    { title: "Jarribo MMD+ timmii", body: "Jarribo MMD+ maa timmii. Hesɗin ngam mooftude nafoore." },
  ),
  plus_payment_succeeded: L(
    { title: "MMD+ payment succeeded", body: "Your MMD+ payment was confirmed. Thank you!" },
    { title: "Paiement MMD+ réussi", body: "Votre paiement MMD+ a été confirmé. Merci !" },
    { title: "Pago MMD+ correcto", body: "Tu pago de MMD+ fue confirmado. ¡Gracias!" },
    { title: "نجح دفع MMD+", body: "تم تأكيد دفع MMD+. شكرًا لك!" },
    { title: "MMD+ 付款成功", body: "MMD+ 付款已确认，谢谢！" },
    { title: "Yoɓgol MMD+ jaɓaama", body: "Yoɓgol MMD+ maa jaɓaama. A jaaraama!" },
  ),
  plus_payment_failed: L(
    { title: "MMD+ payment failed", body: "Your MMD+ subscription payment failed. Update your payment method." },
    { title: "Paiement MMD+ échoué", body: "Le paiement de votre abonnement MMD+ a échoué. Mettez à jour votre moyen de paiement." },
    { title: "Falló el pago de MMD+", body: "Falló el pago de tu suscripción MMD+. Actualiza tu método de pago." },
    { title: "فشل دفع MMD+", body: "فشل دفع اشتراك MMD+. حدّث وسيلة الدفع." },
    { title: "MMD+ 付款失败", body: "MMD+ 订阅付款失败，请更新支付方式。" },
    { title: "Yoɓgol MMD+ woorii", body: "Yoɓgol abonma MMD+ woorii. Hesɗin feere yoɓgol." },
  ),
  plus_renewed: L(
    { title: "MMD+ renewed", body: "Your MMD+ subscription was renewed successfully." },
    { title: "MMD+ renouvelé", body: "Votre abonnement MMD+ a été renouvelé avec succès." },
    { title: "MMD+ renovado", body: "Tu suscripción MMD+ se renovó correctamente." },
    { title: "تم تجديد MMD+", body: "تم تجديد اشتراك MMD+ بنجاح." },
    { title: "MMD+ 已续订", body: "您的 MMD+ 订阅已成功续订。" },
    { title: "MMD+ hesɗinaama", body: "Abonma MMD+ maa hesɗinaama e jaɓde." },
  ),
  plus_expired: L(
    { title: "MMD+ expired", body: "Your MMD+ subscription expired. Resubscribe to restore your benefits." },
    { title: "MMD+ expiré", body: "Votre abonnement MMD+ a expiré. Réabonnez-vous pour retrouver vos avantages." },
    { title: "MMD+ vencido", body: "Tu suscripción MMD+ venció. Vuelve a suscribirte para recuperar tus beneficios." },
    { title: "انتهى MMD+", body: "انتهى اشتراك MMD+. أعد الاشتراك لاستعادة المزايا." },
    { title: "MMD+ 已过期", body: "MMD+ 订阅已过期，请重新订阅以恢复权益。" },
    { title: "MMD+ timmii", body: "Abonma MMD+ maa timmii. Abon kadi ngam heɓtude nafoore." },
  ),
  plus_plan_changed: L(
    { title: "MMD+ plan changed", body: "Your MMD+ plan was updated." },
    { title: "Plan MMD+ modifié", body: "Votre plan MMD+ a été mis à jour." },
    { title: "Plan MMD+ actualizado", body: "Tu plan MMD+ fue actualizado." },
    { title: "تم تغيير خطة MMD+", body: "تم تحديث خطة MMD+." },
    { title: "MMD+ 套餐已更改", body: "您的 MMD+ 套餐已更新。" },
    { title: "Plan MMD+ waylaama", body: "Plan MMD+ maa hesɗitinaama." },
  ),
  plus_canceled: L(
    { title: "MMD+ cancelled", body: "Your MMD+ subscription was cancelled. You keep access until the end of the current period if applicable." },
    { title: "MMD+ annulé", body: "Votre abonnement MMD+ a été annulé. Vous conservez l'accès jusqu'à la fin de la période en cours si applicable." },
    { title: "MMD+ cancelado", body: "Tu suscripción MMD+ fue cancelada. Conservas el acceso hasta el final del período actual si aplica." },
    { title: "تم إلغاء MMD+", body: "تم إلغاء اشتراك MMD+. تحتفظ بالوصول حتى نهاية الفترة الحالية إن وُجد." },
    { title: "MMD+ 已取消", body: "您的 MMD+ 订阅已取消。如适用，当前周期结束前仍可使用。" },
    { title: "MMD+ haaltinaama", body: "Abonma MMD+ maa haaltinaama. A moofta naatgol haa joofirde waktu oo so woodi." },
  ),
} as const;

export type PushCopyKey = keyof typeof PUSH_CATALOG;

export function pushText(
  key: PushCopyKey,
  localeRaw: unknown,
  vars?: Record<string, string | number>,
): PushCopy {
  const locale = normalizeAppLocale(localeRaw);
  return pick(PUSH_CATALOG[key], locale, vars);
}

export function marketplaceOrderStatusKey(
  status: string,
): PushCopyKey {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "accepted") return "marketplace_accepted";
  if (s === "refused") return "marketplace_refused";
  if (s === "preparing") return "marketplace_preparing";
  if (s === "ready") return "marketplace_ready";
  if (s === "out_for_delivery") return "marketplace_out_for_delivery";
  if (s === "delivered") return "marketplace_delivered";
  if (s === "canceled" || s === "cancelled") return "order_cancelled";
  return "marketplace_update";
}

export function mmdPlusEventKey(event: string): PushCopyKey {
  const map: Record<string, PushCopyKey> = {
    created: "plus_created",
    trial_started: "plus_trial_started",
    trial_ended: "plus_trial_ended",
    payment_succeeded: "plus_payment_succeeded",
    payment_failed: "plus_payment_failed",
    renewed: "plus_renewed",
    expired: "plus_expired",
    plan_changed: "plus_plan_changed",
    canceled: "plus_canceled",
  };
  return map[event] ?? "plus_created";
}

export function prepMinutesSuffix(localeRaw: unknown, minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  const locale = normalizeAppLocale(localeRaw);
  const map: Record<AppLocale, string> = {
    en: ` Estimated prep time: ${minutes} min.`,
    fr: ` Temps de préparation estimé : ${minutes} min.`,
    es: ` Tiempo de preparación estimado: ${minutes} min.`,
    ar: ` وقت التحضير التقريبي: ${minutes} د.`,
    zh: ` 预计备餐时间：${minutes} 分钟。`,
    ff: ` Waktu gardo ${minutes} min.`,
  };
  return map[locale];
}

export function fallbackPickupAddress(localeRaw: unknown): string {
  const locale = normalizeAppLocale(localeRaw);
  const map: Record<AppLocale, string> = {
    en: "your pickup location",
    fr: "votre point de prise en charge",
    es: "tu punto de recogida",
    ar: "موقع الاستلام",
    zh: "取件地点",
    ff: "nokku pickup maa",
  };
  return map[locale];
}

export function fallbackDropoffAddress(localeRaw: unknown): string {
  const locale = normalizeAppLocale(localeRaw);
  const map: Record<AppLocale, string> = {
    en: "the destination",
    fr: "la destination",
    es: "el destino",
    ar: "الوجهة",
    zh: "目的地",
    ff: "goolirde ndee",
  };
  return map[locale];
}

export function safetyRecordingKindLabel(
  localeRaw: unknown,
  recordingType: "client_audio" | "driver_audio" | "driver_video" | string,
): string {
  const locale = normalizeAppLocale(localeRaw);
  const type = String(recordingType ?? "").trim();
  const map: Record<string, Record<AppLocale, string>> = {
    client_audio: {
      en: "client safety audio",
      fr: "enregistrement audio client",
      es: "audio de seguridad del cliente",
      ar: "تسجيل صوت أمان العميل",
      zh: "客户安全录音",
      ff: "nanngol daande jeyaaɗo",
    },
    driver_audio: {
      en: "driver safety audio",
      fr: "enregistrement audio chauffeur",
      es: "audio de seguridad del conductor",
      ar: "تسجيل صوت أمان السائق",
      zh: "司机安全录音",
      ff: "nanngol daande driwer",
    },
    driver_video: {
      en: "driver safety video",
      fr: "enregistrement vidéo chauffeur",
      es: "video de seguridad del conductor",
      ar: "فيديو أمان السائق",
      zh: "司机安全录像",
      ff: "nanngol widewoo driwer",
    },
  };
  return (map[type] ?? map.driver_audio)[locale];
}

const DRIVER_COMPLIANCE_KEYS: Record<string, PushCopyKey> = {
  driver_profile_suspended: "taxi_compliance_driver_profile_suspended",
  driver_not_operational: "taxi_compliance_driver_not_operational",
  vehicle_suspended: "taxi_compliance_vehicle_suspended",
  insurance_expired: "taxi_compliance_insurance_expired",
  registration_expired: "taxi_compliance_registration_expired",
  vehicle_category_suspended: "taxi_compliance_vehicle_category_suspended",
  identity_invalid: "taxi_compliance_identity_invalid",
};

export function taxiComplianceCopy(
  eventType: string,
  audience: "driver" | "client",
  localeRaw: unknown,
): PushCopy {
  const type = String(eventType ?? "").trim();
  if (audience === "client") {
    if (type === "driver_profile_suspended") {
      return pushText("taxi_compliance_client_profile_suspended", localeRaw);
    }
    return pushText("taxi_ride_info", localeRaw);
  }
  const key = DRIVER_COMPLIANCE_KEYS[type] ?? "taxi_action_required";
  return pushText(key, localeRaw);
}
