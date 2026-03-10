import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Backend from "i18next-http-backend";

const SUPPORTED_LANGUAGES = ["en", "es", "pt", "de", "fr"] as const;
type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

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

// Detect preferred language from localStorage/navigator, but don't apply it
// during init. We force "en" at init time so the first client render matches the
// server-rendered HTML (which always uses English defaults). The I18nProvider
// applies the detected language after hydration via useEffect.
function detectPreferredLanguage(): SupportedLanguage {
  if (typeof window === "undefined") return "en";
  try {
    const stored = localStorage.getItem("ami-language");
    if (stored && SUPPORTED_LANGUAGES.includes(stored as SupportedLanguage)) {
      return stored as SupportedLanguage;
    }
  } catch { /* localStorage unavailable */ }
  const nav = navigator.language?.split("-")[0];
  if (nav && SUPPORTED_LANGUAGES.includes(nav as SupportedLanguage)) {
    return nav as SupportedLanguage;
  }
  return "en";
}

export { detectPreferredLanguage };

i18n
  .use(Backend)
  .use(initReactI18next)
  .init({
    lng: "en", // Always start with English; provider switches after hydration
    supportedLngs: [...SUPPORTED_LANGUAGES],
    fallbackLng: "en",
    load: "languageOnly",
    defaultNS: "common",
    ns: ["common"],
    backend: {
      loadPath: "/locales/{{lng}}/{{ns}}.json",
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

// Persist language choice to localStorage (replaces LanguageDetector caching)
i18n.on("languageChanged", (lng) => {
  try {
    localStorage.setItem("ami-language", lng.split("-")[0]);
  } catch { /* localStorage unavailable */ }
});

export default i18n;
