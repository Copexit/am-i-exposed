/** Shared react-i18next mock: defaultValue with {{placeholders}} filled. Import before the components. */
import { vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      let s = (opts?.defaultValue as string) ?? key;
      for (const [k, v] of Object.entries(opts ?? {})) s = s.split(`{{${k}}}`).join(String(v));
      return s;
    },
    i18n: { language: "en" },
  }),
}));
