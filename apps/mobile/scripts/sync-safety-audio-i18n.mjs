/**
 * Sync taxi.tracking.safety translations into all locale extras.json files.
 * Run from apps/mobile: node scripts/sync-safety-audio-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");

const enSafety = {
  title: "Safety Audio",
  subtitle:
    "Record audio from your microphone for ride safety. Never starts silently. Files are private — not end-to-end encrypted.",
  consentTitle: "Start Safety Audio?",
  consentBody:
    "This records audio from YOUR device microphone only, for ride safety. It does not start silently. Files are private (not public), stored securely, retained about 14 days, and only you (or MMD staff during a review) can download your file. The other party is notified when you start — their consent is separate and does not turn on their microphone.",
  consentConfirm: "I understand — Record",
  micTitle: "Microphone",
  micBody:
    "Allow microphone access to record a safety audio for this ride. You can enable it in iOS Settings if it was blocked.",
  openSettings: "Open Settings",
  startedTitle: "Recording started",
  startedBody:
    "Your microphone is recording now. A red Recording indicator stays visible until you stop. The other party is notified but cannot control your mic.",
  activeIndicator: "RECORDING — your microphone is on",
  otherActive:
    "The other party started a safety recording on their device. Your microphone stays off unless you start yours.",
  bgTitle: "Recording may pause",
  bgBody:
    "Safety Audio records while MMD Delivery is open. Leaving the app or locking the screen may interrupt the recording — keep the app open to continue.",
  record: "Record",
  stop: "Stop",
  recording: "Recording… Stop",
  loading: "Loading safety tools…",
  notAllowed: "Safety recording is not allowed in this area.",
  uploadTitle: "Safety audio",
  uploadOk: "Recording uploaded securely.",
  stoppedOk:
    "Recording stopped and stored securely. Only you can open your own recording from this screen.",
  pendingTitle: "Pending upload",
  pendingBody:
    "You are offline. The recording is kept on this device and will upload when network returns.",
  pendingBadge: "Pending upload",
  openSecure: "Open your secure recording",
  openRecording: "Open recording",
  noActive: "No active recording.",
  errorTitle: "Error",
  uploadFailed: "Unable to upload the recording.",
  startFailed: "Unable to start recording.",
  stopFailed: "Unable to stop recording.",
  downloadFailed: "Unable to download the recording.",
  downloadUnavailable: "Download unavailable.",
  videoTitle: "Safety video (optional)",
  videoSubtitle:
    "Record an in-app front-camera video with audio for protection. Never starts silently.",
  videoConsentTitle: "Start Safety Video?",
  videoConsentBody:
    "This uses your camera and microphone inside MMD Delivery only. The other party is notified. Consent is independent — their mic is not turned on by this action.",
  videoActive:
    "RECORDING — safety video is active (camera + mic). Tap Stop to end.",
  videoRecord: "Record video",
  videoMicBody:
    "Allow microphone access for safety video audio. You can enable it in Settings if blocked.",
  cameraTitle: "Camera",
  cameraBody:
    "Allow camera access for in-app safety recording. Recording stays inside MMD Delivery.",
  cameraStarting: "Safety camera is starting. Tap Record again in a moment.",
  downloadBeforeExpiry: "Download before expiry ({{date}})",
  stopRecording: "Stop recording",
};

const translations = {
  fr: {
    title: "Audio de sécurité",
    subtitle:
      "Enregistrez l’audio avec votre micro pour la sécurité de la course. Jamais de démarrage silencieux. Fichiers privés — pas de chiffrement de bout en bout.",
    consentTitle: "Démarrer l’audio de sécurité ?",
    consentBody:
      "Cela enregistre uniquement le micro de VOTRE appareil, pour la sécurité de la course. Pas de démarrage silencieux. Fichiers privés, conservés environ 14 jours ; seuls vous (ou le staff MMD en revue) pouvez télécharger votre fichier. L’autre partie est notifiée — son consentement est séparé et n’active pas son micro.",
    consentConfirm: "Je comprends — Enregistrer",
    micTitle: "Microphone",
    micBody:
      "Autorisez le micro pour un audio de sécurité. Activez-le dans Réglages iOS s’il est bloqué.",
    openSettings: "Ouvrir Réglages",
    startedTitle: "Enregistrement démarré",
    startedBody:
      "Votre micro enregistre maintenant. Un indicateur rouge reste visible jusqu’à l’arrêt. L’autre partie est notifiée mais ne contrôle pas votre micro.",
    activeIndicator: "ENREGISTREMENT — votre micro est actif",
    otherActive:
      "L’autre partie a démarré un enregistrement de sécurité sur son appareil. Votre micro reste éteint tant que vous ne démarrez pas le vôtre.",
    bgTitle: "L’enregistrement peut s’interrompre",
    bgBody:
      "L’audio de sécurité enregistre tant que MMD Delivery est ouvert. Quitter l’app ou verrouiller l’écran peut interrompre l’enregistrement.",
    record: "Enregistrer",
    stop: "Arrêter",
    recording: "Enregistrement… Arrêter",
    loading: "Chargement des outils de sécurité…",
    notAllowed: "L’enregistrement de sécurité n’est pas autorisé dans cette zone.",
    uploadTitle: "Audio de sécurité",
    uploadOk: "Enregistrement envoyé de façon sécurisée.",
    stoppedOk:
      "Enregistrement arrêté et stocké de façon sécurisée. Seul vous pouvez ouvrir votre fichier ici.",
    pendingTitle: "Envoi en attente",
    pendingBody:
      "Vous êtes hors ligne. L’enregistrement reste sur cet appareil et sera envoyé au retour du réseau.",
    pendingBadge: "Envoi en attente",
    openSecure: "Ouvrir votre enregistrement sécurisé",
    openRecording: "Ouvrir l’enregistrement",
    noActive: "Aucun enregistrement actif.",
    errorTitle: "Erreur",
    uploadFailed: "Impossible d’envoyer l’enregistrement.",
    startFailed: "Impossible de démarrer l’enregistrement.",
    stopFailed: "Impossible d’arrêter l’enregistrement.",
    downloadFailed: "Impossible de télécharger l’enregistrement.",
    downloadUnavailable: "Téléchargement indisponible.",
    videoTitle: "Vidéo de sécurité (optionnelle)",
    videoSubtitle:
      "Enregistrez une vidéo caméra avant avec audio dans l’app. Jamais de démarrage silencieux.",
    videoConsentTitle: "Démarrer la vidéo de sécurité ?",
    videoConsentBody:
      "Utilise caméra et micro uniquement dans MMD Delivery. L’autre partie est notifiée. Consentement indépendant.",
    videoActive:
      "ENREGISTREMENT — vidéo de sécurité active (caméra + micro). Appuyez sur Arrêter.",
    videoRecord: "Enregistrer la vidéo",
    videoMicBody:
      "Autorisez le micro pour l’audio de la vidéo de sécurité. Activez-le dans Réglages s’il est bloqué.",
    cameraTitle: "Caméra",
    cameraBody:
      "Autorisez la caméra pour l’enregistrement de sécurité dans l’app.",
    cameraStarting: "Caméra de sécurité en démarrage. Réessayez dans un instant.",
    downloadBeforeExpiry: "Télécharger avant expiration ({{date}})",
    stopRecording: "Arrêter l’enregistrement",
  },
  es: {
    title: "Audio de seguridad",
    subtitle:
      "Graba audio con tu micrófono para la seguridad del viaje. Nunca inicia en silencio. Archivos privados — sin cifrado de extremo a extremo.",
    consentTitle: "¿Iniciar audio de seguridad?",
    consentBody:
      "Esto graba solo el micrófono de TU dispositivo. No inicia en silencio. Archivos privados ~14 días; solo tú (o el personal MMD en revisión) puedes descargar tu archivo. La otra parte recibe aviso — su consentimiento es independiente.",
    consentConfirm: "Entiendo — Grabar",
    micTitle: "Micrófono",
    micBody:
      "Permite el micrófono para grabar audio de seguridad. Actívalo en Ajustes si está bloqueado.",
    openSettings: "Abrir Ajustes",
    startedTitle: "Grabación iniciada",
    startedBody:
      "Tu micrófono está grabando. Un indicador rojo permanece visible hasta que detengas. La otra parte es notificada pero no controla tu micrófono.",
    activeIndicator: "GRABANDO — tu micrófono está activo",
    otherActive:
      "La otra parte inició una grabación de seguridad en su dispositivo. Tu micrófono permanece apagado hasta que inicies el tuyo.",
    bgTitle: "La grabación puede pausarse",
    bgBody:
      "El audio de seguridad graba mientras MMD Delivery está abierto. Salir o bloquear la pantalla puede interrumpir la grabación.",
    record: "Grabar",
    stop: "Detener",
    recording: "Grabando… Detener",
    loading: "Cargando herramientas de seguridad…",
    notAllowed: "La grabación de seguridad no está permitida en esta zona.",
    uploadTitle: "Audio de seguridad",
    uploadOk: "Grabación subida de forma segura.",
    stoppedOk:
      "Grabación detenida y almacenada de forma segura. Solo tú puedes abrir tu archivo aquí.",
    pendingTitle: "Subida pendiente",
    pendingBody:
      "Estás sin conexión. La grabación se guarda en este dispositivo y se subirá al volver la red.",
    pendingBadge: "Subida pendiente",
    openSecure: "Abrir tu grabación segura",
    openRecording: "Abrir grabación",
    noActive: "No hay grabación activa.",
    errorTitle: "Error",
    uploadFailed: "No se pudo subir la grabación.",
    startFailed: "No se pudo iniciar la grabación.",
    stopFailed: "No se pudo detener la grabación.",
    downloadFailed: "No se pudo descargar la grabación.",
    downloadUnavailable: "Descarga no disponible.",
    videoTitle: "Video de seguridad (opcional)",
    videoSubtitle:
      "Graba un video con cámara frontal y audio en la app. Nunca inicia en silencio.",
    videoConsentTitle: "¿Iniciar video de seguridad?",
    videoConsentBody:
      "Usa cámara y micrófono solo dentro de MMD Delivery. La otra parte es notificada. Consentimiento independiente.",
    videoActive:
      "GRABANDO — video de seguridad activo (cámara + mic). Pulsa Detener.",
    videoRecord: "Grabar video",
    videoMicBody:
      "Permite el micrófono para el audio del video de seguridad.",
    cameraTitle: "Cámara",
    cameraBody:
      "Permite la cámara para la grabación de seguridad en la app.",
    cameraStarting: "La cámara de seguridad está iniciando. Vuelve a tocar Grabar.",
    downloadBeforeExpiry: "Descargar antes de caducar ({{date}})",
    stopRecording: "Detener grabación",
  },
  ar: {
    title: "صوت الأمان",
    subtitle:
      "سجّل صوتًا من ميكروفونك لأمان الرحلة. لا يبدأ بصمت أبدًا. الملفات خاصة — بدون تشفير طرف إلى طرف.",
    consentTitle: "بدء صوت الأمان؟",
    consentBody:
      "يسجّل ميكروفون جهازك فقط لأمان الرحلة. لا يبدأ بصمت. ملفات خاصة تُحفظ نحو 14 يومًا؛ أنت فقط (أو فريق MMD عند المراجعة) يمكنك تنزيل ملفك. يُبلَّغ الطرف الآخر — موافقته منفصلة ولا تفعّل ميكروفونه.",
    consentConfirm: "أفهم — سجّل",
    micTitle: "الميكروفون",
    micBody:
      "اسمح بالوصول للميكروفون لتسجيل صوت الأمان. يمكنك تفعيله من الإعدادات إذا كان محظورًا.",
    openSettings: "فتح الإعدادات",
    startedTitle: "بدأ التسجيل",
    startedBody:
      "الميكروفون يسجّل الآن. يبقى مؤشر أحمر ظاهرًا حتى التوقيف. يُبلَّغ الطرف الآخر دون التحكم بميكروفونك.",
    activeIndicator: "جارٍ التسجيل — الميكروفون قيد التشغيل",
    otherActive:
      "بدأ الطرف الآخر تسجيل أمان على جهازه. يبقى ميكروفونك متوقفًا حتى تبدأ تسجيلك.",
    bgTitle: "قد يتوقف التسجيل",
    bgBody:
      "صوت الأمان يسجّل أثناء فتح التطبيق. مغادرة التطبيق أو قفل الشاشة قد يقطع التسجيل.",
    record: "تسجيل",
    stop: "إيقاف",
    recording: "جارٍ التسجيل… إيقاف",
    loading: "جارٍ تحميل أدوات الأمان…",
    notAllowed: "تسجيل الأمان غير مسموح في هذه المنطقة.",
    uploadTitle: "صوت الأمان",
    uploadOk: "تم رفع التسجيل بأمان.",
    stoppedOk:
      "تم إيقاف التسجيل وتخزينه بأمان. يمكنك فقط فتح تسجيلك من هنا.",
    pendingTitle: "رفع معلّق",
    pendingBody:
      "أنت دون اتصال. يبقى التسجيل على الجهاز ويُرفع عند عودة الشبكة.",
    pendingBadge: "رفع معلّق",
    openSecure: "افتح تسجيلك الآمن",
    openRecording: "فتح التسجيل",
    noActive: "لا يوجد تسجيل نشط.",
    errorTitle: "خطأ",
    uploadFailed: "تعذر رفع التسجيل.",
    startFailed: "تعذر بدء التسجيل.",
    stopFailed: "تعذر إيقاف التسجيل.",
    downloadFailed: "تعذر تنزيل التسجيل.",
    downloadUnavailable: "التنزيل غير متاح.",
    videoTitle: "فيديو الأمان (اختياري)",
    videoSubtitle:
      "سجّل فيديو بالكاميرا الأمامية مع صوت داخل التطبيق. لا يبدأ بصمت.",
    videoConsentTitle: "بدء فيديو الأمان؟",
    videoConsentBody:
      "يستخدم الكاميرا والميكروفون داخل MMD فقط. يُبلَّغ الطرف الآخر. الموافقة مستقلة.",
    videoActive:
      "جارٍ التسجيل — فيديو الأمان نشط (كاميرا + ميكروفون). اضغط إيقاف.",
    videoRecord: "تسجيل فيديو",
    videoMicBody: "اسمح بالميكروفون لصوت فيديو الأمان.",
    cameraTitle: "الكاميرا",
    cameraBody: "اسمح بالكاميرا لتسجيل الأمان داخل التطبيق.",
    cameraStarting: "كاميرا الأمان تبدأ. اضغط تسجيل مرة أخرى بعد لحظة.",
    downloadBeforeExpiry: "نزّل قبل انتهاء الصلاحية ({{date}})",
    stopRecording: "إيقاف التسجيل",
  },
  zh: {
    title: "安全录音",
    subtitle:
      "使用您的麦克风录制行程安全音频。绝不会静默开始。文件私密 — 非端到端加密。",
    consentTitle: "开始安全录音？",
    consentBody:
      "仅录制您设备上的麦克风，用于行程安全。不会静默开始。文件私密，保留约 14 天；仅您（或审核中的 MMD 工作人员）可下载。对方会收到通知 — 其同意独立，不会打开对方麦克风。",
    consentConfirm: "我了解 — 开始录音",
    micTitle: "麦克风",
    micBody: "请允许麦克风以录制安全音频。若被禁用，请在系统设置中开启。",
    openSettings: "打开设置",
    startedTitle: "录音已开始",
    startedBody:
      "麦克风正在录音。红色录音指示会一直显示直到停止。对方会收到通知，但无法控制您的麦克风。",
    activeIndicator: "录音中 — 麦克风已开启",
    otherActive:
      "对方已在其设备上开始安全录制。除非您开始自己的录音，否则您的麦克风保持关闭。",
    bgTitle: "录音可能中断",
    bgBody:
      "安全录音仅在应用打开时进行。离开应用或锁屏可能中断录音。",
    record: "录音",
    stop: "停止",
    recording: "录音中… 停止",
    loading: "正在加载安全工具…",
    notAllowed: "此地区不允许安全录制。",
    uploadTitle: "安全录音",
    uploadOk: "录音已安全上传。",
    stoppedOk: "录音已停止并安全存储。仅您可在此打开自己的录音。",
    pendingTitle: "待上传",
    pendingBody: "您处于离线状态。录音保存在本机，网络恢复后将上传。",
    pendingBadge: "待上传",
    openSecure: "打开您的安全录音",
    openRecording: "打开录音",
    noActive: "没有进行中的录音。",
    errorTitle: "错误",
    uploadFailed: "无法上传录音。",
    startFailed: "无法开始录音。",
    stopFailed: "无法停止录音。",
    downloadFailed: "无法下载录音。",
    downloadUnavailable: "无法下载。",
    videoTitle: "安全视频（可选）",
    videoSubtitle: "在应用内录制前置摄像头视频（含音频）。绝不会静默开始。",
    videoConsentTitle: "开始安全视频？",
    videoConsentBody:
      "仅在 MMD Delivery 内使用摄像头和麦克风。对方会收到通知。同意相互独立。",
    videoActive: "录音中 — 安全视频进行中（摄像头 + 麦克风）。点停止结束。",
    videoRecord: "录制视频",
    videoMicBody: "请允许麦克风用于安全视频的音频。",
    cameraTitle: "摄像头",
    cameraBody: "请允许摄像头以进行应用内安全录制。",
    cameraStarting: "安全摄像头正在启动。请稍后再点录制。",
    downloadBeforeExpiry: "在到期前下载（{{date}}）",
    stopRecording: "停止录制",
  },
  ff: {
    title: "Audio kisal",
    subtitle:
      "Nattal audio e mikrofon maa ngam kisal yahdu. Fuɗɗataa e deƴƴere. Failuuji ina keewi — wonaa encrypt eee.",
    consentTitle: "Fuɗɗu audio kisal?",
    consentBody:
      "Ɗum nattal mikrofon kaɓirgal MAA tan ngam kisal yahdu. Fuɗɗataa e deƴƴere. Failuuji ina keewi ~14 ñalɗi; an tan (walla gollotooɓe MMD e nder njillu) mbaawi awlugo fail maa. Goɗɗo oo ina anndinaa — jaɓgol mum ina seertii, ɗum uddataa mikrofon mum.",
    consentConfirm: "Mi faami — Nattal",
    micTitle: "Mikrofon",
    micBody:
      "Yokku mikrofon ngam nattal audio kisal. Uddit e Settings so ina uddii.",
    openSettings: "Uddit Settings",
    startedTitle: "Nattal fuɗɗii",
    startedBody:
      "Mikrofon maa ina nattal jooni. Holloɗo boɗeejo ina yiyee haa a dartina. Goɗɗo oo ina anndinaa kono o waawaa ƴeewde mikrofon maa.",
    activeIndicator: "NATTAL — mikrofon maa ina udditii",
    otherActive:
      "Goɗɗo oo fuɗɗii nattal kisal e kaɓirgal mum. Mikrofon maa ina uddii so a fuɗɗaani nattal maa.",
    bgTitle: "Nattal ina waawi dartude",
    bgBody:
      "Audio kisal ina nattal so MMD Delivery ina udditii. Yaltude app walla uddude yaynirde ina waawi dartinde nattal.",
    record: "Nattal",
    stop: "Dartin",
    recording: "Nattal… Dartin",
    loading: "Loowgol kuutorɗe kisal…",
    notAllowed: "Nattal kisal yamiraaka e ndee nokkuure.",
    uploadTitle: "Audio kisal",
    uploadOk: "Nattal neldaama e kisal.",
    stoppedOk:
      "Nattal dartinaama e mooftaama e kisal. An tan mbaawi udditde nattal maa ɗoo.",
    pendingTitle: "Neldu nguura",
    pendingBody:
      "Aɗa woni e nder lowre. Nattal ina heddii e kaɓirgal, neldete so lowre arti.",
    pendingBadge: "Neldu nguura",
    openSecure: "Uddit nattal maa kisal",
    openRecording: "Uddit nattal",
    noActive: "Alaa nattal e nder golle.",
    errorTitle: "Juumre",
    uploadFailed: "Horiima neldude nattal ngal.",
    startFailed: "Horiima fuɗɗude nattal.",
    stopFailed: "Horiima dartinde nattal.",
    downloadFailed: "Horiima awlugo nattal ngal.",
    downloadUnavailable: "Awlugo horiima.",
    videoTitle: "Wideyo kisal (suɓaande)",
    videoSubtitle:
      "Nattal wideyo kamera yeeso e audio nder app. Fuɗɗataa e deƴƴere.",
    videoConsentTitle: "Fuɗɗu wideyo kisal?",
    videoConsentBody:
      "Huutoroo kamera e mikrofon nder MMD tan. Goɗɗo oo ina anndinaa. Jaɓgol ina seertii.",
    videoActive:
      "NATTAL — wideyo kisal ina golle (kamera + mikrofon). Ñoƴƴu Dartin.",
    videoRecord: "Nattal wideyo",
    videoMicBody: "Yokku mikrofon ngam audio wideyo kisal.",
    cameraTitle: "Kamera",
    cameraBody: "Yokku kamera ngam nattal kisal nder app.",
    cameraStarting: "Kamera kisal ina fuɗɗoo. Ñoƴƴu Nattal kadi so ƴeewii.",
    downloadBeforeExpiry: "Awlugo hade nde joofa ({{date}})",
    stopRecording: "Dartin nattal",
  },
};

function ensureTrackingSafety(obj, safety) {
  if (!obj.taxi || typeof obj.taxi !== "object") obj.taxi = {};
  if (!obj.taxi.tracking || typeof obj.taxi.tracking !== "object") {
    obj.taxi.tracking = {};
  }
  obj.taxi.tracking.safety = { ...enSafety, ...safety };
  return obj;
}

for (const [lang, safety] of Object.entries(translations)) {
  const file = path.join(localesDir, lang, "extras.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  ensureTrackingSafety(data, safety);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`updated ${lang}/extras.json taxi.tracking.safety`);
}

// Ensure EN has video keys too
const enFile = path.join(localesDir, "en", "extras.json");
const enData = JSON.parse(fs.readFileSync(enFile, "utf8"));
ensureTrackingSafety(enData, enSafety);
fs.writeFileSync(enFile, `${JSON.stringify(enData, null, 2)}\n`, "utf8");
console.log("updated en/extras.json taxi.tracking.safety");
console.log("sync-safety-audio-i18n done");
