/**
 * Client food / package / ride checkout strings.
 * Consumed by i18n-locale-gap-catalog.mjs and patch-i18n-locale-gaps.mjs.
 */
const L = (map, lang) => map[lang] ?? map.en;

export function clientRestaurantMenu(lang) {
  return {
    header: {
      subtitle: L(
        {
          en: "Browse the menu and add dishes to your MMD order.",
          fr: "Parcours le menu et ajoute des plats à ta commande MMD.",
          es: "Explora el menú y añade platos a tu pedido MMD.",
          ar: "تصفح القائمة وأضف أطباقًا إلى طلب MMD.",
          zh: "浏览菜单并将菜品加入你的 MMD 订单。",
          ff: "Yiy menu oo ɓeyd ñaamdu e njamndi MMD maa.",
        },
        lang,
      ),
    },
    createOrderError: L(
      {
        en: "Unable to create the order right now.",
        fr: "Impossible de créer la commande pour le moment.",
        es: "No se puede crear el pedido ahora.",
        ar: "تعذر إنشاء الطلب الآن.",
        zh: "目前无法创建订单。",
        ff: "Horiima sosde njamndi oo sahaa.",
      },
      lang,
    ),
    loadMenuError: L(
      {
        en: "Unable to load this restaurant menu right now.",
        fr: "Impossible de charger le menu de ce restaurant pour le moment.",
        es: "No se puede cargar el menú de este restaurante ahora.",
        ar: "تعذر تحميل قائمة هذا المطعم الآن.",
        zh: "目前无法加载这家餐厅的菜单。",
        ff: "Horiima loowde menu restoraa oo sahaa.",
      },
      lang,
    ),
    estimateError: L(
      {
        en: "Unable to calculate the delivery estimate right now.",
        fr: "Impossible de calculer l’estimation de livraison pour le moment.",
        es: "No se puede calcular la estimación de entrega ahora.",
        ar: "تعذر حساب تقدير التوصيل الآن.",
        zh: "目前无法计算配送估价。",
        ff: "Horiima hiisde ƴeewndo neldol oo sahaa.",
      },
      lang,
    ),
    cartEmptyTitle: L(
      {
        en: "Empty cart",
        fr: "Panier vide",
        es: "Carrito vacío",
        ar: "السلة فارغة",
        zh: "购物车为空",
        ff: "Panier ɓolɗo",
      },
      lang,
    ),
    cartEmptyEstimate: L(
      {
        en: "Add at least one dish before estimating delivery.",
        fr: "Ajoute au moins un plat avant l’estimation.",
        es: "Añade al menos un plato antes de estimar la entrega.",
        ar: "أضف طبقًا واحدًا على الأقل قبل تقدير التوصيل.",
        zh: "请先添加至少一道菜再估算配送。",
        ff: "Ɓeydu ñaamdu gooto so a hiisata neldol.",
      },
      lang,
    ),
    cartEmptyCreate: L(
      {
        en: "Add at least one dish to your order.",
        fr: "Ajoute au moins un plat à ta commande.",
        es: "Añade al menos un plato a tu pedido.",
        ar: "أضف طبقًا واحدًا على الأقل إلى طلبك.",
        zh: "请至少向订单添加一道菜。",
        ff: "Ɓeydu ñaamdu gooto e njamndi maa.",
      },
      lang,
    ),
    missingFieldsTitle: L(
      {
        en: "Missing fields",
        fr: "Champs manquants",
        es: "Campos incompletos",
        ar: "حقول ناقصة",
        zh: "缺少字段",
        ff: "Galleeji ŋattaaɗi",
      },
      lang,
    ),
    missingFieldsEstimate: L(
      {
        en: "Enter the restaurant pickup address and the delivery address.",
        fr: "Saisis l’adresse du restaurant et l’adresse de livraison.",
        es: "Introduce la dirección del restaurante y la de entrega.",
        ar: "أدخل عنوان استلام المطعم وعنوان التسليم.",
        zh: "请输入餐厅取餐地址和送餐地址。",
        ff: "Naatnu ñiiɓirde restoraa e ñiiɓirde neldol.",
      },
      lang,
    ),
    missingFieldsCreate: L(
      {
        en: "Enter the pickup address and the delivery address.",
        fr: "Saisis l’adresse de retrait et l’adresse de livraison.",
        es: "Introduce la dirección de recogida y la de entrega.",
        ar: "أدخل عنوان الاستلام وعنوان التسليم.",
        zh: "请输入取餐地址和送餐地址。",
        ff: "Naatnu ñiiɓirde ƴettugol e ñiiɓirde neldol.",
      },
      lang,
    ),
    incompleteAddressTitle: L(
      {
        en: "Incomplete address",
        fr: "Adresse incomplète",
        es: "Dirección incompleta",
        ar: "عنوان غير مكتمل",
        zh: "地址不完整",
        ff: "Ñiiɓirde timmaani",
      },
      lang,
    ),
    incompleteAddressBody: L(
      {
        en: "Enter a more complete address before calculating delivery.",
        fr: "Saisis une adresse plus complète avant de calculer la livraison.",
        es: "Introduce una dirección más completa antes de calcular la entrega.",
        ar: "أدخل عنوانًا أكمل قبل حساب التوصيل.",
        zh: "请输入更完整的地址后再计算配送。",
        ff: "Naatnu ñiiɓirde ɓurnde timmude hade hiisde neldol.",
      },
      lang,
    ),
    missingConfigTitle: L(
      {
        en: "Missing configuration",
        fr: "Configuration manquante",
        es: "Configuración incompleta",
        ar: "إعداد ناقص",
        zh: "缺少配置",
        ff: "Teelte ŋattaaɗe",
      },
      lang,
    ),
    missingConfigBody: L(
      {
        en: "The API base URL is not configured.",
        fr: "L’URL de l’API n’est pas configurée.",
        es: "La URL base de la API no está configurada.",
        ar: "لم يُضبط عنوان واجهة البرمجة.",
        zh: "未配置 API 基础地址。",
        ff: "URL API teeltaaka.",
      },
      lang,
    ),
    missingCoordsTitle: L(
      {
        en: "Missing coordinates",
        fr: "Coordonnées manquantes",
        es: "Coordenadas incompletas",
        ar: "الإحداثيات ناقصة",
        zh: "缺少坐标",
        ff: "Coords ŋattaaɗi",
      },
      lang,
    ),
    missingCoordsBody: L(
      {
        en: "Recalculate the estimate to get GPS coordinates before creating the order.",
        fr: "Relance l’estimation pour récupérer les coordonnées GPS avant de créer la commande.",
        es: "Vuelve a calcular la estimación para obtener las coordenadas GPS antes de crear el pedido.",
        ar: "أعد حساب التقدير للحصول على إحداثيات GPS قبل إنشاء الطلب.",
        zh: "请重新估算以获取 GPS 坐标，然后再创建订单。",
        ff: "Hiit ƴeewndo ngam heɓde coords GPS hade sosde njamndi.",
      },
      lang,
    ),
    orderBlockedTitle: L(
      {
        en: "Order blocked",
        fr: "Commande bloquée",
        es: "Pedido bloqueado",
        ar: "الطلب محظور",
        zh: "订单已阻止",
        ff: "Njamndi ko haɗaaɗo",
      },
      lang,
    ),
    orderBlockedBody: L(
      {
        en: "Distance is too far ({{miles}} mi).\n\nFix the address (ZIP / city / state).",
        fr: "Distance trop grande ({{miles}} mi).\n\nCorrige l’adresse (code postal / ville / État).",
        es: "La distancia es demasiado grande ({{miles}} mi).\n\nCorrige la dirección (ZIP / ciudad / estado).",
        ar: "المسافة كبيرة جدًا ({{miles}} ميل).\n\nصحّح العنوان (الرمز البريدي / المدينة / الولاية).",
        zh: "距离过远（{{miles}} 英里）。\n\n请修正地址（邮编 / 城市 / 州）。",
        ff: "Woɗɗude ɓurnde ({{miles}} mi).\n\nSafru ñiiɓirde (ZIP / wuro / diiwaan).",
      },
      lang,
    ),
    verifyAddressTitle: L(
      {
        en: "Address to verify",
        fr: "Adresse à vérifier",
        es: "Dirección por verificar",
        ar: "عنوان يحتاج تحققًا",
        zh: "请核对地址",
        ff: "Ñiiɓirde ina sokli ƴeewndo",
      },
      lang,
    ),
    verifyAddressBody: L(
      {
        en: "Very long distance: {{miles}} mi.\n\nCheck the ZIP, city, and state.\nEx: \"Brooklyn NY 11226\".",
        fr: "Distance très grande : {{miles}} mi.\n\nVérifie le code postal, la ville et l’État.\nEx. : « Brooklyn NY 11226 ».",
        es: "Distancia muy grande: {{miles}} mi.\n\nComprueba el ZIP, la ciudad y el estado.\nEj.: \"Brooklyn NY 11226\".",
        ar: "مسافة طويلة جدًا: {{miles}} ميل.\n\nتحقق من الرمز البريدي والمدينة والولاية.\nمثال: \"Brooklyn NY 11226\".",
        zh: "距离很远：{{miles}} 英里。\n\n请核对邮编、城市和州。\n例如：\"Brooklyn NY 11226\"。",
        ff: "Woɗɗude juutunde: {{miles}} mi.\n\nƳeewto ZIP, wuro e diiwaan.\nYeru: \"Brooklyn NY 11226\".",
      },
      lang,
    ),
    errors: {
      missingRestaurantId: L(
        {
          en: "Restaurant not found. Go back to the restaurant list and try again.",
          fr: "Restaurant introuvable. Retourne à la liste des restaurants puis réessaie.",
          es: "Restaurante no encontrado. Vuelve a la lista e inténtalo de nuevo.",
          ar: "المطعم غير موجود. ارجع إلى قائمة المطاعم ثم أعد المحاولة.",
          zh: "未找到餐厅。请返回餐厅列表后重试。",
          ff: "Restoraa yiytaaka. Rutto e doggol restoraaji ndeen fuɗɗit.",
        },
        lang,
      ),
      restaurantUnavailable: L(
        {
          en: "This restaurant is unavailable or its GPS address is not set yet.",
          fr: "Ce restaurant n’est pas disponible ou son adresse GPS n’est pas encore configurée.",
          es: "Este restaurante no está disponible o su dirección GPS aún no está configurada.",
          ar: "هذا المطعم غير متاح أو لم يُضبط عنوانه على GPS بعد.",
          zh: "这家餐厅不可用，或其 GPS 地址尚未设置。",
          ff: "Oo restoraa hebɓaaki walla ñiiɓirde GPS mum teeltaaka tawo.",
        },
        lang,
      ),
      deliveryShareInvalid: L(
        {
          en: "Delivery pricing is temporarily unavailable. Please try again later or contact support.",
          fr: "La configuration de livraison est temporairement indisponible. Réessayez plus tard ou contactez le support.",
          es: "Los precios de entrega no están disponibles temporalmente. Inténtalo más tarde o contacta a soporte.",
          ar: "تسعير التوصيل غير متاح مؤقتًا. أعد المحاولة لاحقًا أو تواصل مع الدعم.",
          zh: "配送计价暂时不可用。请稍后重试或联系支持。",
          ff: "Njoɓdi neldol hebɓaaki e sahaa. Fuɗɗit so yahii walla jokkondir e ballal.",
        },
        lang,
      ),
    },
    estimate: {
      errors: {
        generic: L(
          {
            en: "Unable to calculate delivery right now.",
            fr: "Impossible de calculer la livraison pour le moment.",
            es: "No se puede calcular la entrega ahora.",
            ar: "تعذر حساب التوصيل الآن.",
            zh: "目前无法计算配送。",
            ff: "Horiima hiisde neldol oo sahaa.",
          },
          lang,
        ),
        tooFarOrImprecise: L(
          {
            en: "Destination is too far or the address is not precise enough. Check the street, ZIP, city, and state.",
            fr: "Destination trop éloignée ou adresse pas assez précise. Vérifie la rue, le code postal, la ville et l’État.",
            es: "El destino está demasiado lejos o la dirección no es lo bastante precisa. Comprueba calle, ZIP, ciudad y estado.",
            ar: "الوجهة بعيدة جدًا أو العنوان غير دقيق. تحقق من الشارع والرمز البريدي والمدينة والولاية.",
            zh: "目的地过远或地址不够精确。请核对街道、邮编、城市和州。",
            ff: "Gaaɗo ɓuri woɗɗude walla ñiiɓirde laaɓaani. Ƴeewto laawol, ZIP, wuro e diiwaan.",
          },
          lang,
        ),
        noRoute: L(
          {
            en: "No delivery route was found for this destination. Check the address.",
            fr: "Aucun itinéraire de livraison trouvé pour cette destination. Vérifie l’adresse.",
            es: "No se encontró ruta de entrega para este destino. Comprueba la dirección.",
            ar: "لم يُعثر على مسار توصيل لهذه الوجهة. تحقق من العنوان.",
            zh: "未找到通往该目的地的配送路线。请核对地址。",
            ff: "Alaa laawol neldol tawaangol ngam ndee gaaɗo. Ƴeewto ñiiɓirde.",
          },
          lang,
        ),
        timeout: L(
          {
            en: "The estimate request took too long. Try again.",
            fr: "La demande d’estimation a pris trop de temps. Réessaie.",
            es: "La estimación tardó demasiado. Inténtalo de nuevo.",
            ar: "استغرق طلب التقدير وقتًا طويلًا. أعد المحاولة.",
            zh: "估价请求超时。请重试。",
            ff: "Ñaagol ƴeewndo ɓuri juutude. Fuɗɗit.",
          },
          lang,
        ),
        invalidResponse: L(
          {
            en: "Invalid response from the delivery estimate service.",
            fr: "Réponse invalide du service d’estimation de livraison.",
            es: "Respuesta no válida del servicio de estimación.",
            ar: "استجابة غير صالحة من خدمة تقدير التوصيل.",
            zh: "配送估价服务返回无效响应。",
            ff: "Jaabawol moƴƴaani ummoraade e sarwiis ƴeewndo neldol.",
          },
          lang,
        ),
        invalidApiResponse: L(
          {
            en: "Invalid response from the distance service.",
            fr: "Réponse invalide du service de distance.",
            es: "Respuesta no válida del servicio de distancia.",
            ar: "استجابة غير صالحة من خدمة المسافة.",
            zh: "距离服务返回无效响应。",
            ff: "Jaabawol moƴƴaani ummoraade e sarwiis woɗɗude.",
          },
          lang,
        ),
        invalidDistanceEta: L(
          {
            en: "Invalid distance or ETA received from the estimate service.",
            fr: "Distance ou temps estimé invalide reçu depuis le service d’estimation.",
            es: "Distancia o tiempo estimado no válido del servicio de estimación.",
            ar: "مسافة أو وقت وصول غير صالح من خدمة التقدير.",
            zh: "估价服务返回的距离或预计时间无效。",
            ff: "Woɗɗude walla waktu ƴeewndo moƴƴaani ummoraade e sarwiis.",
          },
          lang,
        ),
        invalidMapboxDistanceEta: L(
          {
            en: "Invalid distance or time response from Mapbox.",
            fr: "Réponse distance/temps invalide depuis l’API Mapbox.",
            es: "Respuesta de distancia/tiempo no válida de Mapbox.",
            ar: "استجابة مسافة/وقت غير صالحة من Mapbox.",
            zh: "Mapbox 返回的距离或时间无效。",
            ff: "Jaabawol woɗɗude/waktu moƴƴaani ummoraade e Mapbox.",
          },
          lang,
        ),
        distanceTooLarge: L(
          {
            en: "Distance is too far ({{miles}} mi). Check the ZIP, city, and state.",
            fr: "Distance trop grande ({{miles}} mi). Vérifie le code postal, la ville et l’État.",
            es: "La distancia es demasiado grande ({{miles}} mi). Comprueba ZIP, ciudad y estado.",
            ar: "المسافة كبيرة جدًا ({{miles}} ميل). تحقق من الرمز البريدي والمدينة والولاية.",
            zh: "距离过远（{{miles}} 英里）。请核对邮编、城市和州。",
            ff: "Woɗɗude ɓurnde ({{miles}} mi). Ƴeewto ZIP, wuro e diiwaan.",
          },
          lang,
        ),
      },
    },
    menu: {
      title: L(
        {
          en: "Restaurant menu",
          fr: "Menu du restaurant",
          es: "Menú del restaurante",
          ar: "قائمة المطعم",
          zh: "餐厅菜单",
          ff: "Menu restoraa",
        },
        lang,
      ),
      loading: L(
        {
          en: "Loading menu…",
          fr: "Chargement du menu…",
          es: "Cargando menú…",
          ar: "جارٍ تحميل القائمة…",
          zh: "正在加载菜单…",
          ff: "Nana loowa menu…",
        },
        lang,
      ),
      empty: L(
        {
          en: "No dishes yet. This restaurant has not configured its MMD menu.",
          fr: "Aucun plat pour l’instant. Le restaurant n’a pas encore configuré son menu dans MMD Delivery.",
          es: "Aún no hay platos. Este restaurante no ha configurado su menú MMD.",
          ar: "لا توجد أطباق بعد. لم يضبط هذا المطعم قائمته في MMD.",
          zh: "暂无菜品。这家餐厅尚未配置 MMD 菜单。",
          ff: "Alaa ñaamdu tawo. Restoraa oo teeltaaki menu MMD mum.",
        },
        lang,
      ),
      add: L(
        {
          en: "Add",
          fr: "Ajouter",
          es: "Añadir",
          ar: "إضافة",
          zh: "添加",
          ff: "Ɓeydu",
        },
        lang,
      ),
      itemUnavailable: L(
        {
          en: "This dish is no longer available.",
          fr: "Ce plat n’est plus disponible pour le moment.",
          es: "Este plato ya no está disponible.",
          ar: "هذا الطبق لم يعد متاحًا.",
          zh: "这道菜暂时不可用。",
          ff: "Ndee ñaamdu hebɓaaki tawo.",
        },
        lang,
      ),
    },
    addresses: {
      title: L(
        {
          en: "Delivery addresses",
          fr: "Adresses pour la livraison",
          es: "Direcciones de entrega",
          ar: "عناوين التوصيل",
          zh: "配送地址",
          ff: "Ñiiɓirɗe neldol",
        },
        lang,
      ),
      pickupLabel: L(
        {
          en: "Pickup address (restaurant / start point)",
          fr: "Adresse de retrait (restaurant / point de départ)",
          es: "Dirección de recogida (restaurante / punto de partida)",
          ar: "عنوان الاستلام (المطعم / نقطة الانطلاق)",
          zh: "取餐地址（餐厅 / 起点）",
          ff: "Ñiiɓirde ƴettugol (restoraa / fuɗɗorde)",
        },
        lang,
      ),
      deliveryLabel: L(
        {
          en: "Delivery address (customer)",
          fr: "Adresse de livraison (client)",
          es: "Dirección de entrega (cliente)",
          ar: "عنوان التسليم (العميل)",
          zh: "送餐地址（客户）",
          ff: "Ñiiɓirde neldol (kiliyee)",
        },
        lang,
      ),
      dropoffLabel: L(
        {
          en: "Delivery address (customer)",
          fr: "Adresse de livraison (client)",
          es: "Dirección de entrega (cliente)",
          ar: "عنوان التسليم (العميل)",
          zh: "送餐地址（客户）",
          ff: "Ñiiɓirde neldol (kiliyee)",
        },
        lang,
      ),
      pickupPlaceholder: L(
        {
          en: "Ex: 686 Vermont St Brooklyn NY 11207",
          fr: "Ex. : 686 Vermont St Brooklyn NY 11207",
          es: "Ej.: 686 Vermont St Brooklyn NY 11207",
          ar: "مثال: 686 Vermont St Brooklyn NY 11207",
          zh: "例如：686 Vermont St Brooklyn NY 11207",
          ff: "Yeru: 686 Vermont St Brooklyn NY 11207",
        },
        lang,
      ),
      dropoffPlaceholder: L(
        {
          en: "Ex: 1112 Flatbush Ave Brooklyn NY 11226",
          fr: "Ex. : 1112 Flatbush Ave Brooklyn NY 11226",
          es: "Ej.: 1112 Flatbush Ave Brooklyn NY 11226",
          ar: "مثال: 1112 Flatbush Ave Brooklyn NY 11226",
          zh: "例如：1112 Flatbush Ave Brooklyn NY 11226",
          ff: "Yeru: 1112 Flatbush Ave Brooklyn NY 11226",
        },
        lang,
      ),
      pickupLockedHint: L(
        {
          en: "Restaurant address filled in automatically.",
          fr: "Adresse du restaurant remplie automatiquement.",
          es: "Dirección del restaurante rellenada automáticamente.",
          ar: "يُملأ عنوان المطعم تلقائيًا.",
          zh: "餐厅地址已自动填写。",
          ff: "Ñiiɓirde restoraa hebbinaama e hoore mum.",
        },
        lang,
      ),
      estimating: L(
        {
          en: "Calculating delivery automatically…",
          fr: "Calcul automatique de la livraison…",
          es: "Calculando la entrega automáticamente…",
          ar: "جارٍ حساب التوصيل تلقائيًا…",
          zh: "正在自动计算配送…",
          ff: "Nana hiisa neldol e hoore mum…",
        },
        lang,
      ),
      estimateReady: L(
        {
          en: "Delivery estimate ready.",
          fr: "Estimation de livraison prête.",
          es: "Estimación de entrega lista.",
          ar: "تقدير التوصيل جاهز.",
          zh: "配送估价已就绪。",
          ff: "Ƴeewndo neldol hebiima.",
        },
        lang,
      ),
      autoEstimateHint: L(
        {
          en: "The estimate starts automatically when the address is complete.",
          fr: "L’estimation se lance automatiquement quand l’adresse est complète.",
          es: "La estimación empieza automáticamente cuando la dirección está completa.",
          ar: "يبدأ التقدير تلقائيًا عندما يكتمل العنوان.",
          zh: "地址完整后会自动开始估价。",
          ff: "Ƴeewndo fuɗɗoto e hoore mum so ñiiɓirde timmii.",
        },
        lang,
      ),
    },
    leaveAtDoor: {
      title: L(
        {
          en: "Leave at the door",
          fr: "Laisser devant la porte",
          es: "Dejar en la puerta",
          ar: "الترك عند الباب",
          zh: "放在门口",
          ff: "Accu e damal",
        },
        lang,
      ),
      hint: L(
        {
          en: "Allows the driver to leave the order at the door after the maximum wait (photo required).",
          fr: "Autorise le livreur à déposer la commande devant la porte après l’attente maximale (photo obligatoire).",
          es: "Permite al repartidor dejar el pedido en la puerta tras la espera máxima (foto obligatoria).",
          ar: "يسمح للسائق بترك الطلب عند الباب بعد أقصى انتظار (الصورة مطلوبة).",
          zh: "允许骑手在最长等待后将订单放在门口（必须拍照）。",
          ff: "Yamira dogginoowo accude njamndi e damal caggal njaaweere ɓurnde (nataal ina waɗɗii).",
        },
        lang,
      ),
    },
    summary: {
      distance: L(
        {
          en: "Distance",
          fr: "Distance",
          es: "Distancia",
          ar: "المسافة",
          zh: "距离",
          ff: "Woɗɗude",
        },
        lang,
      ),
      eta: L(
        {
          en: "Estimated time",
          fr: "Temps estimé",
          es: "Tiempo estimado",
          ar: "الوقت التقديري",
          zh: "预计时间",
          ff: "Waktu ƴeewndo",
        },
        lang,
      ),
      fee: L(
        {
          en: "Delivery fee",
          fr: "Frais de livraison",
          es: "Tarifa de entrega",
          ar: "رسوم التوصيل",
          zh: "配送费",
          ff: "Njoɓdi neldol",
        },
        lang,
      ),
      pickupGps: L(
        {
          en: "Pickup GPS",
          fr: "GPS de retrait",
          es: "GPS de recogida",
          ar: "GPS الاستلام",
          zh: "取餐 GPS",
          ff: "GPS ƴettugol",
        },
        lang,
      ),
      dropoffGps: L(
        {
          en: "Dropoff GPS",
          fr: "GPS de livraison",
          es: "GPS de entrega",
          ar: "GPS التسليم",
          zh: "送餐 GPS",
          ff: "GPS neldol",
        },
        lang,
      ),
    },
    cart: {
      title: L(
        {
          en: "Cart",
          fr: "Panier",
          es: "Carrito",
          ar: "السلة",
          zh: "购物车",
          ff: "Panier",
        },
        lang,
      ),
      empty: L(
        {
          en: "Your cart is empty. Add dishes from the menu.",
          fr: "Ton panier est vide. Ajoute des plats depuis le menu.",
          es: "Tu carrito está vacío. Añade platos desde el menú.",
          ar: "سلتك فارغة. أضف أطباقًا من القائمة.",
          zh: "购物车为空。请从菜单添加菜品。",
          ff: "Panier maa ɓolii. Ɓeydu ñaamdu ummoraade e menu.",
        },
        lang,
      ),
      perUnit: L(
        {
          en: "/ each",
          fr: "/ unité",
          es: "/ unidad",
          ar: "/ للقطعة",
          zh: "/ 份",
          ff: "/ gooto",
        },
        lang,
      ),
    },
    options: {
      title: L(
        {
          en: "Options",
          fr: "Options",
          es: "Opciones",
          ar: "خيارات",
          zh: "选项",
          ff: "Cuɓe",
        },
        lang,
      ),
      add: L(
        {
          en: "Add with options",
          fr: "Ajouter avec options",
          es: "Añadir con opciones",
          ar: "إضافة مع الخيارات",
          zh: "添加并选择选项",
          ff: "Ɓeydu e cuɓe",
        },
        lang,
      ),
    },
    totals: {
      subtotal: L(
        {
          en: "Subtotal",
          fr: "Sous-total",
          es: "Subtotal",
          ar: "المجموع الفرعي",
          zh: "小计",
          ff: "Les-total",
        },
        lang,
      ),
      taxLabel: L(
        {
          en: "Tax",
          fr: "Taxes",
          es: "Impuestos",
          ar: "الضريبة",
          zh: "税费",
          ff: "Njoɓdi laamu",
        },
        lang,
      ),
      totalNoDelivery: L(
        {
          en: "Total (before delivery)",
          fr: "Total (hors livraison)",
          es: "Total (sin entrega)",
          ar: "الإجمالي (بدون التوصيل)",
          zh: "合计（不含配送）",
          ff: "Kalaa (alaa neldol)",
        },
        lang,
      ),
      serviceFee: L(
        {
          en: "Service fee",
          fr: "Frais de service",
          es: "Tarifa de servicio",
          ar: "رسوم الخدمة",
          zh: "服务费",
          ff: "Njoɓdi sarwiis",
        },
        lang,
      ),
      finalTotal: L(
        {
          en: "Final total",
          fr: "Total final",
          es: "Total final",
          ar: "الإجمالي النهائي",
          zh: "最终合计",
          ff: "Kalaa timmuɗo",
        },
        lang,
      ),
    },
    create: {
      paying: L(
        {
          en: "Payment in progress…",
          fr: "Paiement en cours…",
          es: "Pago en curso…",
          ar: "الدفع قيد التنفيذ…",
          zh: "正在付款…",
          ff: "Njoɓdi ena yaha…",
        },
        lang,
      ),
      confirm: L(
        {
          en: "Pay and confirm the MMD order",
          fr: "Payer et confirmer la commande MMD",
          es: "Pagar y confirmar el pedido MMD",
          ar: "ادفع وأكّد طلب MMD",
          zh: "支付并确认 MMD 订单",
          ff: "Yoɓ tee jaɓ njamndi MMD",
        },
        lang,
      ),
    },
    payment: {
      title: L(
        {
          en: "Payment",
          fr: "Paiement",
          es: "Pago",
          ar: "الدفع",
          zh: "付款",
          ff: "Njoɓdi",
        },
        lang,
      ),
      notCompleted: L(
        {
          en: "Payment was not completed. No order was created.",
          fr: "Le paiement n’a pas été terminé. Aucune commande n’a été créée.",
          es: "El pago no se completó. No se creó ningún pedido.",
          ar: "لم يكتمل الدفع. لم يُنشأ أي طلب.",
          zh: "付款未完成。未创建订单。",
          ff: "Njoɓdi timmaani. Alaa njamndi sosaa.",
        },
        lang,
      ),
    },
  };
}

