export type AppLanguageCode = "en" | "fr" | "es" | "ar" | "zh" | "ff";

export type LanguageOption = {
  code: AppLanguageCode;
  label: string;
  nativeLabel: string;
  flag: string;
  rtl?: boolean;
};

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "fr", label: "French", nativeLabel: "Français", flag: "🇫🇷" },
  { code: "es", label: "Spanish", nativeLabel: "Español", flag: "🇪🇸" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", flag: "🇸🇦", rtl: true },
  { code: "zh", label: "Chinese", nativeLabel: "中文", flag: "🇨🇳" },
  {
    code: "ff",
    label: "Fulfulde",
    nativeLabel: "Pulaar / Fulfulde",
    flag: "🌍",
  },
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);
