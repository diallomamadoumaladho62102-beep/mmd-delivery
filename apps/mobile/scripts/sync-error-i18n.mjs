#!/usr/bin/env node
/**
 * Writes the `errors.*` catalogue used by src/lib/userFacingError.ts, plus the few
 * screen-level fallbacks that used to be hardcoded, into every locale extras.json.
 *
 * Each entry is [en, fr, es, ar, zh, ff]. This script owns those keys: re-running it
 * restores the reference translations, so it is safe to run after sync-missing-locale-keys.mjs
 * (which would otherwise leave English copies behind in fr/es/ar/zh/ff).
 *
 * Usage:
 *   node scripts/sync-error-i18n.mjs --dry-run
 *   node scripts/sync-error-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(HERE, "..", "src", "i18n", "locales");
const LOCALES = ["en", "fr", "es", "ar", "zh", "ff"];
const DRY_RUN = process.argv.includes("--dry-run");

const PROCESSING_ERROR = [
  "The payment could not be completed. Please try again in a few moments.",
  "Le paiement n'a pas pu être finalisé. Réessayez dans quelques instants.",
  "No se pudo completar el pago. Inténtalo de nuevo en unos instantes.",
  "تعذر إتمام الدفع. يرجى المحاولة مرة أخرى بعد قليل.",
  "支付未能完成，请稍后重试。",
  "Njoɓdi timmaani. Tiiɗno eto kadi caggal seeɗa.",
];

const CARD_DECLINED = [
  "Your card was declined. Check your details or use another card.",
  "Votre carte a été refusée. Vérifiez vos informations ou utilisez une autre carte.",
  "Tu tarjeta fue rechazada. Comprueba tus datos o usa otra tarjeta.",
  "تم رفض بطاقتك. تحقق من بياناتك أو استخدم بطاقة أخرى.",
  "您的银行卡被拒绝。请核对信息或改用其他卡。",
  "Karte maa salaama. Yeeɓ kabaruuji maa walla huutoro karte goɗɗo.",
];

const INVALID_CREDENTIALS = [
  "Incorrect credentials. Check your email and password.",
  "Identifiants incorrects. Vérifiez votre email et mot de passe.",
  "Credenciales incorrectas. Comprueba tu correo y contraseña.",
  "بيانات الدخول غير صحيحة. تحقق من بريدك الإلكتروني وكلمة المرور.",
  "账号信息不正确。请检查邮箱和密码。",
  "Kabaruuji naatgol moƴƴaaka. Yeeɓ email e finnde maa.",
];

const EMAIL_NOT_CONFIRMED = [
  "Confirm your email address before signing in.",
  "Confirmez votre adresse email avant de vous connecter.",
  "Confirma tu dirección de correo antes de iniciar sesión.",
  "أكّد عنوان بريدك الإلكتروني قبل تسجيل الدخول.",
  "登录前请先确认您的邮箱地址。",
  "Tabitin email maa ado a naatde.",
];

const USER_ALREADY_REGISTERED = [
  "An account already exists with this email address.",
  "Un compte existe déjà avec cette adresse email.",
  "Ya existe una cuenta con esta dirección de correo.",
  "يوجد حساب بالفعل بهذا البريد الإلكتروني.",
  "该邮箱已注册账户。",
  "Konto ena woodi haa jooni e ndee email.",
];

const PAYMENT_NOT_CONFIRMED = [
  "Payment was not completed. Please check your payment method and try again.",
  "Le paiement n'a pas été effectué. Vérifiez votre moyen de paiement et réessayez.",
  "El pago no se completó. Comprueba tu método de pago e inténtalo de nuevo.",
  "لم يكتمل الدفع. يرجى التحقق من وسيلة الدفع والمحاولة مرة أخرى.",
  "支付未完成。请检查您的支付方式后重试。",
  "Njoɓdi timmaani. Tiiɗno yeeɓ laawol njoɓdi maa eto kadi.",
];

const STRIPE_SETUP_REQUIRED = [
  "Complete your Stripe setup to enable payouts, then try again.",
  "Complétez la configuration Stripe pour activer les virements, puis réessayez.",
  "Completa la configuración de Stripe para activar los pagos y vuelve a intentarlo.",
  "أكمل إعداد Stripe لتفعيل التحويلات، ثم حاول مرة أخرى.",
  "请先完成 Stripe 设置以启用打款，然后重试。",
  "Timmin teelte Stripe ngam huɓɓude yuɓɓugol, refti eto kadi.",
];

const STRIPE_SECRET_LIVE = [
  "Stripe Connect is not ready on the server side. Contact MMD support.",
  "La configuration Stripe Connect n'est pas prête côté serveur. Contactez le support MMD.",
  "Stripe Connect no está listo en el servidor. Contacta con el soporte de MMD.",
  "Stripe Connect غير جاهز على الخادم. تواصل مع دعم MMD.",
  "服务器端的 Stripe Connect 尚未就绪。请联系 MMD 客服。",
  "Stripe Connect hebaaki e serveur. Heɓto ballal MMD.",
];

const STRIPE_PLATFORM_PROFILE = [
  "Stripe Connect is not activated yet for the MMD platform. Complete the Connect questionnaire in the Stripe Dashboard (Connect → Accounts → Overview), then try again.",
  "Stripe Connect n'est pas encore activé pour la plateforme MMD. Complétez le questionnaire Connect dans le Dashboard Stripe (Connect → Accounts → Overview), puis réessayez.",
  "Stripe Connect aún no está activado para la plataforma MMD. Completa el cuestionario de Connect en el Dashboard de Stripe (Connect → Accounts → Overview) y vuelve a intentarlo.",
  "لم يتم تفعيل Stripe Connect بعد لمنصة MMD. أكمل استبيان Connect في لوحة تحكم Stripe (Connect → Accounts → Overview) ثم حاول مرة أخرى.",
  "MMD 平台尚未启用 Stripe Connect。请在 Stripe 控制台完成 Connect 问卷（Connect → Accounts → Overview），然后重试。",
  "Stripe Connect huɓɓaaka tawo e plateforme MMD. Timmin naamnde Connect e Dashboard Stripe (Connect → Accounts → Overview), refti eto kadi.",
];

const DELIVERY_SHARE = [
  "The delivery configuration is temporarily unavailable. Try again later or contact support.",
  "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.",
  "La configuración de entrega no está disponible temporalmente. Inténtalo más tarde o contacta con soporte.",
  "إعدادات التوصيل غير متاحة مؤقتًا. حاول لاحقًا أو تواصل مع الدعم.",
  "配送配置暂时不可用。请稍后重试或联系客服。",
  "Teelte neldugol alaa jooni. Eto ɓawto walla heɓto ballal.",
];

/** Dotted key -> [en, fr, es, ar, zh, ff]. */
const ENTRIES = {
  "errors.fallback": [
    "Something went wrong temporarily. Please try again.",
    "Une action temporairement impossible s'est produite. Veuillez réessayer.",
    "Se ha producido un problema temporal. Vuelve a intentarlo.",
    "حدث خطأ مؤقت. يرجى المحاولة مرة أخرى.",
    "出现了临时问题，请重试。",
    "Caɗeele ɓawto ngartii. Tiiɗno eto kadi.",
  ],

  "errors.codes.active_mission_in_progress": [
    "Finish your current mission before changing this setting.",
    "Terminez votre mission en cours avant de modifier ce paramètre.",
    "Termina tu misión en curso antes de cambiar este ajuste.",
    "أنهِ مهمتك الحالية قبل تغيير هذا الإعداد.",
    "请先完成当前任务，再修改此设置。",
    "Timmin golle maa jooni ado a waylude ndee teelte.",
  ],
  "errors.codes.documents_required": [
    "This transport mode requires your documents to be approved before it can be enabled.",
    "Ce mode de transport nécessite une validation de vos documents avant d'être activé.",
    "Este modo de transporte requiere la validación de tus documentos antes de activarse.",
    "يتطلب وضع النقل هذا اعتماد مستنداتك قبل تفعيله.",
    "此出行方式需先通过证件审核才能启用。",
    "Ndee laawol jahdi ena naamnii dokimaaɗe maa tabitinee ado nde huɓɓee.",
  ],
  "errors.codes.invalid_transport_mode": [
    "Invalid transport mode.",
    "Mode de transport invalide.",
    "Modo de transporte no válido.",
    "وضع نقل غير صالح.",
    "出行方式无效。",
    "Laawol jahdi moƴƴaaka.",
  ],
  "errors.codes.must_be_offline": [
    "Go offline to edit or delete a vehicle.",
    "Passez hors ligne pour modifier ou supprimer un véhicule.",
    "Ponte fuera de línea para editar o eliminar un vehículo.",
    "انتقل إلى وضع غير متصل لتعديل مركبة أو حذفها.",
    "请先下线，再编辑或删除车辆。",
    "Yaltu e ligne ngam waylude walla momtude mootor.",
  ],
  "errors.codes.active_ride_in_progress": [
    "You cannot change vehicle during a ride.",
    "Impossible de changer de véhicule pendant une course.",
    "No puedes cambiar de vehículo durante un viaje.",
    "لا يمكنك تغيير المركبة أثناء رحلة.",
    "行程进行中无法更换车辆。",
    "A waawaa waylude mootor e nder yahdu.",
  ],
  "errors.codes.vehicle_not_active": [
    "This vehicle is not active or approved.",
    "Ce véhicule n'est pas actif ou approuvé.",
    "Este vehículo no está activo ni aprobado.",
    "هذه المركبة غير نشطة أو غير معتمدة.",
    "该车辆未启用或未获批准。",
    "Ndee mootor wonaa e golle walla nde jaɓaaka.",
  ],
  "errors.codes.vehicle_not_found": [
    "Vehicle not found.",
    "Véhicule introuvable.",
    "Vehículo no encontrado.",
    "لم يتم العثور على المركبة.",
    "未找到车辆。",
    "Mootor yiytaaka.",
  ],
  "errors.codes.no_active_vehicle": [
    "Select an active, approved vehicle before going online.",
    "Sélectionnez un véhicule actif et approuvé avant de passer en ligne.",
    "Selecciona un vehículo activo y aprobado antes de conectarte.",
    "اختر مركبة نشطة ومعتمدة قبل الاتصال.",
    "上线前请选择一辆已启用并获批准的车辆。",
    "Suɓo mootor e golle e jaɓaande ado a naatde e ligne.",
  ],
  "errors.codes.vehicle_pending_review": [
    "Your vehicle is pending review. You will be able to go online once it is approved.",
    "Votre véhicule est en attente de validation. Vous pourrez passer en ligne après approbation.",
    "Tu vehículo está pendiente de validación. Podrás conectarte tras la aprobación.",
    "مركبتك قيد المراجعة. ستتمكن من الاتصال بعد الموافقة عليها.",
    "您的车辆正在审核中，通过后即可上线。",
    "Mootor maa ena e ñaawoore. A waawi naatde e ligne caggal nde jaɓaa.",
  ],
  "errors.codes.vehicle_rejected": [
    "Your vehicle was rejected. Correct the information or add a new vehicle.",
    "Votre véhicule a été refusé. Corrigez les informations ou ajoutez un nouveau véhicule.",
    "Tu vehículo fue rechazado. Corrige la información o añade otro vehículo.",
    "تم رفض مركبتك. صحّح المعلومات أو أضف مركبة جديدة.",
    "您的车辆已被拒绝。请更正信息或添加新车辆。",
    "Mootor maa salaama. Feewnu kabaruuji walla ɓeydu mootor keso.",
  ],
  "errors.codes.vehicle_not_eligible": [
    "Your active vehicle is not eligible. Wait for admin approval or choose another vehicle.",
    "Votre véhicule actif n'est pas éligible. Attendez la validation admin ou choisissez un autre véhicule.",
    "Tu vehículo activo no es elegible. Espera la validación del administrador o elige otro vehículo.",
    "مركبتك النشطة غير مؤهلة. انتظر موافقة الإدارة أو اختر مركبة أخرى.",
    "您当前的车辆不符合条件。请等待管理员审核或选择其他车辆。",
    "Mootor maa e golle jaɓnitaaka. Fadu jaɓgol admin walla suɓo mootor goɗɗo.",
  ],
  "errors.codes.no_service_enabled": [
    "Enable at least one service (Food, Package or Taxi) before going online.",
    "Activez au moins un service (Food, Colis ou Taxi) avant de passer en ligne.",
    "Activa al menos un servicio (Comida, Paquete o Taxi) antes de conectarte.",
    "فعّل خدمة واحدة على الأقل (الطعام أو الطرود أو التاكسي) قبل الاتصال.",
    "上线前请至少启用一项服务（美食、包裹或出租车）。",
    "Huɓɓu ko famɗi fof golle gootel (Ñaametee, Colis walla Taxi) ado a naatde e ligne.",
  ],
  "errors.codes.driver_not_approved": [
    "Your driver account must be approved before you can go online.",
    "Votre compte chauffeur doit être approuvé avant de passer en ligne.",
    "Tu cuenta de conductor debe estar aprobada antes de conectarte.",
    "يجب اعتماد حساب السائق الخاص بك قبل الاتصال.",
    "上线前需先审核通过您的司机账户。",
    "Konto dooɓoowo maa ena foti jaɓeede ado a naatde e ligne.",
  ],
  "errors.codes.driver_suspended": [
    "Your driver account is suspended.",
    "Votre compte chauffeur est suspendu.",
    "Tu cuenta de conductor está suspendida.",
    "حساب السائق الخاص بك موقوف.",
    "您的司机账户已被暂停。",
    "Konto dooɓoowo maa dartinaama.",
  ],
  "errors.codes.driver_disabled": [
    "Your driver account is disabled.",
    "Votre compte chauffeur est désactivé.",
    "Tu cuenta de conductor está desactivada.",
    "حساب السائق الخاص بك معطّل.",
    "您的司机账户已被停用。",
    "Konto dooɓoowo maa ñifaama.",
  ],
  "errors.codes.online_status_update_failed": [
    "Unable to change your status right now.",
    "Impossible de changer le statut pour le moment.",
    "No se puede cambiar el estado en este momento.",
    "تعذر تغيير حالتك الآن.",
    "目前无法更改您的状态。",
    "Horiima waylude staatus maa jooni.",
  ],
  "errors.codes.route_unavailable": [
    "We could not calculate the exact route right now. Please check the addresses or try again.",
    "Nous n'avons pas pu calculer l'itinéraire exact pour le moment. Veuillez vérifier les adresses ou réessayer.",
    "No hemos podido calcular la ruta exacta en este momento. Comprueba las direcciones o inténtalo de nuevo.",
    "تعذر علينا حساب المسار الدقيق الآن. يرجى التحقق من العناوين أو المحاولة مرة أخرى.",
    "目前无法计算准确路线。请检查地址或稍后重试。",
    "Min mbaawaali hiisaade laawol focciingol jooni. Tiiɗno yeeɓ adressaaji walla eto kadi.",
  ],
  "errors.codes.card_declined": CARD_DECLINED,
  "errors.codes.payment_intent_authentication_failure": [
    "Payment authentication failed. Try again or use another card.",
    "L'authentification du paiement a échoué. Réessayez ou utilisez une autre carte.",
    "Falló la autenticación del pago. Inténtalo de nuevo o usa otra tarjeta.",
    "فشل التحقق من الدفع. حاول مرة أخرى أو استخدم بطاقة أخرى.",
    "支付验证失败。请重试或改用其他卡。",
    "Tabitingol njoɓdi firlitii. Eto kadi walla huutoro karte goɗɗo.",
  ],
  "errors.codes.processing_error": PROCESSING_ERROR,
  "errors.codes.invalid_credentials": INVALID_CREDENTIALS,
  "errors.codes.email_not_confirmed": EMAIL_NOT_CONFIRMED,
  "errors.codes.user_already_registered": USER_ALREADY_REGISTERED,
  "errors.codes.weak_password": [
    "Password too weak. Use at least 8 characters.",
    "Mot de passe trop faible. Utilisez au moins 8 caractères.",
    "Contraseña demasiado débil. Usa al menos 8 caracteres.",
    "كلمة المرور ضعيفة جدًا. استخدم 8 رموز على الأقل.",
    "密码强度不足，请至少使用 8 位字符。",
    "Finnde maa ena ɗoyri. Huutoro ko famɗi fof alkule 8.",
  ],
  "errors.codes.payment_setup_failed": PROCESSING_ERROR,
  "errors.codes.stripe_payment_not_confirmed": PAYMENT_NOT_CONFIRMED,
  "errors.codes.delivery_share_pct_invalid": DELIVERY_SHARE,
  "errors.codes.stripe_setup_required": STRIPE_SETUP_REQUIRED,
  "errors.codes.stripe_secret_key_must_be_live": STRIPE_SECRET_LIVE,
  "errors.codes.stripe_account_retrieve_failed": [
    "Unable to read your Stripe account. Reopen the payout setup.",
    "Impossible de lire votre compte Stripe. Rouvrez la configuration des virements.",
    "No se puede leer tu cuenta de Stripe. Vuelve a abrir la configuración de pagos.",
    "تعذر قراءة حساب Stripe الخاص بك. أعد فتح إعداد التحويلات.",
    "无法读取您的 Stripe 账户。请重新打开打款设置。",
    "Horiima jaŋtaade konto Stripe maa. Uddit teelte yuɓɓugol kadi.",
  ],
  "errors.codes.stripe_connect_platform_profile_incomplete":
    STRIPE_PLATFORM_PROFILE,
  "errors.codes.profile_not_found": [
    "Your driver profile is incomplete. Reopen the app or contact support to finish your account, then try Enable again.",
    "Votre profil chauffeur est incomplet. Rouvrez l'application ou contactez le support pour finaliser votre compte, puis réessayez Enable.",
    "Tu perfil de conductor está incompleto. Vuelve a abrir la aplicación o contacta con soporte para finalizar tu cuenta y pulsa Activar de nuevo.",
    "ملف السائق الخاص بك غير مكتمل. أعد فتح التطبيق أو تواصل مع الدعم لإكمال حسابك، ثم أعد المحاولة.",
    "您的司机资料不完整。请重新打开应用或联系客服完成账户设置，然后再次点击启用。",
    "Profil dooɓoowo maa timmaani. Uddit app kadi walla heɓto ballal ngam timminde konto maa, refti eto Enable kadi.",
  ],
  "errors.codes.stripe_connect_error": [
    "Unable to open the Stripe setup. Try again or contact support.",
    "Impossible d'ouvrir la configuration Stripe. Réessayez ou contactez le support.",
    "No se puede abrir la configuración de Stripe. Inténtalo de nuevo o contacta con soporte.",
    "تعذر فتح إعداد Stripe. حاول مرة أخرى أو تواصل مع الدعم.",
    "无法打开 Stripe 设置。请重试或联系客服。",
    "Horiima udditde teelte Stripe. Eto kadi walla heɓto ballal.",
  ],
  "errors.codes.already_cashed_out_today": [
    "You have already requested a payout today. Try again tomorrow.",
    "Vous avez déjà demandé un retrait aujourd'hui. Réessayez demain.",
    "Ya has solicitado un retiro hoy. Inténtalo mañana.",
    "لقد طلبت سحبًا اليوم بالفعل. حاول مرة أخرى غدًا.",
    "您今天已申请过提现，请明天再试。",
    "A ɗaɓɓii yaltingol hannde. Eto janngo.",
  ],
  "errors.codes.below_minimum": [
    "Your available balance is below the payout minimum.",
    "Le solde disponible est inférieur au minimum de retrait.",
    "Tu saldo disponible es inferior al mínimo de retiro.",
    "رصيدك المتاح أقل من الحد الأدنى للسحب.",
    "您的可用余额低于提现最低金额。",
    "Balance maa ena famɗi e keerol yaltingol.",
  ],
  "errors.codes.cashout_rate_limited": [
    "Too many payout requests. Wait a few minutes then try again.",
    "Trop de demandes de retrait. Attendez quelques minutes puis réessayez.",
    "Demasiadas solicitudes de retiro. Espera unos minutos e inténtalo de nuevo.",
    "طلبات سحب كثيرة جدًا. انتظر بضع دقائق ثم حاول مرة أخرى.",
    "提现申请过于频繁。请等待几分钟后重试。",
    "Ɗaɓɓe yaltingol ɗuuɗi. Fadu minutaaji seeɗa refti eto kadi.",
  ],
  "errors.codes.driver_no_stripe_account": [
    "No Stripe Connect account found. Tap Enable payouts to get started.",
    "Aucun compte Stripe Connect trouvé. Appuyez sur Activer les virements pour commencer.",
    "No se encontró ninguna cuenta de Stripe Connect. Pulsa Activar pagos para empezar.",
    "لم يتم العثور على حساب Stripe Connect. اضغط على تفعيل التحويلات للبدء.",
    "未找到 Stripe Connect 账户。点击“启用打款”开始设置。",
    "Konto Stripe Connect yiytaaka. Tappu Huɓɓu yuɓɓugol ngam fuɗɗaade.",
  ],

  "errors.patterns.notOnboarded": STRIPE_SETUP_REQUIRED,
  "errors.patterns.stripeSecretLive": STRIPE_SECRET_LIVE,
  "errors.patterns.deliveryShare": DELIVERY_SHARE,
  "errors.patterns.invalidCredentials": INVALID_CREDENTIALS,
  "errors.patterns.emailNotConfirmed": EMAIL_NOT_CONFIRMED,
  "errors.patterns.paymentNotConfirmed": PAYMENT_NOT_CONFIRMED,
  "errors.patterns.userAlreadyRegistered": USER_ALREADY_REGISTERED,
  "errors.patterns.paymentCanceled": [
    "Payment canceled.",
    "Paiement annulé.",
    "Pago cancelado.",
    "تم إلغاء الدفع.",
    "支付已取消。",
    "Njoɓdi haaytinaama.",
  ],
  "errors.patterns.processingError": PROCESSING_ERROR,
  "errors.patterns.cardDeclined": CARD_DECLINED,
  "errors.patterns.networkFailed": [
    "Unstable connection. Check your network and try again.",
    "Connexion instable. Vérifiez votre réseau et réessayez.",
    "Conexión inestable. Comprueba tu red e inténtalo de nuevo.",
    "الاتصال غير مستقر. تحقق من الشبكة وحاول مرة أخرى.",
    "网络不稳定。请检查网络后重试。",
    "Ceŋagol dogaani. Yeeɓ reseau maa refti eto kadi.",
  ],
  "errors.patterns.distanceTooFar": [
    "The distance is too long for this ride.",
    "La distance est trop importante pour cette course.",
    "La distancia es demasiado larga para este viaje.",
    "المسافة طويلة جدًا لهذه الرحلة.",
    "此行程距离过远。",
    "Ɓetol ngol ena juuti sanne ngam ndee yahdu.",
  ],

  // Screen-level fallbacks that used to be hardcoded next to toUserFacingError().
  // taxi.tracking.safety.* is owned by sync-safety-audio-i18n.mjs.
  "common.unknownError": [
    "Unknown error.",
    "Erreur inconnue.",
    "Error desconocido.",
    "خطأ غير معروف.",
    "未知错误。",
    "Juumre anndaaka.",
  ],
  "driver.map.gpsEnableFailed": [
    "Unable to turn on GPS.",
    "Impossible d'activer le GPS.",
    "No se puede activar el GPS.",
    "تعذر تفعيل GPS.",
    "无法启用 GPS。",
    "Horiima huɓɓude GPS.",
  ],
  "mmdPlus.loadFailed": [
    "Unable to load MMD+.",
    "Chargement MMD+ impossible.",
    "No se pudo cargar MMD+.",
    "تعذر تحميل MMD+.",
    "无法加载 MMD+。",
    "Horiima loowde MMD+.",
  ],
  "promotions.loadFailed": [
    "Unable to load promotions.",
    "Chargement des promotions impossible.",
    "No se pudieron cargar las promociones.",
    "تعذر تحميل العروض.",
    "无法加载优惠。",
    "Horiima loowde promotions.",
  ],
  "restaurant.setup.alerts.logoPickFailed": [
    "Unable to pick the logo.",
    "Impossible de choisir le logo.",
    "No se pudo elegir el logotipo.",
    "تعذر اختيار الشعار.",
    "无法选择标识。",
    "Horiima suɓaade logo.",
  ],
  "restaurant.setup.alerts.coverPickFailed": [
    "Unable to pick the cover image.",
    "Impossible de choisir la couverture.",
    "No se pudo elegir la imagen de portada.",
    "تعذر اختيار صورة الغلاف.",
    "无法选择封面图片。",
    "Horiima suɓaade foto hoore.",
  ],
  "restaurant.setup.alerts.documentPickFailed": [
    "Unable to pick the document.",
    "Impossible de choisir le document.",
    "No se pudo elegir el documento.",
    "تعذر اختيار المستند.",
    "无法选择文件。",
    "Horiima suɓaade dokimaa.",
  ],
  "restaurant.menu.alerts.actionFailed": [
    "This action is unavailable right now.",
    "Action impossible pour le moment.",
    "Esta acción no está disponible ahora.",
    "هذا الإجراء غير متاح حاليًا.",
    "此操作暂时不可用。",
    "Ngal golle alaa jooni.",
  ],
  "restaurant.orders.statusUpdateFailed": [
    "Unable to update the order status ({{status}}).",
    "Impossible de mettre à jour le statut de la commande ({{status}}).",
    "No se pudo actualizar el estado del pedido ({{status}}).",
    "تعذر تحديث حالة الطلب ({{status}}).",
    "无法更新订单状态（{{status}}）。",
    "Horiima hesɗitinde staatus jeyi ngan ({{status}}).",
  ],
  "restaurant.orders.rejectFailed": [
    "Unable to refuse the order ({{status}}).",
    "Impossible de refuser la commande ({{status}}).",
    "No se pudo rechazar el pedido ({{status}}).",
    "تعذر رفض الطلب ({{status}}).",
    "无法拒绝订单（{{status}}）。",
    "Horiima salaade jeyi ngan ({{status}}).",
  ],
  "restaurant.dashboard.availabilityUpdateFailed": [
    "Unable to change the restaurant status.",
    "Impossible de modifier le statut du restaurant.",
    "No se pudo cambiar el estado del restaurante.",
    "تعذر تغيير حالة المطعم.",
    "无法更改餐厅状态。",
    "Horiima waylude staatus restoraa on.",
  ],
  "driver.taxiPanel.invalidPickupCode": [
    "Invalid pickup code.",
    "Code de prise en charge invalide.",
    "Código de recogida no válido.",
    "رمز الاستلام غير صالح.",
    "上车码无效。",
    "Kod ƴettugol moƴƴaaka.",
  ],
  "location.tripCard.loadFailed": [
    "Unable to load the location.",
    "Impossible de charger l'emplacement.",
    "No se pudo cargar la ubicación.",
    "تعذر تحميل الموقع.",
    "无法加载位置。",
    "Horiima loowde nokku on.",
  ],
  "notifications.inbox.loadFailed": [
    "Unable to load notifications. Please try again.",
    "Impossible de charger les notifications. Veuillez réessayer.",
    "No se pudieron cargar las notificaciones. Vuelve a intentarlo.",
    "تعذر تحميل الإشعارات. يرجى المحاولة مرة أخرى.",
    "无法加载通知，请重试。",
    "Horiima loowde tintine. Tiiɗno eto kadi.",
  ],
  "notifications.inbox.updateFailed": [
    "Unable to update the notification. Please try again.",
    "Impossible de mettre à jour la notification. Veuillez réessayer.",
    "No se pudo actualizar la notificación. Vuelve a intentarlo.",
    "تعذر تحديث الإشعار. يرجى المحاولة مرة أخرى.",
    "无法更新通知，请重试。",
    "Horiima hesɗitinde tintinal ngal. Tiiɗno eto kadi.",
  ],

  "marketplace.products.loadFailed": [
    "Unable to load products.",
    "Impossible de charger les produits.",
    "No se pudieron cargar los productos.",
    "تعذر تحميل المنتجات.",
    "无法加载商品。",
    "Horiima loowde kaake.",
  ],
  "marketplace.products.favoriteFailed": [
    "Unable to update favorite.",
    "Impossible de mettre à jour le favori.",
    "No se pudo actualizar el favorito.",
    "تعذر تحديث المفضلة.",
    "无法更新收藏。",
    "Horiima hesɗitinde ko cuɓaa.",
  ],

  "business.wallet.loadFailed": [
    "Unable to load the business wallet.",
    "Impossible de charger le portefeuille entreprise.",
    "No se pudo cargar la cartera de empresa.",
    "تعذر تحميل محفظة الشركة.",
    "无法加载企业钱包。",
    "Horiima loowde bursa jaajol.",
  ],
  "business.wallet.topupFailed": [
    "Top-up failed.",
    "Le rechargement a échoué.",
    "La recarga falló.",
    "فشل شحن الرصيد.",
    "充值失败。",
    "Ɓeydugol kaalis firlitii.",
  ],
  "business.wallet.cashoutFailed": [
    "Cash-out failed.",
    "Le retrait a échoué.",
    "El retiro falló.",
    "فشل السحب.",
    "提现失败。",
    "Yaltingol kaalis firlitii.",
  ],
  "business.wallet.stripeFailed": [
    "Unable to open Stripe Connect.",
    "Impossible d'ouvrir Stripe Connect.",
    "No se pudo abrir Stripe Connect.",
    "تعذر فتح Stripe Connect.",
    "无法打开 Stripe Connect。",
    "Horiima udditde Stripe Connect.",
  ],

  "taxi.tip.loadFailed": [
    "Unable to load the ride.",
    "Impossible de charger la course.",
    "No se pudo cargar el viaje.",
    "تعذر تحميل الرحلة.",
    "无法加载行程。",
    "Horiima loowde yahdu ndun.",
  ],
  "taxi.tip.payFailed": [
    "Unable to pay the tip.",
    "Impossible de payer le pourboire.",
    "No se pudo pagar la propina.",
    "تعذر دفع الإكرامية.",
    "无法支付小费。",
    "Horiima yoɓde dokkal ngal.",
  ],

  "seller.orders.updateFailed": [
    "Unable to update the order.",
    "Impossible de mettre à jour la commande.",
    "No se pudo actualizar el pedido.",
    "تعذر تحديث الطلب.",
    "无法更新订单。",
    "Horiima hesɗitinde jeyi ngan.",
  ],
  "seller.wallet.stripeFailed": [
    "Unable to open Stripe.",
    "Impossible d'ouvrir Stripe.",
    "No se pudo abrir Stripe.",
    "تعذر فتح Stripe.",
    "无法打开 Stripe。",
    "Horiima udditde Stripe.",
  ],
  "seller.onboarding.loadFailed": [
    "Unable to load your seller profile.",
    "Impossible de charger votre profil vendeur.",
    "No se pudo cargar tu perfil de vendedor.",
    "تعذر تحميل ملف البائع الخاص بك.",
    "无法加载您的卖家资料。",
    "Horiima loowde profil njeeygu maa.",
  ],
  "seller.onboarding.submitFailed": [
    "Unable to submit your application.",
    "Impossible d'envoyer votre demande.",
    "No se pudo enviar tu solicitud.",
    "تعذر إرسال طلبك.",
    "无法提交您的申请。",
    "Horiima neldude ɗaɓɓaandu maa.",
  ],

  "payment.stripe.paymentFailed": PROCESSING_ERROR,
  "payment.stripe.initFailed": [
    "The payment could not be started. Please try again in a few moments.",
    "Le paiement n'a pas pu être initialisé. Réessayez dans quelques instants.",
    "No se pudo iniciar el pago. Inténtalo de nuevo en unos instantes.",
    "تعذر بدء الدفع. يرجى المحاولة مرة أخرى بعد قليل.",
    "无法开始支付，请稍后重试。",
    "Njoɓdi ndin waawaa fuɗɗeede. Tiiɗno eto kadi caggal seeɗa.",
  ],
  "payment.stripe.tipInitFailed": [
    "The tip payment could not be started. Please try again.",
    "Le paiement du pourboire n'a pas pu être initialisé. Réessayez.",
    "No se pudo iniciar el pago de la propina. Inténtalo de nuevo.",
    "تعذر بدء دفع الإكرامية. حاول مرة أخرى.",
    "无法开始支付小费，请重试。",
    "Njoɓdi dokkal ngal waawaa fuɗɗeede. Eto kadi.",
  ],
};

function isObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!isObject(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getDeep(obj, dotted) {
  let cur = obj;
  for (const p of dotted.split(".")) {
    if (!isObject(cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

for (const [key, values] of Object.entries(ENTRIES)) {
  if (values.length !== LOCALES.length) {
    throw new Error(`${key}: expected ${LOCALES.length} translations`);
  }
  const en = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] === en && /[a-z]{4}/i.test(en)) {
      throw new Error(`${key}: ${LOCALES[i]} is an untranslated English copy`);
    }
  }
}

let total = 0;
for (let i = 0; i < LOCALES.length; i++) {
  const locale = LOCALES[i];
  const extrasPath = path.join(LOCALES_DIR, locale, "extras.json");
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));

  let changed = 0;
  for (const [key, values] of Object.entries(ENTRIES)) {
    if (getDeep(extras, key) === values[i]) continue;
    setDeep(extras, key, values[i]);
    changed += 1;
  }

  if (!DRY_RUN) {
    fs.writeFileSync(extrasPath, `${JSON.stringify(extras, null, 2)}\n`, "utf8");
  }
  total += changed;
  console.log(`${locale}: ${changed} key(s) written`);
}

const errorKeys = Object.keys(ENTRIES).filter((k) => k.startsWith("errors."));
console.log(
  `sync-error-i18n done — ${Object.keys(ENTRIES).length} keys (${errorKeys.length} under errors.*), ${total} value(s) ${DRY_RUN ? "would change" : "changed"}`,
);
