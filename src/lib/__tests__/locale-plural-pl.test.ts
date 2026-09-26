import { describe, it, expect } from "vitest";
import i18next from "i18next";
import pl from "../../../public/locales/pl/common.json";

describe("Polish plural forms", () => {
  it("resolves the singular, _few and _many forms for integer counts", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({ lng: "pl", resources: { pl: { translation: pl } }, keySeparator: false, nsSeparator: false });
    const title = (count: number) => i18n.t("finding.entity-ofac-match.title", { count });
    expect(title(1)).toBe("Wykryto adres objęty sankcjami OFAC");
    expect(title(2)).toBe("Wykryto 2 adresy objęte sankcjami OFAC");
    expect(title(5)).toBe("Wykryto 5 adresów objętych sankcjami OFAC");
    expect(title(22)).toBe("Wykryto 22 adresy objęte sankcjami OFAC");
    expect(i18n.t("results.issueCount", { count: 12 })).toBe("12 problemów");
  });
});
