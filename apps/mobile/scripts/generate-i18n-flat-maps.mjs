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
      .replace("Email", "E-mail")
      .replace("Send reset link", "Envoyer le lien")
      .replace("Check your email for a reset link.", "Consultez votre e-mail pour le lien.")
      .replace("Unable to send reset link.", "Impossible d'envoyer le lien.")
  );
  return map;
}

function cloneMap(source) {
  const out = {};
  for (const [key, value] of Object.entries(enFlat)) {
    out[key] = source[key] ?? value;
  }
  return out;
}

fs.mkdirSync(mapsDir, { recursive: true });
const frMap = makeFr();
fs.writeFileSync(path.join(mapsDir, "fr.flat.json"), JSON.stringify(frMap, null, 2));
fs.writeFileSync(path.join(mapsDir, "es.flat.json"), JSON.stringify(cloneMap({ ...ES, ...frMap }), null, 2));
fs.writeFileSync(path.join(mapsDir, "ar.flat.json"), JSON.stringify(cloneMap({ ...AR, ...frMap }), null, 2));
fs.writeFileSync(path.join(mapsDir, "zh.flat.json"), JSON.stringify(cloneMap({ ...ZH, ...frMap }), null, 2));
fs.writeFileSync(path.join(mapsDir, "ff.flat.json"), JSON.stringify(cloneMap({ ...FF, ...frMap }), null, 2));
console.log("generated flat maps in", mapsDir);
