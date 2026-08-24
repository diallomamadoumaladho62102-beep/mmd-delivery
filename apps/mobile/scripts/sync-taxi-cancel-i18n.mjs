/**
 * Merge taxi cancel / stop / destination / rating i18n into extras.json
 * for the 6 supported locales. Run: node scripts/sync-taxi-cancel-i18n.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "..", "src", "i18n", "locales");
const LANGS = ["en", "fr", "es", "ar", "zh", "ff"];

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] &&
      typeof override[key] === "object" &&
      !Array.isArray(override[key]) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], override[key]);
    } else {
      out[key] = override[key];
    }
  }
  return out;
}

const patches = {
  en: {
    common: { continue: "Continue" },
    extras: {
      taxi: {
        ride: {
          addStop: "Add stop",
          addStopTitle: "Add stop",
          addStopBody:
            "Enter the stop address. Price will be recalculated on the server.",
          addStopConfirmTitle: "Confirm stop",
          addStopConfirmBody:
            "Confirm adding this stop? The route and price are recalculated on the server.",
          addStopConfirmBodyUp:
            "Adding this stop increases the fare by {{amount}} cents (server quote). Confirm?",
          changeDest: "Change destination",
          changeDestTitle: "Change destination",
          changeDestBody:
            "Enter the new destination. Price is recalculated on the server.",
          changeDestConfirmTitle: "Confirm new destination",
          changeDestConfirm:
            "Apply this destination? Server will recalculate distance and price.",
          changeDestConfirmUp:
            "New fare is higher by {{amount}} cents. Additional payment may be required.",
          addressPlaceholder: "Street address",
          cancelReasonTitle: "Why are you cancelling?",
          cancelReasonBody: "Select a reason. This helps improve the service.",
          cancelOtherTitle: "Describe what happened",
          cancelOtherBody: "Please explain why you are cancelling (required).",
          cancelOtherPlaceholder: "Write a short explanation",
          cancelOtherTooShort: "Please enter at least 3 characters.",
          cancelReasons: {
            driver_taking_too_long: "Driver taking too long",
            driver_too_far: "Driver is too far away",
            changed_mind: "Changed my mind",
            wrong_pickup: "Wrong pickup location",
            wrong_destination: "Wrong destination",
            found_another_option: "Found another option",
            problem_with_driver: "Problem with the driver",
            problem_with_vehicle: "Problem with the vehicle",
            pickup_problem: "Pickup problem",
            emergency: "Emergency",
            other: "Other",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "Release this ride? It will be offered to another nearby driver. Cancelling after accept may affect your acceptance activity.",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "Release this ride?",
          cancelWarn:
            "Cancelling after accept may affect your acceptance activity. The ride will be offered to another nearby driver — the customer is not refunded.",
          cancelOtherTitle: "Describe what happened",
          cancelOtherPlaceholder: "Write a short explanation",
          cancelOtherTooShort: "Please enter at least 3 characters.",
          cancelReasons: {
            vehicle_issue: "Vehicle issue",
            personal_emergency: "Personal emergency",
            unsafe_pickup: "Unsafe pickup",
            customer_unreachable: "Customer unreachable",
            traffic_or_route_blocked: "Traffic / route blocked",
            wrong_trip_details: "Wrong trip details",
            other: "Other",
          },
        },
      },
    },
  },
  fr: {
    common: { continue: "Continuer" },
    extras: {
      taxi: {
        ride: {
          addStop: "Ajouter un arrêt",
          addStopTitle: "Ajouter un arrêt",
          addStopBody:
            "Saisissez l’adresse de l’arrêt. Le prix est recalculé côté serveur.",
          addStopConfirmTitle: "Confirmer l’arrêt",
          addStopConfirmBody:
            "Confirmer cet arrêt ? L’itinéraire et le prix sont recalculés côté serveur.",
          addStopConfirmBodyUp:
            "Cet arrêt augmente le tarif de {{amount}} cents (devis serveur). Confirmer ?",
          changeDest: "Changer la destination",
          changeDestTitle: "Changer la destination",
          changeDestBody:
            "Saisissez la nouvelle destination. Le prix est recalculé côté serveur.",
          changeDestConfirmTitle: "Confirmer la nouvelle destination",
          changeDestConfirm:
            "Appliquer cette destination ? Le serveur recalcule distance et prix.",
          changeDestConfirmUp:
            "Le nouveau tarif est plus élevé de {{amount}} cents. Un paiement supplémentaire peut être requis.",
          addressPlaceholder: "Adresse",
          cancelReasonTitle: "Pourquoi annulez-vous ?",
          cancelReasonBody:
            "Sélectionnez une raison. Cela nous aide à améliorer le service.",
          cancelOtherTitle: "Décrivez ce qui s’est passé",
          cancelOtherBody: "Expliquez pourquoi vous annulez (obligatoire).",
          cancelOtherPlaceholder: "Écrivez une courte explication",
          cancelOtherTooShort: "Saisissez au moins 3 caractères.",
          cancelReasons: {
            driver_taking_too_long: "Le chauffeur met trop de temps",
            driver_too_far: "Le chauffeur est trop loin",
            changed_mind: "J’ai changé d’avis",
            wrong_pickup: "Mauvaise adresse de prise en charge",
            wrong_destination: "Mauvaise destination",
            found_another_option: "J’ai trouvé une autre option",
            problem_with_driver: "Problème avec le chauffeur",
            problem_with_vehicle: "Problème avec le véhicule",
            pickup_problem: "Problème de prise en charge",
            emergency: "Urgence",
            other: "Autre",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "Libérer cette course ? Elle sera proposée à un autre chauffeur proche. Annuler après acceptation peut affecter votre activité d’acceptation.",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "Libérer cette course ?",
          cancelWarn:
            "Annuler après acceptation peut affecter votre activité d’acceptation. La course sera proposée à un autre chauffeur proche — le client n’est pas remboursé.",
          cancelOtherTitle: "Décrivez ce qui s’est passé",
          cancelOtherPlaceholder: "Écrivez une courte explication",
          cancelOtherTooShort: "Saisissez au moins 3 caractères.",
          cancelReasons: {
            vehicle_issue: "Problème de véhicule",
            personal_emergency: "Urgence personnelle",
            unsafe_pickup: "Prise en charge dangereuse",
            customer_unreachable: "Client injoignable",
            traffic_or_route_blocked: "Circulation / itinéraire bloqué",
            wrong_trip_details: "Détails de course incorrects",
            other: "Autre",
          },
        },
      },
    },
  },
  es: {
    common: { continue: "Continuar" },
    extras: {
      taxi: {
        ride: {
          addStop: "Añadir parada",
          addStopTitle: "Añadir parada",
          addStopBody:
            "Introduce la dirección de la parada. El precio se recalcula en el servidor.",
          addStopConfirmTitle: "Confirmar parada",
          addStopConfirmBody:
            "¿Confirmar esta parada? La ruta y el precio se recalculan en el servidor.",
          addStopConfirmBodyUp:
            "Esta parada aumenta la tarifa en {{amount}} céntimos (cotización del servidor). ¿Confirmar?",
          changeDest: "Cambiar destino",
          changeDestTitle: "Cambiar destino",
          changeDestBody:
            "Introduce el nuevo destino. El precio se recalcula en el servidor.",
          changeDestConfirmTitle: "Confirmar nuevo destino",
          changeDestConfirm:
            "¿Aplicar este destino? El servidor recalculará distancia y precio.",
          changeDestConfirmUp:
            "La nueva tarifa es {{amount}} céntimos más alta. Puede requerirse un pago adicional.",
          addressPlaceholder: "Dirección",
          cancelReasonTitle: "¿Por qué cancelas?",
          cancelReasonBody:
            "Selecciona un motivo. Esto nos ayuda a mejorar el servicio.",
          cancelOtherTitle: "Describe lo ocurrido",
          cancelOtherBody: "Explica por qué cancelas (obligatorio).",
          cancelOtherPlaceholder: "Escribe una explicación breve",
          cancelOtherTooShort: "Introduce al menos 3 caracteres.",
          cancelReasons: {
            driver_taking_too_long: "El conductor tarda demasiado",
            driver_too_far: "El conductor está demasiado lejos",
            changed_mind: "Cambié de opinión",
            wrong_pickup: "Punto de recogida incorrecto",
            wrong_destination: "Destino incorrecto",
            found_another_option: "Encontré otra opción",
            problem_with_driver: "Problema con el conductor",
            problem_with_vehicle: "Problema con el vehículo",
            pickup_problem: "Problema en la recogida",
            emergency: "Emergencia",
            other: "Otro",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "¿Liberar este viaje? Se ofrecerá a otro conductor cercano. Cancelar después de aceptar puede afectar tu actividad de aceptación.",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "¿Liberar este viaje?",
          cancelWarn:
            "Cancelar después de aceptar puede afectar tu actividad de aceptación. El viaje se ofrecerá a otro conductor cercano: el cliente no recibe reembolso.",
          cancelOtherTitle: "Describe lo ocurrido",
          cancelOtherPlaceholder: "Escribe una explicación breve",
          cancelOtherTooShort: "Introduce al menos 3 caracteres.",
          cancelReasons: {
            vehicle_issue: "Problema del vehículo",
            personal_emergency: "Emergencia personal",
            unsafe_pickup: "Recogida insegura",
            customer_unreachable: "Cliente inalcanzable",
            traffic_or_route_blocked: "Tráfico / ruta bloqueada",
            wrong_trip_details: "Datos del viaje incorrectos",
            other: "Otro",
          },
        },
      },
    },
  },
  ar: {
    common: { continue: "متابعة" },
    extras: {
      taxi: {
        ride: {
          addStop: "إضافة محطة",
          addStopTitle: "إضافة محطة",
          addStopBody:
            "أدخل عنوان المحطة. يُعاد حساب السعر على الخادم.",
          addStopConfirmTitle: "تأكيد المحطة",
          addStopConfirmBody:
            "تأكيد إضافة هذه المحطة؟ يُعاد حساب المسار والسعر على الخادم.",
          addStopConfirmBodyUp:
            "إضافة هذه المحطة تزيد الأجرة بمقدار {{amount}} سنتًا (عرض الخادم). تأكيد؟",
          changeDest: "تغيير الوجهة",
          changeDestTitle: "تغيير الوجهة",
          changeDestBody:
            "أدخل الوجهة الجديدة. يُعاد حساب السعر على الخادم.",
          changeDestConfirmTitle: "تأكيد الوجهة الجديدة",
          changeDestConfirm:
            "تطبيق هذه الوجهة؟ سيعيد الخادم حساب المسافة والسعر.",
          changeDestConfirmUp:
            "الأجرة الجديدة أعلى بمقدار {{amount}} سنتًا. قد يلزم دفع إضافي.",
          addressPlaceholder: "عنوان الشارع",
          cancelReasonTitle: "لماذا تلغي؟",
          cancelReasonBody: "اختر سببًا. يساعدنا ذلك على تحسين الخدمة.",
          cancelOtherTitle: "صف ما حدث",
          cancelOtherBody: "يرجى توضيح سبب الإلغاء (مطلوب).",
          cancelOtherPlaceholder: "اكتب شرحًا مختصرًا",
          cancelOtherTooShort: "أدخل 3 أحرف على الأقل.",
          cancelReasons: {
            driver_taking_too_long: "السائق يستغرق وقتًا طويلاً",
            driver_too_far: "السائق بعيد جدًا",
            changed_mind: "غيّرت رأيي",
            wrong_pickup: "موقع الاستلام خاطئ",
            wrong_destination: "الوجهة خاطئة",
            found_another_option: "وجدت خيارًا آخر",
            problem_with_driver: "مشكلة مع السائق",
            problem_with_vehicle: "مشكلة في المركبة",
            pickup_problem: "مشكلة في الاستلام",
            emergency: "حالة طارئة",
            other: "أخرى",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "تحرير هذه الرحلة؟ سيتم عرضها على سائق قريب آخر. الإلغاء بعد القبول قد يؤثر على نشاط قبولك.",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "تحرير هذه الرحلة؟",
          cancelWarn:
            "الإلغاء بعد القبول قد يؤثر على نشاط قبولك. سيتم عرض الرحلة على سائق قريب آخر — لن يُسترد المبلغ للعميل.",
          cancelOtherTitle: "صف ما حدث",
          cancelOtherPlaceholder: "اكتب شرحًا مختصرًا",
          cancelOtherTooShort: "أدخل 3 أحرف على الأقل.",
          cancelReasons: {
            vehicle_issue: "مشكلة في المركبة",
            personal_emergency: "طوارئ شخصية",
            unsafe_pickup: "استلام غير آمن",
            customer_unreachable: "العميل غير قابل للوصول",
            traffic_or_route_blocked: "ازدحام / مسار مسدود",
            wrong_trip_details: "تفاصيل الرحلة غير صحيحة",
            other: "أخرى",
          },
        },
      },
    },
  },
  zh: {
    common: { continue: "继续" },
    extras: {
      taxi: {
        ride: {
          addStop: "添加途经点",
          addStopTitle: "添加途经点",
          addStopBody: "输入途经点地址。价格将由服务器重新计算。",
          addStopConfirmTitle: "确认途经点",
          addStopConfirmBody:
            "确认添加此途经点？路线和价格将由服务器重新计算。",
          addStopConfirmBodyUp:
            "添加此途经点会使车费增加 {{amount}} 美分（服务器报价）。确认？",
          changeDest: "更改目的地",
          changeDestTitle: "更改目的地",
          changeDestBody: "输入新的目的地。价格将由服务器重新计算。",
          changeDestConfirmTitle: "确认新目的地",
          changeDestConfirm: "应用此目的地？服务器将重新计算距离和价格。",
          changeDestConfirmUp:
            "新车费高出 {{amount}} 美分。可能需要补付。",
          addressPlaceholder: "街道地址",
          cancelReasonTitle: "您为什么取消？",
          cancelReasonBody: "请选择原因。这有助于我们改进服务。",
          cancelOtherTitle: "描述发生的情况",
          cancelOtherBody: "请说明取消原因（必填）。",
          cancelOtherPlaceholder: "写下简短说明",
          cancelOtherTooShort: "请至少输入 3 个字符。",
          cancelReasons: {
            driver_taking_too_long: "司机等待时间过长",
            driver_too_far: "司机距离太远",
            changed_mind: "我改变主意了",
            wrong_pickup: "上车地点错误",
            wrong_destination: "目的地错误",
            found_another_option: "找到了其他选择",
            problem_with_driver: "司机有问题",
            problem_with_vehicle: "车辆有问题",
            pickup_problem: "上车问题",
            emergency: "紧急情况",
            other: "其他",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "释放此行程？系统将提供给附近的其他司机。接受后再取消可能影响您的接单活跃度。",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "释放此行程？",
          cancelWarn:
            "接受后再取消可能影响您的接单活跃度。行程将提供给附近的其他司机——不会向乘客退款。",
          cancelOtherTitle: "描述发生的情况",
          cancelOtherPlaceholder: "写下简短说明",
          cancelOtherTooShort: "请至少输入 3 个字符。",
          cancelReasons: {
            vehicle_issue: "车辆问题",
            personal_emergency: "个人紧急情况",
            unsafe_pickup: "上车地点不安全",
            customer_unreachable: "无法联系乘客",
            traffic_or_route_blocked: "交通 / 路线受阻",
            wrong_trip_details: "行程信息不正确",
            other: "其他",
          },
        },
      },
    },
  },
  ff: {
    common: { continue: "Jokku" },
    extras: {
      taxi: {
        ride: {
          addStop: "Ɓeydu dartinal",
          addStopTitle: "Ɓeydu dartinal",
          addStopBody:
            "Naatnu ñiiɓirde dartinal. Njoɓdi hesɗitinete e sarworde.",
          addStopConfirmTitle: "Tabitin dartinal",
          addStopConfirmBody:
            "Tabitin ɓeydude dartinal ngal? Laawol e njoɓdi hesɗitinete e sarworde.",
          addStopConfirmBodyUp:
            "Dartinal ngal ɓeydata njoɓdi {{amount}} sent (njoɓdi sarworde). Tabitin?",
          changeDest: "Waylu jokkere",
          changeDestTitle: "Waylu jokkere",
          changeDestBody:
            "Naatnu jokkere hesere. Njoɓdi hesɗitinete e sarworde.",
          changeDestConfirmTitle: "Tabitin jokkere hesere",
          changeDestConfirm:
            "Huutoro jokkere ndee? Sarworde hesɗitinta njaajeendi e njoɓdi.",
          changeDestConfirmUp:
            "Njoɓdi hesere ɓuri {{amount}} sent. Njoɓdi ɓeydaandi ina waawi wajde.",
          addressPlaceholder: "Ñiiɓirde laawol",
          cancelReasonTitle: "Hol ko waɗi a haɗtata?",
          cancelReasonBody:
            "Suɓo daliilu. Ɗum wallata min ɓeydude golle.",
          cancelOtherTitle: "Siftin ko waɗi",
          cancelOtherBody: "Siftin hol ko waɗi a haɗtata (wajibi).",
          cancelOtherPlaceholder: "Winndu sifaa juutɗo",
          cancelOtherTooShort: "Naatnu ko famɗi fof 3 alkule.",
          cancelReasons: {
            driver_taking_too_long: "Driwer ina ɓooytoo",
            driver_too_far: "Driwer ina woɗɗi no feewi",
            changed_mind: "Mi waylii miijo am",
            wrong_pickup: "Ñiiɓirde ƴettugol moƴƴaani",
            wrong_destination: "Jokkere moƴƴaani",
            found_another_option: "Mi yiyii suɓo woɗɗo",
            problem_with_driver: "Caɗeele e driwer",
            problem_with_vehicle: "Caɗeele e oto",
            pickup_problem: "Caɗeele ƴettugol",
            emergency: "Kattanɗe",
            other: "Woɗɗude",
          },
        },
        driver: {
          activeRide: {
            cancelBody:
              "Accu ndee yahdu? Nde rokketee driwer woɗɗo ɓadiiɗo. Haɗtude caggal jaɓde ina waawi memde golle jaɓde maa.",
          },
        },
      },
      driver: {
        taxiPanel: {
          cancelTitle: "Accu ndee yahdu?",
          cancelWarn:
            "Haɗtude caggal jaɓde ina waawi memde golle jaɓde maa. Yahdu nduu rokketee driwer woɗɗo ɓadiiɗo — kelleer njoɓaaka.",
          cancelOtherTitle: "Siftin ko waɗi",
          cancelOtherPlaceholder: "Winndu sifaa juutɗo",
          cancelOtherTooShort: "Naatnu ko famɗi fof 3 alkule.",
          cancelReasons: {
            vehicle_issue: "Caɗeele oto",
            personal_emergency: "Kattanɗe keertiiɗe",
            unsafe_pickup: "Ƴettugol hisaani",
            customer_unreachable: "Kelleer heɓotaako",
            traffic_or_route_blocked: "Trafic / laawol tadanaama",
            wrong_trip_details: "Humpito yahdu moƴƴaani",
            other: "Woɗɗude",
          },
        },
      },
    },
  },
};

for (const lang of LANGS) {
  const patch = patches[lang];
  const extrasPath = path.join(localesDir, lang, "extras.json");
  const commonPath = path.join(localesDir, lang, "common.json");
  const extras = JSON.parse(fs.readFileSync(extrasPath, "utf8"));
  const common = JSON.parse(fs.readFileSync(commonPath, "utf8"));
  const nextExtras = deepMerge(extras, patch.extras);
  const nextCommon = deepMerge(common, { common: patch.common });
  fs.writeFileSync(extrasPath, `${JSON.stringify(nextExtras, null, 2)}\n`);
  fs.writeFileSync(commonPath, `${JSON.stringify(nextCommon, null, 2)}\n`);
  console.log(`updated ${lang}`);
}