export function clientNewOrder(lang) {
  return {
    title: L(
      {
        en: "New order",
        fr: "Nouvelle commande",
        es: "Nuevo pedido",
        ar: "طلب جديد",
        zh: "新订单",
        ff: "Njamndi hesere",
      },
      lang,
    ),
    alerts: {
      missingFieldsTitle: L(
        {
          en: "Missing fields",
          fr: "Champs manquants",
          es: "Campos incompletos",
          ar: "حقول ناقصة",
          zh: "缺少字段",
          ff: "Galleeji ŋattaaɗi",
        },
        lang,
      ),
      missingConfigTitle: L(
        {
          en: "Missing configuration",
          fr: "Configuration manquante",
          es: "Configuración incompleta",
          ar: "إعداد ناقص",
          zh: "缺少配置",
          ff: "Teelte ŋattaaɗe",
        },
        lang,
      ),
      blockedTitle: L(
        {
          en: "Order blocked",
          fr: "Commande bloquée",
          es: "Pedido bloqueado",
          ar: "الطلب محظور",
          zh: "订单已阻止",
          ff: "Njamndi ko haɗaaɗo",
        },
        lang,
      ),
      verifyAddressTitle: L(
        {
          en: "Address to verify",
          fr: "Adresse à vérifier",
          es: "Dirección por verificar",
          ar: "عنوان يحتاج تحققًا",
          zh: "请核对地址",
          ff: "Ñiiɓirde ina sokli ƴeewndo",
        },
        lang,
      ),
      missingCoordsTitle: L(
        {
          en: "Missing coordinates",
          fr: "Coordonnées manquantes",
          es: "Coordenadas incompletas",
          ar: "الإحداثيات ناقصة",
          zh: "缺少坐标",
          ff: "Coords ŋattaaɗi",
        },
        lang,
      ),
      loginRequiredTitle: L(
        {
          en: "Sign in required",
          fr: "Connexion requise",
          es: "Inicio de sesión requerido",
          ar: "يلزم تسجيل الدخول",
          zh: "需要登录",
          ff: "Naatgol wajibi",
        },
        lang,
      ),
      createdTitle: L(
        {
          en: "Order created",
          fr: "Commande créée",
          es: "Pedido creado",
          ar: "تم إنشاء الطلب",
          zh: "订单已创建",
          ff: "Njamndi sosaama",
        },
        lang,
      ),
      missingOrderTitle: L(
        {
          en: "Missing order",
          fr: "Commande manquante",
          es: "Pedido incompleto",
          ar: "الطلب ناقص",
          zh: "缺少订单",
          ff: "Njamndi ŋattaaɗo",
        },
        lang,
      ),
      paymentSuccessTitle: L(
        {
          en: "Payment successful",
          fr: "Paiement réussi",
          es: "Pago correcto",
          ar: "تم الدفع بنجاح",
          zh: "付款成功",
          ff: "Njoɓdi moƴƴii",
        },
        lang,
      ),
      incompleteAddressBody: L(
        {
          en: "Enter more complete addresses before calculating delivery.",
          fr: "Saisis des adresses plus complètes avant le calcul.",
          es: "Introduce direcciones más completas antes de calcular.",
          ar: "أدخل عناوين أكثر اكتمالًا قبل الحساب.",
          zh: "请输入更完整的地址后再计算。",
          ff: "Naatnu ñiiɓirɗe ɓurɗe timmude hade hiisde.",
        },
        lang,
      ),
      missingConfigBody: L(
        {
          en: "The API base URL is not configured.",
          fr: "L’URL de l’API n’est pas configurée.",
          es: "La URL base de la API no está configurada.",
          ar: "لم يُضبط عنوان واجهة البرمجة.",
          zh: "未配置 API 基础地址。",
          ff: "URL API teeltaaka.",
        },
        lang,
      ),
      loginRequiredBody: L(
        {
          en: "Please sign in before creating an order.",
          fr: "Connecte-toi avant de créer une commande.",
          es: "Inicia sesión antes de crear un pedido.",
          ar: "سجّل الدخول قبل إنشاء طلب.",
          zh: "请先登录再创建订单。",
          ff: "Naat hade sosde njamndi.",
        },
        lang,
      ),
      createdBody: L(
        {
          en: "Your order was created. You can now tap Pay now.",
          fr: "Ta commande a bien été créée. Tu peux maintenant appuyer sur Payer maintenant.",
          es: "Tu pedido se creó. Ahora puedes pulsar Pagar ahora.",
          ar: "تم إنشاء طلبك. يمكنك الآن الضغط على ادفع الآن.",
          zh: "订单已创建。现在可以点按立即支付。",
          ff: "Njamndi maa sosaama. A waawi jooni pennude Yoɓ jooni.",
        },
        lang,
      ),
      createFirst: L(
        {
          en: "Create the order first, then you can pay.",
          fr: "Crée d’abord la commande, ensuite tu pourras payer.",
          es: "Crea el pedido primero, luego podrás pagar.",
          ar: "أنشئ الطلب أولًا ثم يمكنك الدفع.",
          zh: "请先创建订单，然后才能付款。",
          ff: "Sos njamndi so tawii, ndeen a waawi yoɓde.",
        },
        lang,
      ),
      paymentPendingBody: L(
        {
          en: "Thank you. Stripe confirmed payment. The order will be marked paid shortly.",
          fr: "Merci. Stripe a confirmé le paiement. La commande sera marquée payée sous peu.",
          es: "Gracias. Stripe confirmó el pago. El pedido se marcará como pagado en breve.",
          ar: "شكرًا. أكّد Stripe الدفع. سيُعلَّم الطلب مدفوعًا قريبًا.",
          zh: "谢谢。Stripe 已确认付款。订单稍后会标记为已支付。",
          ff: "A jaaraama. Stripe jaɓii njoɓdi. Njamndi maa wonata yoɓaango so yahii.",
        },
        lang,
      ),
      paymentConfirmedBody: L(
        {
          en: "Thank you. Your payment is confirmed. The restaurant can now accept the order.",
          fr: "Merci. Ton paiement est confirmé. Le restaurant pourra accepter la commande.",
          es: "Gracias. Tu pago está confirmado. El restaurante ya puede aceptar el pedido.",
          ar: "شكرًا. تم تأكيد الدفع. يمكن للمطعم قبول الطلب الآن.",
          zh: "谢谢。付款已确认。餐厅现在可以接受订单。",
          ff: "A jaaraama. Njoɓdi maa jaɓaama. Restoraa waawi jaɓde njamndi jooni.",
        },
        lang,
      ),
      invalidGps: L(
        {
          en: "Invalid GPS coordinates. Recalculate the estimate.",
          fr: "Coordonnées GPS invalides. Relance l’estimation.",
          es: "Coordenadas GPS no válidas. Vuelve a calcular la estimación.",
          ar: "إحداثيات GPS غير صالحة. أعد حساب التقدير.",
          zh: "GPS 坐标无效。请重新估价。",
          ff: "Coords GPS moƴƴaani. Hiit ƴeewndo.",
        },
        lang,
      ),
      missingCoordsBody: L(
        {
          en: "Recalculate the estimate to get GPS coordinates before creating the order.",
          fr: "Relance l’estimation pour récupérer les coordonnées GPS avant de créer la commande.",
          es: "Vuelve a calcular la estimación para obtener las coordenadas GPS antes de crear el pedido.",
          ar: "أعد حساب التقدير للحصول على إحداثيات GPS قبل إنشاء الطلب.",
          zh: "请重新估算以获取 GPS 坐标，然后再创建订单。",
          ff: "Hiit ƴeewndo ngam heɓde coords GPS hade sosde njamndi.",
        },
        lang,
      ),
      paymentTitle: L(
        {
          en: "Payment",
          fr: "Paiement",
          es: "Pago",
          ar: "الدفع",
          zh: "付款",
          ff: "Njoɓdi",
        },
        lang,
      ),
    },
    errors: {
      tooFarOrImprecise: L(
        {
          en: "Distance is too far or the address is not precise enough. Check the street, ZIP, city, and state.",
          fr: "Distance trop grande ou adresse trop imprécise. Vérifie la rue, le code postal, la ville et l’État.",
          es: "La distancia es demasiado grande o la dirección no es lo bastante precisa. Comprueba calle, ZIP, ciudad y estado.",
          ar: "المسافة كبيرة جدًا أو العنوان غير دقيق. تحقق من الشارع والرمز البريدي والمدينة والولاية.",
          zh: "距离过远或地址不够精确。请核对街道、邮编、城市和州。",
          ff: "Woɗɗude ɓurnde walla ñiiɓirde laaɓaani. Ƴeewto laawol, ZIP, wuro e diiwaan.",
        },
        lang,
      ),
      noRouteFound: L(
        {
          en: "No route was found between these addresses. Check the destination address.",
          fr: "Aucune route trouvée entre ces adresses. Vérifie l’adresse de destination.",
          es: "No se encontró ruta entre estas direcciones. Comprueba la dirección de destino.",
          ar: "لم يُعثر على مسار بين هذه العناوين. تحقق من عنوان الوجهة.",
          zh: "未找到这些地址之间的路线。请核对目的地地址。",
          ff: "Alaa laawol tawaangol hakkunde ɗee ñiiɓirɗe. Ƴeewto ñiiɓirde gaaɗo.",
        },
        lang,
      ),
      networkFailed: L(
        {
          en: "Unable to reach the server right now. Check your network and try again.",
          fr: "Impossible de joindre le serveur pour le moment. Vérifie le réseau puis réessaie.",
          es: "No se puede contactar el servidor ahora. Comprueba la red e inténtalo de nuevo.",
          ar: "تعذر الوصول إلى الخادم الآن. تحقق من الشبكة ثم أعد المحاولة.",
          zh: "目前无法连接服务器。请检查网络后重试。",
          ff: "Horiima heɓde sarworde oo sahaa. Ƴeewto laylayol ndeen fuɗɗit.",
        },
        lang,
      ),
      timeout: L(
        {
          en: "The estimate request took too long. Try again in a moment.",
          fr: "La requête d’estimation a pris trop de temps. Réessaie dans un instant.",
          es: "La estimación tardó demasiado. Inténtalo de nuevo en un momento.",
          ar: "استغرق طلب التقدير وقتًا طويلًا. أعد المحاولة بعد لحظة.",
          zh: "估价请求超时。请稍后再试。",
          ff: "Ñaagol ƴeewndo ɓuri juutude. Fuɗɗit so yahii.",
        },
        lang,
      ),
      noRestaurantSelected: L(
        {
          en: "No restaurant selected. Go back to the list and choose a restaurant.",
          fr: "Aucun restaurant sélectionné. Retourne à la liste et choisis un restaurant.",
          es: "Ningún restaurante seleccionado. Vuelve a la lista y elige uno.",
          ar: "لم يُحدد مطعم. ارجع إلى القائمة واختر مطعمًا.",
          zh: "未选择餐厅。请返回列表并选择一家餐厅。",
          ff: "Alaa restoraa suɓaama. Rutto e doggol ngol suɓo restoraa.",
        },
        lang,
      ),
      restaurantUnavailable: L(
        {
          en: "This restaurant is not available for orders right now.",
          fr: "Ce restaurant n’est pas disponible pour les commandes actuellement.",
          es: "Este restaurante no está disponible para pedidos ahora.",
          ar: "هذا المطعم غير متاح للطلبات الآن.",
          zh: "这家餐厅目前无法接单。",
          ff: "Oo restoraa hebɓaaki njamndi oo sahaa.",
        },
        lang,
      ),
      restaurantMissingOwner: L(
        {
          en: "This restaurant does not have a valid owner yet.",
          fr: "Ce restaurant n’a pas encore un propriétaire valide.",
          es: "Este restaurante aún no tiene un propietario válido.",
          ar: "هذا المطعم ليس له مالك صالح بعد.",
          zh: "这家餐厅尚无有效所有者。",
          ff: "Oo restoraa alaa jom moƴƴo tawo.",
        },
        lang,
      ),
      restaurantMissingLocation: L(
        {
          en: "This restaurant does not have a valid GPS address yet. It must complete its profile before receiving orders.",
          fr: "Ce restaurant n’a pas encore une adresse GPS valide. Il doit compléter son profil avant de recevoir des commandes.",
          es: "Este restaurante aún no tiene una dirección GPS válida. Debe completar su perfil antes de recibir pedidos.",
          ar: "هذا المطعم ليس له عنوان GPS صالح بعد. يجب إكمال الملف قبل استلام الطلبات.",
          zh: "这家餐厅尚无有效 GPS 地址。必须先完善资料才能接单。",
          ff: "Oo restoraa alaa ñiiɓirde GPS moƴƴunde tawo. Foti timminde profil mum hade keɓde njamndi.",
        },
        lang,
      ),
      invalidJsonResponse: L(
        {
          en: "Invalid response from the distance service.",
          fr: "Réponse invalide du service de distance.",
          es: "Respuesta no válida del servicio de distancia.",
          ar: "استجابة غير صالحة من خدمة المسافة.",
          zh: "距离服务返回无效响应。",
          ff: "Jaabawol moƴƴaani ummoraade e sarwiis woɗɗude.",
        },
        lang,
      ),
      invalidMapboxDistanceEta: L(
        {
          en: "Invalid distance or time response from Mapbox.",
          fr: "Réponse distance/temps invalide depuis l’API Mapbox.",
          es: "Respuesta de distancia/tiempo no válida de Mapbox.",
          ar: "استجابة مسافة/وقت غير صالحة من Mapbox.",
          zh: "Mapbox 返回的距离或时间无效。",
          ff: "Jaabawol woɗɗude/waktu moƴƴaani ummoraade e Mapbox.",
        },
        lang,
      ),
      createFailed: L(
        {
          en: "Unable to create the order right now.",
          fr: "Impossible de créer la commande pour le moment.",
          es: "No se puede crear el pedido ahora.",
          ar: "تعذر إنشاء الطلب الآن.",
          zh: "目前无法创建订单。",
          ff: "Horiima sosde njamndi oo sahaa.",
        },
        lang,
      ),
      sessionExpired: L(
        {
          en: "Session expired. Sign in again and try once more.",
          fr: "Session expirée. Reconnecte-toi puis réessaie.",
          es: "La sesión expiró. Inicia sesión de nuevo e inténtalo otra vez.",
          ar: "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة.",
          zh: "会话已过期。请重新登录后再试。",
          ff: "Session timmii. Naat kadi ndeen fuɗɗit.",
        },
        lang,
      ),
      paymentFailed: L(
        {
          en: "Payment is unavailable right now.",
          fr: "Paiement impossible pour le moment.",
          es: "El pago no está disponible ahora.",
          ar: "الدفع غير متاح الآن.",
          zh: "目前无法付款。",
          ff: "Njoɓdi hebɓaaki oo sahaa.",
        },
        lang,
      ),
    },
    cards: {
      autoEstimate: L(
        {
          en: "Auto estimate",
          fr: "Estimation auto",
          es: "Estimación automática",
          ar: "تقدير تلقائي",
          zh: "自动估价",
          ff: "Ƴeewndo otomatik",
        },
        lang,
      ),
    },
    status: {
      calculating: L(
        {
          en: "Calculating…",
          fr: "Calcul…",
          es: "Calculando…",
          ar: "جارٍ الحساب…",
          zh: "正在计算…",
          ff: "Nana hiisa…",
        },
        lang,
      ),
      autoCalculating: L(
        {
          en: "Automatic calculation in progress…",
          fr: "Calcul automatique en cours…",
          es: "Cálculo automático en curso…",
          ar: "الحساب التلقائي قيد التنفيذ…",
          zh: "正在自动计算…",
          ff: "Hiisgol otomatik ena yaha…",
        },
        lang,
      ),
      estimateReady: L(
        {
          en: "Estimate ready.",
          fr: "Estimation prête.",
          es: "Estimación lista.",
          ar: "التقدير جاهز.",
          zh: "估价已就绪。",
          ff: "Ƴeewndo hebiima.",
        },
        lang,
      ),
      waitingCompleteAddress: L(
        {
          en: "Waiting for a complete address.",
          fr: "En attente d’une adresse complète.",
          es: "Esperando una dirección completa.",
          ar: "بانتظار عنوان كامل.",
          zh: "等待完整地址。",
          ff: "Ena fadoto ñiiɓirde timmunde.",
        },
        lang,
      ),
    },
    labels: {
      eta: L(
        {
          en: "Estimated time",
          fr: "Temps estimé",
          es: "Tiempo estimado",
          ar: "الوقت التقديري",
          zh: "预计时间",
          ff: "Waktu ƴeewndo",
        },
        lang,
      ),
      distance: L(
        {
          en: "Distance",
          fr: "Distance",
          es: "Distancia",
          ar: "المسافة",
          zh: "距离",
          ff: "Woɗɗude",
        },
        lang,
      ),
      itemsSubtotal: L(
        {
          en: "Items subtotal",
          fr: "Sous-total articles",
          es: "Subtotal de artículos",
          ar: "مجموع الأصناف الفرعي",
          zh: "商品小计",
          ff: "Les-total geɗe",
        },
        lang,
      ),
      taxes: L(
        {
          en: "Tax",
          fr: "Taxes",
          es: "Impuestos",
          ar: "الضريبة",
          zh: "税费",
          ff: "Njoɓdi laamu",
        },
        lang,
      ),
      fee: L(
        {
          en: "Delivery fee",
          fr: "Frais de livraison",
          es: "Tarifa de entrega",
          ar: "رسوم التوصيل",
          zh: "配送费",
          ff: "Njoɓdi neldol",
        },
        lang,
      ),
      finalTotal: L(
        {
          en: "Final total",
          fr: "Total final",
          es: "Total final",
          ar: "الإجمالي النهائي",
          zh: "最终合计",
          ff: "Kalaa timmuɗo",
        },
        lang,
      ),
      pickupGps: L(
        {
          en: "Pickup GPS",
          fr: "GPS de retrait",
          es: "GPS de recogida",
          ar: "GPS الاستلام",
          zh: "取餐 GPS",
          ff: "GPS ƴettugol",
        },
        lang,
      ),
      dropoffGps: L(
        {
          en: "Dropoff GPS",
          fr: "GPS de livraison",
          es: "GPS de entrega",
          ar: "GPS التسليم",
          zh: "送餐 GPS",
          ff: "GPS neldol",
        },
        lang,
      ),
    },
    section: {
      addresses: L(
        {
          en: "Delivery addresses",
          fr: "Adresses de la livraison",
          es: "Direcciones de entrega",
          ar: "عناوين التوصيل",
          zh: "配送地址",
          ff: "Ñiiɓirɗe neldol",
        },
        lang,
      ),
    },
    subtitle: L(
      {
        en: "Enter pickup and dropoff addresses. Delivery uses the same pricing as the website.",
        fr: "Saisis les adresses de retrait et de livraison. La livraison utilise la même formule que sur le site.",
        es: "Introduce las direcciones de recogida y entrega. La entrega usa la misma fórmula que el sitio web.",
        ar: "أدخل عناوين الاستلام والتسليم. يستخدم التوصيل نفس التسعير كما في الموقع.",
        zh: "输入取餐和送餐地址。配送计价与网站相同。",
        ff: "Naatnu ñiiɓirɗe ƴettugol e neldol. Neldol huutoroto njoɓdi wootere e lowre.",
      },
      lang,
    ),
    fields: {
      pickupLockedHint: L(
        {
          en: "Restaurant address filled in automatically.",
          fr: "Adresse du restaurant remplie automatiquement.",
          es: "Dirección del restaurante rellenada automáticamente.",
          ar: "يُملأ عنوان المطعم تلقائيًا.",
          zh: "餐厅地址已自动填写。",
          ff: "Ñiiɓirde restoraa hebbinaama e hoore mum.",
        },
        lang,
      ),
      dropoffPlaceholder: L(
        {
          en: "Ex: customer address",
          fr: "Ex. : adresse du client",
          es: "Ej.: dirección del cliente",
          ar: "مثال: عنوان العميل",
          zh: "例如：客户地址",
          ff: "Yeru: ñiiɓirde kiliyee",
        },
        lang,
      ),
      pickupLabel: L(
        {
          en: "Pickup address",
          fr: "Adresse de retrait",
          es: "Dirección de recogida",
          ar: "عنوان الاستلام",
          zh: "取餐地址",
          ff: "Ñiiɓirde ƴettugol",
        },
        lang,
      ),
      dropoffLabel: L(
        {
          en: "Delivery address",
          fr: "Adresse de livraison",
          es: "Dirección de entrega",
          ar: "عنوان التسليم",
          zh: "送餐地址",
          ff: "Ñiiɓirde neldol",
        },
        lang,
      ),
    },
    hints: {
      autoEstimate: L(
        {
          en: "The estimate starts automatically after a short pause when the address looks complete.",
          fr: "L’estimation démarre automatiquement après une courte pause quand l’adresse paraît complète.",
          es: "La estimación empieza automáticamente tras una breve pausa cuando la dirección parece completa.",
          ar: "يبدأ التقدير تلقائيًا بعد توقف قصير عندما يبدو العنوان مكتملًا.",
          zh: "当地址看起来完整时，稍等片刻会自动开始估价。",
          ff: "Ƴeewndo fuɗɗoto e hoore mum caggal njaaweere seeɗa so ñiiɓirde yi’ete timmunde.",
        },
        lang,
      ),
      checkoutSteps: L(
        {
          en: "1) Estimate → 2) Create the order → 3) Pay with Stripe.",
          fr: "1) Estime → 2) Crée la commande → 3) Paye avec Stripe.",
          es: "1) Estima → 2) Crea el pedido → 3) Paga con Stripe.",
          ar: "1) قدّر → 2) أنشئ الطلب → 3) ادفع عبر Stripe.",
          zh: "1）估价 → 2）创建订单 → 3）用 Stripe 付款。",
          ff: "1) Ƴeewndo → 2) Sos njamndi → 3) Yoɓ e Stripe.",
        },
        lang,
      ),
    },
    checkout: {
      title: L(
        {
          en: "Checkout",
          fr: "Paiement",
          es: "Pago",
          ar: "إتمام الطلب",
          zh: "结账",
          ff: "Checkout",
        },
        lang,
      ),
      stepEstimate: L(
        {
          en: "Automatic estimate",
          fr: "Estimation automatique",
          es: "Estimación automática",
          ar: "تقدير تلقائي",
          zh: "自动估价",
          ff: "Ƴeewndo otomatik",
        },
        lang,
      ),
      stepCreate: L(
        {
          en: "Create the order",
          fr: "Créer la commande",
          es: "Crear el pedido",
          ar: "إنشاء الطلب",
          zh: "创建订单",
          ff: "Sos njamndi",
        },
        lang,
      ),
      stepPay: L(
        {
          en: "Pay with Stripe",
          fr: "Payer avec Stripe",
          es: "Pagar con Stripe",
          ar: "ادفع عبر Stripe",
          zh: "使用 Stripe 付款",
          ff: "Yoɓ e Stripe",
        },
        lang,
      ),
    },
    actions: {
      creating: L(
        {
          en: "Creating order…",
          fr: "Création de la commande…",
          es: "Creando pedido…",
          ar: "جارٍ إنشاء الطلب…",
          zh: "正在创建订单…",
          ff: "Nana sosa njamndi…",
        },
        lang,
      ),
      create: L(
        {
          en: "Confirm and create the MMD order",
          fr: "Confirmer et créer la commande MMD",
          es: "Confirmar y crear el pedido MMD",
          ar: "أكّد وأنشئ طلب MMD",
          zh: "确认并创建 MMD 订单",
          ff: "Jaɓ tee sos njamndi MMD",
        },
        lang,
      ),
      paying: L(
        {
          en: "Payment in progress…",
          fr: "Paiement en cours…",
          es: "Pago en curso…",
          ar: "الدفع قيد التنفيذ…",
          zh: "正在付款…",
          ff: "Njoɓdi ena yaha…",
        },
        lang,
      ),
      payNow: L(
        {
          en: "Pay now",
          fr: "Payer maintenant",
          es: "Pagar ahora",
          ar: "ادفع الآن",
          zh: "立即支付",
          ff: "Yoɓ jooni",
        },
        lang,
      ),
    },
  };
}

