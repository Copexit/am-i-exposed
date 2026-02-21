import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import Backend from "i18next-http-backend";

export const SUPPORTED_LANGUAGES = ["en", "es", "pt", "de", "fr"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_OPTIONS: {
  code: SupportedLanguage;
  flag: string;
  label: string;
}[] = [
  { code: "en", flag: "\u{1F1EC}\u{1F1E7}", label: "EN" },
  { code: "es", flag: "\u{1F1EA}\u{1F1F8}", label: "ES" },
  { code: "pt", flag: "\u{1F1E7}\u{1F1F7}", label: "PT" },
  { code: "de", flag: "\u{1F1E9}\u{1F1EA}", label: "DE" },
  { code: "fr", flag: "\u{1F1EB}\u{1F1F7}", label: "FR" },
];

i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: "en",
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "ami-language",
      caches: ["localStorage"],
    },
    interpolation: {
      // React handles XSS escaping via JSX textContent, so i18next HTML escaping
      // is redundant. IMPORTANT: Never use t() output in dangerouslySetInnerHTML.
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;
