/**
 * Build flat translation maps for fr, es, ar, zh, ff from en extras keys.
 * Run: node scripts/generate-i18n-flat-maps.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mapsDir = path.join(__dirname, "i18n-lang");
const en = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "src", "i18n", "locales", "en", "extras.json"),
    "utf8"
  )
);

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj || {})) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, next, out);
    } else if (typeof value === "string") {
      out[next] = value;
    }
  }
  return out;
}

const enFlat = flatten(en);

const FR = {
  "language.pickerTitle": "Langue",
  "language.pickerSubtitle": "Choisissez la langue de l'application",
  "language.searchPlaceholder": "Rechercher une langue…",
  "language.supportedNote":
    "6 langues : English, Français, Español, العربية, 中文, Pulaar / Fulfulde",
  "language.changed": "Langue mise à jour",
  "language.changeFailed": "Impossible de changer la langue.",
};

const ES = {
  "language.pickerTitle": "Idioma",
  "language.pickerSubtitle": "Elige el idioma de la aplicación",
  "language.searchPlaceholder": "Buscar idioma…",
  "language.supportedNote":
    "6 idiomas: English, Français, Español, العربية, 中文, Pulaar / Fulfulde",
  "language.changed": "Idioma actualizado",
  "language.changeFailed": "No se pudo cambiar el idioma.",
};

const AR = {
  "language.pickerTitle": "اللغة",
  "language.pickerSubtitle": "اختر لغة التطبيق",
  "language.searchPlaceholder": "ابحث عن لغة…",
  "language.supportedNote":
    "6 لغات: English, Français, Español, العربية, 中文, Pulaar / Fulfulde",
  "language.changed": "تم تحديث اللغة",
  "language.changeFailed": "تعذر تغيير اللغة.",
};

const ZH = {
  "language.pickerTitle": "语言",
  "language.pickerSubtitle": "选择应用语言",
  "language.searchPlaceholder": "搜索语言…",
  "language.supportedNote":
    "6 种语言：English、Français、Español、العربية、中文、Pulaar / Fulfulde",
  "language.changed": "语言已更新",
  "language.changeFailed": "无法更改语言。",
};

const FF = {
  "language.pickerTitle": "Demdol",
  "language.pickerSubtitle": "Suuɓo ɗemngal app",
  "language.searchPlaceholder": "Seet demdol…",
  "language.supportedNote":
    "6 demdde: English, Français, Español, العربية, 中文, Pulaar / Fulfulde",
  "language.changed": "Demdol hesɗitaama",
  "language.changeFailed": "Alaa addi change demdol.",
};

function buildMap(baseMap, prefix, table) {
  for (const [key, value] of Object.entries(enFlat)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    if (table[key.slice(prefix.length + 1)] || table[key.split(".").pop()]) {
      baseMap[key] = table[key.slice(prefix.length + 1)] ?? table[key.split(".").pop()];
    }
  }
}

function suffixMap(target, prefix, suffixFn) {
  for (const [key, value] of Object.entries(enFlat)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    target[key] = suffixFn(value, key);
  }
}

function makeFr() {
  const map = { ...FR };
  suffixMap(map, "marketplace", (v) =>
    v
      .replace(/^Marketplace$/, "Marketplace")
      .replace("Shop approved local sellers on MMD.", "Achetez auprès de vendeurs locaux approuvés sur MMD.")
      .replace("Sell on MMD →", "Vendre sur MMD →")
      .replace("No approved sellers yet.", "Aucun vendeur approuvé pour le moment.")
      .replace("Unable to load marketplace", "Impossible de charger le marketplace")
      .replace("Browse active products", "Parcourir les produits actifs")
      .replace("Open cart / draft", "Ouvrir le panier / brouillon")
      .replace("No active products.", "Aucun produit actif.")
      .replace("Unable to load products", "Impossible de charger les produits")
      .replace("Added to draft", "Ajouté au brouillon")
      .replace("Your marketplace draft was updated.", "Votre brouillon marketplace a été mis à jour.")
      .replace("Unable to update draft", "Impossible de mettre à jour le brouillon")
      .replace("Product not found.", "Produit introuvable.")
      .replace("Quantity", "Quantité")
      .replace("Line total", "Total ligne")
      .replace("Saving draft…", "Enregistrement du brouillon…")
      .replace("Add to draft cart", "Ajouter au panier brouillon")
      .replace("Marketplace draft", "Brouillon marketplace")
      .replace("Your draft cart is empty.", "Votre panier brouillon est vide.")
      .replace("Cart error", "Erreur panier")
      .replace("Unknown error", "Erreur inconnue")
      .replace("Dropoff required", "Destination requise")
      .replace(
        "Choose a delivery location to improve shadow delivery estimates.",
        "Choisissez une adresse de livraison pour améliorer les estimations shadow."
      )
      .replace("Location saved", "Adresse enregistrée")
      .replace(
        "Delivery shadow will use your selected dropoff when enabled on the server.",
        "La livraison shadow utilisera votre destination lorsque le serveur l'autorise."
      )
      .replace("Checkout prepared", "Checkout préparé")
      .replace("Coming soon", "Bientôt disponible")
      .replace(
        "Marketplace checkout coming soon. Shadow totals were calculated only.",
        "Checkout marketplace bientôt. Totaux shadow calculés uniquement."
      )
      .replace("Delivery dropoff", "Destination de livraison")
      .replace(
        "No dropoff selected — shadow may use fallback distance.",
        "Aucune destination — distance de secours possible."
      )
      .replace("Choose delivery location", "Choisir l'adresse de livraison")
      .replace("Use this location", "Utiliser cette adresse")
      .replace("Choose dropoff on map", "Choisir la destination sur la carte")
      .replace("Saving location…", "Enregistrement…")
      .replace("Apply dropoff to draft", "Appliquer la destination au brouillon")
      .replace("Subtotal", "Sous-total")
      .replace("Delivery (est.)", "Livraison (est.)")
      .replace("Service fee", "Frais de service")
      .replace("Total", "Total")
      .replace("Estimated delivery (shadow)", "Livraison estimée (shadow)")
      .replace("Delivery quote shadow", "Devis livraison shadow")
      .replace(
        "Shadow only — checkout and driver dispatch are not live yet.",
        "Shadow uniquement — checkout et dispatch non actifs."
      )
      .replace(
        "Checkout still coming soon — no live marketplace payment.",
        "Checkout bientôt — paiement marketplace non actif."
      )
      .replace("Processing…", "Traitement…")
      .replace("Prepare checkout", "Préparer le checkout")
      .replace("Marketplace checkout coming soon", "Checkout marketplace bientôt")
      .replace("Pay Marketplace Order", "Payer la commande marketplace")
      .replace("Missing checkout URL", "URL checkout manquante")
  );
  suffixMap(map, "seller", (v) =>
    v
      .replace("Unable to open seller area right now.", "Impossible d'ouvrir l'espace vendeur.")
      .replace("Seller services are not available in your area yet.", "Services vendeur indisponibles dans votre zone.")
      .replace("Loading seller area…", "Chargement espace vendeur…")
      .replace("Seller Dashboard", "Tableau de bord vendeur")
      .replace("Products", "Produits")
      .replace("Orders", "Commandes")
      .replace("Manage products", "Gérer les produits")
      .replace("View orders", "Voir les commandes")
      .replace("Become a Seller", "Devenir vendeur")
      .replace("Please fill in all required fields.", "Veuillez remplir tous les champs requis.")
      .replace("Application submitted", "Candidature envoyée")
      .replace("Submit for review", "Envoyer pour validation")
      .replace("Business name", "Nom de l'entreprise")
      .replace("Country code", "Code pays")
      .replace("City", "Ville")
      .replace("Address", "Adresse")
      .replace("Phone", "Téléphone")
      .replace("Marketplace Orders", "Commandes marketplace")
      .replace("Read-only preview — checkout not live yet.", "Aperçu lecture seule — checkout non actif.")
      .replace("No marketplace orders yet.", "Aucune commande marketplace.")
      .replace("Delivery not live yet", "Livraison non active")
      .replace("Delivery shadow", "Livraison shadow")
      .replace("Est. delivery", "Livraison est.")
      .replace("No products yet.", "Aucun produit.")
      .replace("Your seller account must be approved first.", "Votre compte vendeur doit être approuvé.")
      .replace("Invalid product data", "Données produit invalides")
      .replace("Activate", "Activer")
      .replace("Deactivate", "Désactiver")
      .replace("Edit product", "Modifier le produit")
      .replace("New product", "Nouveau produit")
      .replace("Active", "Actif")
      .replace("Load failed", "Échec chargement")
      .replace("Save failed", "Échec enregistrement")
      .replace("Update failed", "Échec mise à jour")
  );
  suffixMap(map, "taxi", (v) =>
    v
      .replace("Country", "Pays")
      .replace("Currency", "Devise")
      .replace("Your estimate", "Votre estimation")
      .replace("Subtotal", "Sous-total")
      .replace("Tax", "Taxes")
      .replace("Platform fee", "Frais plateforme")
      .replace("Total", "Total")
      .replace("Detected from pickup", "Détecté depuis le pickup")
      .replace("Estimates in", "Estimation en")
      .replace("← Back", "← Retour")
      .replace("Loading…", "Chargement…")
      .replace("Book a ride — separate from delivery packages.", "Réserver une course — séparé des livraisons colis.")
      .replace("Pickup", "Prise en charge")
      .replace("Dropoff", "Destination")
      .replace("Pickup address", "Adresse de prise en charge")
      .replace("Dropoff address", "Adresse de destination")
      .replace("Pin exact pickup on map", "Épingler le pickup sur la carte")
      .replace("Pin exact dropoff on map", "Épingler la destination sur la carte")
      .replace("Pickup pinned on map", "Pickup épinglé sur la carte")
      .replace("Dropoff pinned on map", "Destination épinglée sur la carte")
      .replace("Pickup exact location", "Position exacte pickup")
      .replace("Dropoff exact location", "Position exacte destination")
      .replace("Use pickup location", "Utiliser le pickup")
      .replace("Use dropoff location", "Utiliser la destination")
      .replace("Vehicle", "Véhicule")
      .replace("Get estimate", "Obtenir une estimation")
      .replace("View ride history", "Historique des courses")
      .replace("Favorite drivers", "Chauffeurs favoris")
      .replace("Loyalty points", "Points fidélité")
      .replace("Scheduled rides", "Courses programmées")
      .replace("Multi-stop ride", "Course multi-arrêts")
      .replace("Loyalty rewards", "Récompenses fidélité")
      .replace("Missing address", "Adresse manquante")
      .replace("Enter pickup and dropoff addresses.", "Saisissez les adresses pickup et destination.")
      .replace("Estimate failed", "Estimation échouée")
      .replace("Pickup location does not match selected country.", "Le pickup ne correspond pas au pays sélectionné.")
      .replace("Unable to get estimate", "Impossible d'obtenir une estimation")
      .replace("Distance", "Distance")
      .replace("Duration", "Durée")
      .replace("Pin pickup", "Épingler pickup")
      .replace("Pickup pinned", "Pickup épinglé")
      .replace("Price breakdown", "Détail du prix")
      .replace("Confirm & pay", "Confirmer et payer")
      .replace("Shared ride (-15%)", "Course partagée (-15%)")
      .replace("Premium driver only", "Chauffeur premium uniquement")
      .replace("Business ride", "Course business")
      .replace("Apply", "Appliquer")
      .replace("Taxi history", "Historique taxi")
      .replace("No taxi rides yet.", "Aucune course taxi.")
      .replace("Favorite drivers", "Chauffeurs favoris")
      .replace("Add favorite", "Ajouter favori")
      .replace("Saving…", "Enregistrement…")
      .replace("Taxi loyalty", "Fidélité taxi")
      .replace("Balance", "Solde")
      .replace("History", "Historique")
      .replace("Loyalty rewards", "Récompenses fidélité")
      .replace("Balance: {{count}} pts", "Solde : {{count}} pts")
      .replace("Book scheduled ride", "Réserver une course programmée")
      .replace("Cancel reservation", "Annuler la réservation")
      .replace("Schedule a ride", "Programmer une course")
      .replace("Reserve & prepay", "Réserver et prépayer")
      .replace("Taxi chat", "Chat taxi")
      .replace("Message driver…", "Message chauffeur…")
      .replace("Message client…", "Message client…")
      .replace("Payment pending", "Paiement en attente")
      .replace("Retry payment confirmation", "Réessayer confirmation paiement")
      .replace("Chat", "Chat")
      .replace("Cancel", "Annuler")
      .replace("Cancel ride", "Annuler la course")
      .replace("Send", "Envoyer")
      .replace("Promo code", "Code promo")
      .replace("Enter code", "Saisir le code")
      .replace("Invalid promo code", "Code promo invalide")
      .replace("Promo discount", "Réduction promo")
      .replace("Reward credit", "Crédit récompense")
      .replace("Shared ride discount", "Réduction course partagée")
      .replace("Loyalty reward", "Récompense fidélité")
      .replace("None", "Aucun")
      .replace("Any", "N'importe")
      .replace("Preferred driver (optional)", "Chauffeur préféré (optionnel)")
      .replace("Payment", "Paiement")
      .replace("Unable to start payment", "Impossible de démarrer le paiement")
      .replace("Tap to track", "Appuyer pour suivre")
      .replace("Driver user ID", "ID chauffeur")
      .replace("Remove", "Supprimer")
      .replace("Add failed", "Échec ajout")
      .replace("Remove failed", "Échec suppression")
      .replace("No loyalty activity yet.", "Aucune activité fidélité.")
      .replace("Booking failed", "Échec réservation")
      .replace("Stop 1 (optional)", "Arrêt 1 (optionnel)")
      .replace("Stop 2 (optional)", "Arrêt 2 (optionnel)")
      .replace("Final destination", "Destination finale")
      .replace("Pricing uses total route distance/duration.", "Tarif basé sur distance/durée totale.")
      .replace("Send failed", "Échec envoi")
      .replace("Image failed", "Échec image")
      .replace("Error", "Erreur")
      .replace("If you already paid, we will confirm automatically. You can also retry now.", "Si vous avez payé, confirmation automatique.")
      .replace("Confirming…", "Confirmation…")
      .replace("Cancel this taxi ride?", "Annuler cette course ?")
      .replace("Yes, cancel", "Oui, annuler")
      .replace("No", "Non")
      .replace("Unable to cancel", "Impossible d'annuler")
      .replace("Unable to load ride", "Impossible de charger la course")
      .replace("Map unavailable", "Carte indisponible")
      .replace("Looking for a driver…", "Recherche d'un chauffeur…")
      .replace("Ride", "Course")
      .replace("Pin dropoff", "Épingler destination")
      .replace("Dropoff pinned", "Destination épinglée")
      .replace("Apply on the quote screen before checkout.", "Appliquer sur l'écran de devis avant checkout.")
  );
  suffixMap(map, "client.home", (v) =>
    v
      .replace("Good morning", "Bonjour")
      .replace("Good afternoon", "Bon après-midi")
      .replace("Good evening", "Bonsoir")
      .replace("Delivery request", "Demande de livraison")
      .replace("Restaurant order", "Commande restaurant")
      .replace("Language", "Langue")
      .replace("Unable to change language right now.", "Impossible de changer la langue.")
      .replace("Shop local sellers", "Acheter chez des vendeurs locaux")
      .replace("Ride with MMD Taxi — separate from delivery", "Course MMD Taxi — séparé de la livraison")
      .replace(
        "MMD is under maintenance in your area. New orders are temporarily disabled.",
        "MMD est en maintenance dans votre zone. Nouvelles commandes désactivées."
      )
      .replace("Coming soon in your area", "Bientôt disponible dans votre zone")
  );
  suffixMap(map, "client.profile", (v) =>
    v
      .replace("Loading profile…", "Chargement du profil…")
      .replace("Unable to upload photo. Check storage permissions.", "Impossible d'envoyer la photo. Vérifiez les permissions.")
  );
  suffixMap(map, "client.deliveryRequest", (v) =>
    v
      .replace("Total", "Total")
      .replace("Delivery fee", "Frais de livraison")
      .replace("Unable to load delivery request", "Impossible de charger la demande de livraison")
  );
  suffixMap(map, "location", (v) =>
    v
      .replace(
        "Map unavailable. Configure EXPO_PUBLIC_MAPBOX_TOKEN to use the location picker.",
        "Carte indisponible. Configurez EXPO_PUBLIC_MAPBOX_TOKEN."
      )
      .replace("Choose location", "Choisir un emplacement")
      .replace("Use this location", "Utiliser cet emplacement")
  );
  suffixMap(map, "auth.resetPassword", (v) =>
    v
      .replace("Reset password", "Réinitialiser le mot de passe")
      .replace("New password", "Nouveau mot de passe")
      .replace("Confirm password", "Confirmer le mot de passe")
      .replace("Email", "E-mail")
      .replace("Send reset link", "Envoyer le lien")
      .replace("Update password", "Mettre à jour le mot de passe")
      .replace("Check your email for a reset link.", "Consultez votre e-mail pour le lien.")
      .replace("Unable to send reset link.", "Impossible d'envoyer le lien.")
      .replace("Invalid or expired link. Request a new one.", "Lien invalide ou expiré.")
      .replace("Unable to prepare reset.", "Impossible de préparer la réinitialisation.")
      .replace("Passwords do not match.", "Les mots de passe ne correspondent pas.")
      .replace("Password updated. You can log in now.", "Mot de passe mis à jour.")
      .replace("Unable to update password.", "Impossible de mettre à jour le mot de passe.")
      .replace("Checking session…", "Vérification de la session…")
      .replace("Error", "Erreur")
  );
  suffixMap(map, "client.deliveryRequest", (v) =>
    v
      .replace("Delivery Request", "Demande de livraison")
      .replace("Waiting for a driver", "En attente d'un chauffeur")
      .replace("Driver on the way", "Chauffeur en route")
      .replace("Driver assigned", "Chauffeur assigné")
      .replace("Preparing pickup", "Préparation du pickup")
      .replace("Ready for pickup", "Prêt pour pickup")
      .replace("On the way", "En route")
      .replace("Delivered", "Livré")
      .replace("Canceled", "Annulé")
      .replace("Pending", "En attente")
      .replace("Paid", "Payé")
      .replace("Processing", "Traitement")
      .replace("Unpaid", "Non payé")
      .replace("Cancel trip", "Annuler la course")
      .replace("Keep trip", "Garder la course")
      .replace("Trip cancelled", "Course annulée")
      .replace("Unable to cancel this trip.", "Impossible d'annuler cette course.")
      .replace("You must be logged in.", "Vous devez être connecté.")
      .replace("Loading request...", "Chargement...")
      .replace("Unable to load this request", "Impossible de charger cette demande")
      .replace("No request found", "Aucune demande trouvée")
      .replace("Missing requestId.", "requestId manquant.")
      .replace("Delivery request not found.", "Demande introuvable.")
      .replace("Current status", "Statut actuel")
      .replace("Payment status", "Statut paiement")
      .replace("Driver status", "Statut chauffeur")
      .replace("Your driver", "Votre chauffeur")
      .replace("Assigned driver", "Chauffeur assigné")
      .replace("Trip reference", "Référence course")
      .replace("Request reference", "Référence demande")
      .replace("Completed", "Terminé")
      .replace("Total", "Total")
      .replace("Delivery fee", "Frais de livraison")
      .replace("Unable to load delivery request", "Impossible de charger la demande de livraison")
  );
  suffixMap(map, "driver.w9", (v) =>
    v
      .replace("W-9", "W-9")
      .replace("Status", "Statut")
      .replace("Signed", "Signé")
      .replace("Missing", "Manquant")
      .replace("Signed date", "Date de signature")
      .replace("Submit W-9", "Soumettre W-9")
      .replace("Download W-9 PDF", "Télécharger PDF W-9")
      .replace("Checklist", "Liste de contrôle")
      .replace("Legal name", "Nom légal")
      .replace("Failed to load", "Échec chargement")
      .replace("Saved.", "Enregistré.")
  );
  suffixMap(map, "restaurant.financial", (v) =>
    v
      .replace("Financial Center", "Centre financier")
      .replace("Loading financial center...", "Chargement centre financier...")
      .replace("Gross Sales", "Ventes brutes")
      .replace("Commission", "Commission")
      .replace("Net Revenue", "Revenu net")
      .replace("Orders", "Commandes")
      .replace("Payouts", "Paiements")
      .replace("Pending payout", "Paiement en attente")
      .replace("Last payout", "Dernier paiement")
      .replace("Monthly Statements", "Relevés mensuels")
      .replace("Tax Documents", "Documents fiscaux")
  );
  return map;
}

function makeLangMap(langHeader, trees, baseMap) {
  const map = { ...(baseMap ?? {}) };
  for (const [key, value] of Object.entries(enFlat)) {
    if (map[key] == null) map[key] = value;
  }
  Object.assign(map, langHeader);
  for (const [prefix, pairs] of trees) {
    applyLangTree(map, prefix, pairs);
  }
  return map;
}

function makeEs() {
  return makeLangMap(ES, [
    ["marketplace", ES_MARKETPLACE],
    ["seller", ES_SELLER],
    ["taxi", ES_TAXI],
    ["client", ES_CLIENT],
    ["location", ES_LOCATION],
    ["auth", ES_AUTH],
    ["driver", ES_DRIVER],
    ["restaurant", ES_RESTAURANT],
  ], makeFr());
}

function makeAr() {
  return makeLangMap(AR, [
    ["marketplace", AR_MARKETPLACE],
    ["seller", AR_SELLER],
    ["taxi", AR_TAXI],
    ["client", AR_CLIENT],
    ["location", AR_LOCATION],
    ["auth", AR_AUTH],
    ["driver", AR_DRIVER],
    ["restaurant", AR_RESTAURANT],
  ], makeFr());
}

function makeZh() {
  return makeLangMap(ZH, [
    ["marketplace", ZH_MARKETPLACE],
    ["seller", ZH_SELLER],
    ["taxi", ZH_TAXI],
    ["client", ZH_CLIENT],
    ["location", ZH_LOCATION],
    ["auth", ZH_AUTH],
    ["driver", ZH_DRIVER],
    ["restaurant", ZH_RESTAURANT],
  ], makeFr());
}

function makeFf() {
  return makeLangMap(FF, [
    ["marketplace", FF_MARKETPLACE],
    ["seller", FF_SELLER],
    ["taxi", FF_TAXI],
    ["client", FF_CLIENT],
    ["location", FF_LOCATION],
    ["auth", FF_AUTH],
    ["driver", FF_DRIVER],
    ["restaurant", FF_RESTAURANT],
  ], makeFr());
}

function applyLangTree(map, prefix, pairs) {
  for (const key of Object.keys(enFlat)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    const enVal = enFlat[key];
    const current = map[key] ?? enVal;
    if (pairs[enVal]) {
      map[key] = pairs[enVal];
      continue;
    }
    if (pairs["*"]) {
      let out = current;
      for (const [from, to] of pairs["*"]) out = out.replace(from, to);
      if (out !== current) map[key] = out;
    }
  }
}

const ES_MARKETPLACE = {
  Marketplace: "Marketplace",
  "Shop approved local sellers on MMD.": "Compra a vendedores locales aprobados en MMD.",
  "*": [["Subtotal", "Subtotal"], ["Total", "Total"], ["Checkout", "Pago"], ["Delivery", "Entrega"]],
};
const ES_SELLER = { "Seller Dashboard": "Panel del vendedor", Products: "Productos", Orders: "Pedidos" };
const ES_TAXI = {
  "MMD Taxi": "MMD Taxi",
  Pickup: "Recogida",
  Dropoff: "Destino",
  "Get estimate": "Obtener estimación",
  "← Back": "← Atrás",
  "*": [
    ["Cancel", "Cancelar"],
    ["Chat", "Chat"],
    ["Balance", "Saldo"],
    ["Payment", "Pago"],
    ["Remove", "Eliminar"],
    ["History", "Historial"],
    ["Prise en charge", "Recogida"],
    ["Destination", "Destino"],
    ["Confirmer", "Confirmar"],
    ["Course", "Viaje"],
    ["Paiement", "Pago"],
  ],
};
const ES_CLIENT = {
  "Good morning": "Buenos días",
  "Good afternoon": "Buenas tardes",
  "Good evening": "Buenas noches",
  "Delivery Request": "Solicitud de entrega",
  "Driver assigned": "Conductor asignado",
  Pending: "Pendiente",
  Delivered: "Entregado",
};
const ES_LOCATION = { Back: "Atrás", "Use this location": "Usar esta ubicación" };
const ES_AUTH = { "Reset password": "Restablecer contraseña", Email: "Correo" };
const ES_DRIVER = { "W-9": "W-9", Status: "Estado", Signed: "Firmado" };
const ES_RESTAURANT = { "Financial Center": "Centro financiero", Orders: "Pedidos" };

const AR_MARKETPLACE = {
  Marketplace: "السوق",
  "Shop approved local sellers on MMD.": "تسوق من البائعين المحليين المعتمدين على MMD.",
  "*": [["Subtotal", "المجموع الفرعي"], ["Total", "الإجمالي"], ["Checkout", "الدفع"]],
};
const AR_SELLER = { "Seller Dashboard": "لوحة البائع", Products: "المنتجات", Orders: "الطلبات" };
const AR_TAXI = {
  "MMD Taxi": "MMD تاكسي",
  Pickup: "الاستلام",
  Dropoff: "التوصيل",
  "Get estimate": "احصل على تقدير",
  "← Back": "← رجوع",
  "*": [
    ["Cancel", "إلغاء"],
    ["Chat", "محادثة"],
    ["Prise en charge", "الاستلام"],
    ["Destination", "التوصيل"],
    ["Course", "رحلة"],
    ["Paiement", "الدفع"],
  ],
};
const AR_CLIENT = {
  "Good morning": "صباح الخير",
  "Delivery Request": "طلب توصيل",
  "Driver assigned": "تم تعيين السائق",
  Pending: "قيد الانتظار",
};
const AR_LOCATION = { Back: "رجوع", "Use this location": "استخدم هذا الموقع" };
const AR_AUTH = { "Reset password": "إعادة تعيين كلمة المرور", Email: "البريد" };
const AR_DRIVER = { "W-9": "W-9", Status: "الحالة", Signed: "موقّع" };
const AR_RESTAURANT = { "Financial Center": "المركز المالي", Orders: "الطلبات" };

const ZH_MARKETPLACE = {
  Marketplace: "商城",
  "Shop approved local sellers on MMD.": "在 MMD 购买本地认证卖家商品。",
  "*": [["Subtotal", "小计"], ["Total", "总计"], ["Checkout", "结账"]],
};
const ZH_SELLER = { "Seller Dashboard": "卖家面板", Products: "商品", Orders: "订单" };
const ZH_TAXI = {
  "MMD Taxi": "MMD 出租车",
  Pickup: "上车点",
  Dropoff: "目的地",
  "Get estimate": "获取估价",
  "← Back": "← 返回",
  "*": [["Cancel", "取消"], ["Chat", "聊天"]],
};
const ZH_CLIENT = {
  "Good morning": "早上好",
  "Delivery Request": "配送请求",
  "Driver assigned": "已分配司机",
  Pending: "待处理",
};
const ZH_LOCATION = { Back: "返回", "Use this location": "使用此位置" };
const ZH_AUTH = { "Reset password": "重置密码", Email: "邮箱" };
const ZH_DRIVER = { "W-9": "W-9", Status: "状态", Signed: "已签署" };
const ZH_RESTAURANT = { "Financial Center": "财务中心", Orders: "订单" };

const FF_MARKETPLACE = {
  Marketplace: "Suudu lataande",
  "Shop approved local sellers on MMD.": "Soɗa e jaɓɓe ɗe MMD.",
};
const FF_SELLER = { "Seller Dashboard": "Dashboard jaɓɓo", Products: "Produits", Orders: "Commandes" };
const FF_TAXI = {
  Pickup: "Fuɗɗorde",
  Dropoff: "Jaɓorde",
  "Get estimate": "Heɓ estimate",
  "← Back": "← Ruttude",
};
const FF_CLIENT = {
  "Good morning": "Jam waati",
  "Delivery Request": "Demande livraison",
  Language: "Demdol",
};
const FF_LOCATION = { Back: "Ruttude", "Use this location": "Huutoro nokku ngal" };
const FF_AUTH = { "Reset password": "Reset password", Email: "Email" };
const FF_DRIVER = { "W-9": "W-9", Status: "Status", Signed: "Signed" };
const FF_RESTAURANT = { "Financial Center": "Centre financier", Orders: "Commandes" };

fs.mkdirSync(mapsDir, { recursive: true });
const frMap = makeFr();
fs.writeFileSync(path.join(mapsDir, "fr.flat.json"), JSON.stringify(frMap, null, 2));
fs.writeFileSync(path.join(mapsDir, "es.flat.json"), JSON.stringify(makeEs(), null, 2));
fs.writeFileSync(path.join(mapsDir, "ar.flat.json"), JSON.stringify(makeAr(), null, 2));
fs.writeFileSync(path.join(mapsDir, "zh.flat.json"), JSON.stringify(makeZh(), null, 2));
fs.writeFileSync(path.join(mapsDir, "ff.flat.json"), JSON.stringify(makeFf(), null, 2));
console.log("generated flat maps in", mapsDir);