export function sharedOrderChatGaps(lang) {
  return {
    alerts: {
      permissionGalleryBody: L(
        {
          en: "Allow gallery access to send an image.",
          fr: "Autorise l’accès à la galerie pour envoyer une image.",
          es: "Permite el acceso a la galería para enviar una imagen.",
          ar: "اسمح بالوصول إلى المعرض لإرسال صورة.",
          zh: "请允许访问相册以发送图片。",
          ff: "Yamir naatgol e galleri ngam neldude natal.",
        },
        lang,
      ),
    },
    errors: {
      accessDeniedTitle: L(
        {
          en: "Access denied",
          fr: "Accès refusé",
          es: "Acceso denegado",
          ar: "تم رفض الوصول",
          zh: "拒绝访问",
          ff: "Naatgol ko haɗaaɗo",
        },
        lang,
      ),
      accessDeniedUi: L(
        {
          en: "You cannot open this conversation.",
          fr: "Tu ne peux pas ouvrir cette discussion.",
          es: "No puedes abrir esta conversación.",
          ar: "لا يمكنك فتح هذه المحادثة.",
          zh: "你无法打开此对话。",
          ff: "A waawaa udditde ndee yeewtere.",
        },
        lang,
      ),
      invalidOrderId: L(
        {
          en: "Invalid order.",
          fr: "Commande invalide.",
          es: "Pedido no válido.",
          ar: "طلب غير صالح.",
          zh: "订单无效。",
          ff: "Njamndi moƴƴaani.",
        },
        lang,
      ),
      invalidOrderIdTitle: L(
        {
          en: "Chat unavailable",
          fr: "Discussion indisponible",
          es: "Chat no disponible",
          ar: "المحادثة غير متاحة",
          zh: "聊天不可用",
          ff: "Yeewtere hebɓaaki",
        },
        lang,
      ),
      invalidOrderIdUi: L(
        {
          en: "This conversation is unavailable.",
          fr: "Cette discussion n’est pas disponible.",
          es: "Esta conversación no está disponible.",
          ar: "هذه المحادثة غير متاحة.",
          zh: "此对话不可用。",
          ff: "Ndee yeewtere hebɓaaki.",
        },
        lang,
      ),
      notAllowed: L(
        {
          en: "You are not allowed to do this.",
          fr: "Tu n’es pas autorisé à faire cela.",
          es: "No tienes permiso para esto.",
          ar: "غير مسموح لك بذلك.",
          zh: "你无权执行此操作。",
          ff: "A yamiraaka waɗde ɗum.",
        },
        lang,
      ),
      unsupportedImage: L(
        {
          en: "Unsupported image format.",
          fr: "Format d’image non pris en charge.",
          es: "Formato de imagen no compatible.",
          ar: "تنسيق الصورة غير مدعوم.",
          zh: "不支持的图片格式。",
          ff: "Fannu nataal jaɓaaka.",
        },
        lang,
      ),
      imageTooLarge: L(
        {
          en: "This image is too large.",
          fr: "Cette image est trop grande.",
          es: "Esta imagen es demasiado grande.",
          ar: "هذه الصورة كبيرة جدًا.",
          zh: "这张图片太大。",
          ff: "Ndee natal ɓuri mawnude.",
        },
        lang,
      ),
      messageTooLong: L(
        {
          en: "This message is too long.",
          fr: "Ce message est trop long.",
          es: "Este mensaje es demasiado largo.",
          ar: "هذه الرسالة طويلة جدًا.",
          zh: "这条消息太长。",
          ff: "Ndee mesasu ɓuri juutude.",
        },
        lang,
      ),
      notAuthenticated: L(
        {
          en: "You must be signed in.",
          fr: "Tu dois être connecté.",
          es: "Debes iniciar sesión.",
          ar: "يجب تسجيل الدخول.",
          zh: "你必须先登录。",
          ff: "A foti naatde.",
        },
        lang,
      ),
      deleteOwnOnly: L(
        {
          en: "You can only delete your own messages.",
          fr: "Tu ne peux supprimer que tes propres messages.",
          es: "Solo puedes eliminar tus propios mensajes.",
          ar: "يمكنك حذف رسائلك فقط.",
          zh: "你只能删除自己的消息。",
          ff: "A waawi momtude mesasuuji maa tan.",
        },
        lang,
      ),
    },
    sender: {
      you: L(
        {
          en: "You",
          fr: "Toi",
          es: "Tú",
          ar: "أنت",
          zh: "你",
          ff: "Aan",
        },
        lang,
      ),
      unknown: L(
        {
          en: "Participant",
          fr: "Participant",
          es: "Participante",
          ar: "مشارك",
          zh: "参与者",
          ff: "Tawtoraaɗo",
        },
        lang,
      ),
    },
    header: {
      title: L(
        {
          en: "Chat",
          fr: "Discussion",
          es: "Chat",
          ar: "محادثة",
          zh: "聊天",
          ff: "Yeewtere",
        },
        lang,
      ),
      privateWith: L(
        {
          en: "Conversation with",
          fr: "Conversation avec",
          es: "Conversación con",
          ar: "محادثة مع",
          zh: "对话对象",
          ff: "Yeewtere e",
        },
        lang,
      ),
    },
    receipt: {
      read: L(
        {
          en: "Read",
          fr: "Lu",
          es: "Leído",
          ar: "مقروء",
          zh: "已读",
          ff: "Tarɗaa",
        },
        lang,
      ),
      sent: L(
        {
          en: "Sent",
          fr: "Envoyé",
          es: "Enviado",
          ar: "أُرسل",
          zh: "已发送",
          ff: "Nelaa",
        },
        lang,
      ),
      delivered: L(
        {
          en: "Delivered",
          fr: "Distribué",
          es: "Entregado",
          ar: "تم التسليم",
          zh: "已送达",
          ff: "Neldaama",
        },
        lang,
      ),
    },
  };
}

