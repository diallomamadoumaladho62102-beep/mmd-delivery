import fs from "node:fs";

const p = "apps/mobile/src/components/location/MMDLocationPicker.tsx";
let s = fs.readFileSync(p, "utf8");

const map = [
  ["location.picker.streetNumberPh", "locationPicker.streetNumberPlaceholder"],
  ["location.picker.streetNumber", "locationPicker.streetNumber"],
  ["location.picker.cityPh", "locationPicker.cityPlaceholder"],
  ["location.picker.city", "locationPicker.city"],
  ["location.picker.postalPh", "locationPicker.zipPlaceholder"],
  ["location.picker.postal", "locationPicker.zip"],
  ["location.picker.streetOptionalPh", "locationPicker.streetOptionalPlaceholder"],
  ["location.picker.streetOptional", "locationPicker.streetOptional"],
  ["location.picker.communePh", "locationPicker.communePlaceholder"],
  ["location.picker.commune", "locationPicker.commune"],
  ["location.picker.quartierPh", "locationPicker.quartierPlaceholder"],
  ["location.picker.quartier", "locationPicker.quartier"],
  ["location.picker.landmarkRequired", "locationPicker.landmarkSearchRequired"],
  ["location.picker.landmarkPh", "locationPicker.landmarkPlaceholder"],
  ["location.picker.landmark", "locationPicker.landmarkSearch"],
  ["location.picker.formattedOptionalPh", "locationPicker.formattedAddressPlaceholder"],
  ["location.picker.formattedOptional", "locationPicker.formattedAddress"],
  ["location.picker.directionsPh", "locationPicker.directionsPlaceholder"],
  ["location.picker.directionsMin", "locationPicker.directionsMin"],
  ["location.picker.directions", "locationPicker.directions"],
];

for (const [a, b] of map) s = s.split(a).join(b);

s = s.replace(
  "<FieldLabel>Photo of the place (recommended)</FieldLabel>",
  '<FieldLabel>{t("locationPicker.photoLabel", "Photo of the place (recommended)")}</FieldLabel>',
);

s = s.replace(
  '{photoUri ? "Retake location photo" : "Add photo of gate, shop, or building"}',
  `{photoUri
              ? t("locationPicker.retakePhoto", "Retake location photo")
              : t(
                  "locationPicker.addPhoto",
                  "Add photo of gate, shop, or building",
                )}`,
);

fs.writeFileSync(p, s);
console.log(
  "remaining location.picker",
  (s.match(/location\.picker\./g) || []).length,
  "hardcoded photo",
  s.includes("Photo of the place (recommended)</FieldLabel>"),
);
