"use client";

import { Download, Tags } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LabelTagChip } from "@/components/wallet/WalletLabels";
import type { LabelTag } from "@/lib/wallet/labels";
import { exampleLabels, serializeBip329 } from "@/lib/wallet/bip329";

const PREFIXES: { tag: LabelTag; text: string; def: string }[] = [
  { tag: "kyc", text: "[KYC]", def: "Bought or withdrawn with your identity: an exchange or a broker that verified you." },
  { tag: "nokyc", text: "[noKYC]", def: "Acquired without identity: peer-to-peer trades (Bisq, RoboSats, Hodl Hodl), mining, work paid in bitcoin." },
  { tag: "cj", text: "[CJ]", def: "A CoinJoin output (Whirlpool, WabiSabi, JoinMarket)." },
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

/** Sparrow how-to steps (menu names checked against Sparrow's source: app.fxml, EntryCell, WalletForm). */
const SPARROW = [
  { key: "tx", def: "Label in the Transactions tab: double-click the Label column of a transaction. Sparrow copies the label to that transaction's coins in the UTXOs tab, adding \"(received)\" or \"(change)\", and to the address when it has no label. A label typed in the UTXOs tab is not copied back to the transaction." },
  { key: "utxo", def: "Give a coin its own label in the UTXOs tab (Label column) only when it needs one: for example one of several outputs of the same transaction with a different origin." },
  { key: "addr", def: "The Addresses tab has a Label column too: label a receive address with whom it was given to before the payment arrives." },
  { key: "freeze", def: "Freeze a coin: in the UTXOs tab, right-click it and choose Freeze UTXO (Unfreeze UTXO undoes it). A frozen coin is exported as spendable: false." },
  { key: "export", def: "Export: File menu, Export Wallet..., then Labels. The result is a BIP329 .jsonl file; load it in the wallet scan with Import file in the Labels panel." },
  { key: "import", def: "Import into Sparrow: open the wallet, then File menu, Import Wallet..., then Labels." },
];

/** Save the example labels file (generated here, nothing is fetched). */
function downloadExample() {
  const blob = new Blob([serializeBip329(exampleLabels())], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "example-labels.jsonl";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The labeling convention and spending rules the wallet labels import follows (lib/wallet/labels). */
export function LabelingSection() {
  const { t } = useTranslation();
  return (
    <section className="space-y-4">
      <h2 id="labeling-coins" className="text-2xl font-bold text-foreground scroll-mt-24">
        <Tags size={20} className="inline mr-2 text-bitcoin" aria-hidden="true" />
        {t("guide.labeling.title", { defaultValue: "Labeling recommendations" })}
      </h2>
      <p className="text-base text-muted leading-relaxed">
        {t("guide.labeling.intro", { defaultValue: "A label is a private note a wallet keeps next to each coin. Written the same way every time, labels tell which coins can be spent together without tying your identities together. Wallets exchange them as BIP329 files (in Sparrow: Export Wallet and Import Wallet, Labels), and the am-i.exposed wallet scan reads them to mark coins and to guide the coin selector." })}
      </p>

      <div data-testid="labeling-best-practice" className="bg-severity-good/5 border border-severity-good/15 rounded-lg px-4 py-3 space-y-1.5">
        <h3 className="text-base font-medium text-foreground/90">{t("guide.labeling.bestPracticeTitle", { defaultValue: "Best practice: one account per origin" })}</h3>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.labeling.bestPractice", { defaultValue: "Keep separate wallets or accounts for KYC, no-KYC and post-CoinJoin coins, and an accidental merge becomes impossible. Labels then only need the observer and the detail, and the wallet-level origin setting in the wallet scan (\"This wallet holds\") covers the rest. Prefixes matter most when origins share one wallet." })}
        </p>
      </div>

      <div className="rounded-lg border border-card-border px-4 py-3 space-y-2">
        <p className="text-sm text-muted">{t("guide.labeling.formatTitle", { defaultValue: "Format, in this order:" })}</p>
        <p className="font-mono text-base text-foreground break-words">
          [KYC|noKYC|CJ] {t("guide.labeling.observer", { defaultValue: "observer" })} · {t("guide.labeling.platform", { defaultValue: "platform or reason" })} · {t("guide.labeling.fiat", { defaultValue: "fiat value at the time" })}
        </p>
        <p className="text-sm text-muted leading-relaxed">
          {t("guide.labeling.formatNote", { defaultValue: "The observer is whoever can link the coin to you (the counterparty, the exchange); it can differ from the platform. Every part after the prefix is optional." })}
        </p>
        <p className="text-sm text-muted break-words">
          {t("guide.labeling.example", { defaultValue: "For example:" })}{" "}
          <code className="font-mono text-foreground">{t("guide.labeling.example1", { defaultValue: "[noKYC] Juan · RoboSats purchase · 250 EUR (73,600 EUR/BTC)" })}</code>,{" "}
          <code className="font-mono text-foreground">{t("guide.labeling.example2", { defaultValue: "[KYC] Bitstamp · withdrawal · 1,000 EUR" })}</code>
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-foreground">{t("guide.labeling.prefixesTitle", { defaultValue: "Origin prefixes" })}</h3>
        <ul className="space-y-2">
          {PREFIXES.map(p => (
            <li key={p.tag} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-3 items-baseline text-sm">
              <span className="flex flex-col gap-1 items-start">
                <code className="font-mono text-foreground">{p.text}</code>
                <LabelTagChip tag={p.tag} tip={false} />
              </span>
              <span className="text-muted leading-relaxed">{t(`guide.labeling.prefix.${p.tag}`, { defaultValue: p.def })}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">{t("guide.labeling.prefixNote", { defaultValue: "Case does not matter, and the English and Spanish words are both recognized." })}</p>
        <p className="text-sm text-muted leading-relaxed">{t("guide.labeling.changeNote", { defaultValue: "Change needs no prefix: the wallet already marks it (Sparrow adds \"(change)\"), and it inherits the origin of the coins it came from." })}</p>
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
            <li key={i} id={`labeling-rule-${i + 1}`} className="text-sm text-muted leading-relaxed scroll-mt-24">{t(`guide.labeling.rule${i + 1}`, { defaultValue: r })}</li>
          ))}
        </ol>
        <p className="text-sm text-muted leading-relaxed pt-1">
          {t("guide.labeling.rulesNote", { defaultValue: "With labels loaded, the coin selection advisor warns about and ranks down plans that break rules 1, 2, 3 and 5, and leaves frozen coins out unless asked." })}
        </p>
      </div>

      <div className="space-y-2">
        <h3 id="labeling-sparrow" className="text-lg font-semibold text-foreground scroll-mt-24">{t("guide.labeling.sparrowTitle", { defaultValue: "In Sparrow" })}</h3>
        <ol className="space-y-1.5 list-decimal pl-5">
          {SPARROW.map(step => (
            <li key={step.key} className="text-sm text-muted leading-relaxed">{t(`guide.labeling.sparrow.${step.key}`, { defaultValue: step.def })}</li>
          ))}
        </ol>
        <button
          type="button"
          onClick={downloadExample}
          data-testid="labels-example"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-card-border text-sm text-foreground hover:border-bitcoin/50 hover:text-bitcoin transition-colors cursor-pointer"
        >
          <Download size={15} aria-hidden="true" />
          {t("guide.labeling.exampleDownload", { defaultValue: "Download an example labels file" })}
        </button>
        <p className="text-[13px] text-muted">{t("guide.labeling.exampleNote", { defaultValue: "A few made-up testnet records in this convention, shaped like a Sparrow export. They match no real wallet." })}</p>
      </div>
    </section>
  );
}
