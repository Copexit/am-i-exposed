"use client";

import { Tags } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LabelTagChip } from "@/components/wallet/WalletLabels";
import type { LabelTag } from "@/lib/wallet/labels";

const PREFIXES: { tag: LabelTag; text: string; def: string }[] = [
  { tag: "kyc", text: "[KYC]", def: "Bought or withdrawn with your identity: an exchange or a broker that verified you." },
  { tag: "nokyc", text: "[noKYC]", def: "Acquired without identity: peer-to-peer trades (Bisq, RoboSats, Hodl Hodl), mining, work paid in bitcoin." },
  { tag: "cj", text: "[CJ]", def: "A CoinJoin output (Whirlpool, WabiSabi, JoinMarket)." },
  { tag: "change", text: "[change] / [cambio]", def: "Change of one of your own spends. It inherits the origin of the coins it came from." },
  { tag: "toxic", text: "[toxic] / [tóxico]", def: "Dust, CoinJoin change or coins from a doubtful source." },
  { tag: "person", text: "[person] / [persona]", def: "Paid by someone who knows who you are: a friend, a client, an employer." },
];

const WHAT = [
  { key: "addr", def: "Address labels say whom the address was given to." },
  { key: "output", def: "Output labels say where the coin came from and its state." },
  { key: "tx", def: "Transaction labels say the purpose and the counterparty." },
  { key: "frozen", def: "Mark dust, toxic coins and coins to keep as not spendable (spendable: false, \"freeze\" in Sparrow)." },
];

const RULES = [
  "Never merge [KYC] coins with [noKYC] coins.",
  "Do not merge [CJ] coins with coins that are not [CJ]: spend them one by one, ideally with no change.",
  "Merge only coins with the same origin, or coins already linked on-chain.",
  "Change inherits the origin of its parent coins.",
  "Toxic coins: freeze them, or remix them alone.",
];

/** The labeling convention and spending rules the wallet labels import follows (lib/wallet/labels). */
export function LabelingSection() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h2 id="labeling-coins" className="text-2xl font-bold text-foreground scroll-mt-24">
        <Tags size={20} className="inline mr-2 text-bitcoin" aria-hidden="true" />
        {t("guide.labeling.title", { defaultValue: "How to label coins" })}
      </h2>
      <p className="text-base text-muted leading-relaxed">
        {t("guide.labeling.intro", { defaultValue: "A label is a private note a wallet keeps next to each coin. Written the same way every time, labels tell which coins can be spent together without tying your identities together. Wallets exchange them as BIP329 files (in Sparrow: Export Wallet and Import Wallet, Labels), and the am-i.exposed wallet scan reads them to mark coins and to guide the coin selector." })}
      </p>

      <div className="rounded-lg border border-card-border px-4 py-3 space-y-2">
        <p className="text-sm text-muted">{t("guide.labeling.formatTitle", { defaultValue: "Format, in this order:" })}</p>
        <p className="font-mono text-base text-foreground">[ORIGIN] {t("guide.labeling.who", { defaultValue: "who" })} · {t("guide.labeling.detail", { defaultValue: "detail" })}</p>
        <p className="text-sm text-muted">
          {t("guide.labeling.example", { defaultValue: "For example:" })}{" "}
          <code className="font-mono text-foreground">[KYC] Bitstamp · withdrawal March</code>,{" "}
          <code className="font-mono text-foreground">[noKYC] RoboSats · order 4821</code>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{t("guide.labeling.prefixesTitle", { defaultValue: "Origin prefixes" })}</h3>
        <ul className="space-y-2">
          {PREFIXES.map(p => (
            <li key={p.tag} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 items-baseline text-sm">
              <span className="flex flex-col gap-1 items-start">
                <code className="font-mono text-foreground">{p.text}</code>
                <LabelTagChip tag={p.tag} />
              </span>
              <span className="text-muted leading-relaxed">{t(`guide.labeling.prefix.${p.tag}`, { defaultValue: p.def })}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t("guide.labeling.prefixNote", { defaultValue: "Case does not matter, and the English and Spanish words are both recognized." })}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{t("guide.labeling.whatTitle", { defaultValue: "What each label says" })}</h3>
        <ul className="space-y-1">
          {WHAT.map(w => (
            <li key={w.key} className="flex items-start gap-2 text-sm text-muted leading-relaxed">
              <span className="text-bitcoin shrink-0 mt-0.5">-</span>
              {t(`guide.labeling.what.${w.key}`, { defaultValue: w.def })}
            </li>
          ))}
        </ul>
      </div>

      <div className="bg-severity-good/5 border border-severity-good/15 rounded-lg px-4 py-3 space-y-1.5">
        <h3 className="text-base font-medium text-foreground/90">{t("guide.labeling.rulesTitle", { defaultValue: "Spending rules" })}</h3>
        <ol className="space-y-1 list-decimal pl-5">
          {RULES.map((r, i) => (
            <li key={i} className="text-sm text-muted leading-relaxed">{t(`guide.labeling.rule${i + 1}`, { defaultValue: r })}</li>
          ))}
        </ol>
        <p className="text-sm text-muted leading-relaxed pt-1">
          {t("guide.labeling.rulesNote", { defaultValue: "With labels loaded, the coin selection advisor warns about and ranks down plans that break rules 1, 2, 3 and 5, and leaves frozen coins out unless asked." })}
        </p>
      </div>
    </section>
  );
}