export function authLoginRequired(lang) {
  return {
    loginRequiredTitle: L(
      {
        en: "Sign in required",
        fr: "Connexion requise",
        es: "Inicio de sesión requerido",
        ar: "يلزم تسجيل الدخول",
        zh: "需要登录",
        ff: "Naatgol wajibi",
      },
      lang,
    ),
    loginRequiredBody: L(
      {
        en: "Please sign in before creating an order.",
        fr: "Connecte-toi avant de créer une commande.",
        es: "Inicia sesión antes de crear un pedido.",
        ar: "سجّل الدخول قبل إنشاء طلب.",
        zh: "请先登录再创建订单。",
        ff: "Naat hade sosde njamndi.",
      },
      lang,
    ),
  };
}

export function commonOptional(lang) {
  return L(
    {
      en: "Optional",
      fr: "Optionnel",
      es: "Opcional",
      ar: "اختياري",
      zh: "可选",
      ff: "Wonaa waɗɗi",
    },
    lang,
  );
}

export function payAndConfirm(lang) {
  return L(
    {
      en: "Pay and confirm delivery",
      fr: "Payer et confirmer la livraison",
      es: "Pagar y confirmar la entrega",
      ar: "ادفع وأكّد التوصيل",
      zh: "支付并确认配送",
      ff: "Yoɓ tee jaɓ neldol",
    },
    lang,
  );
}
