"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { buildCoinInputs, INPUT_VB, scriptType, withHints, type OriginHint } from "@/lib/analysis/coin-selection";
import { P2PKH_DUST_LIMIT, TXID_RE } from "@/lib/constants";
import { fmtN } from "@/lib/format";
import { useChainTip } from "@/hooks/useChainTip";
import { CopyButton } from "@/components/ui/CopyButton";

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 20;
/** Fee rate at which a coin is flagged as worth no more than its own input fee. */
export const REFERENCE_FEE_RATE = 20;

type SortKey = "amount" | "age";
type Hint = OriginHint | { kind: "dust" } | { kind: "uneconomical" };

const COLS = "md:grid-cols-[2.25rem_minmax(0,1.1fr)_minmax(0,1.3fr)_8rem_minmax(0,1.4fr)_9.5rem]";
const MOBILE_FULL = "col-start-2 col-span-2 md:col-start-auto md:col-span-1";

/** Every coin of the wallet: amount, outpoint, address, age and origin hints. */
export function WalletUtxoList({ addressInfos }: { addressInfos: WalletAddressInfo[] }) {
  const { t } = useTranslation();
  const tip = useChainTip();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "amount", desc: true });
  const [showAll, setShowAll] = useState(false);

  // Row numbers (#n, also used by the hints) follow the amount order and stay with the coin when re-sorted.
  const rows = useMemo(() => {
    const derived = new Map(addressInfos.map(i => [i.derived.address, i.derived]));
    const coins = buildCoinInputs(addressInfos).sort((a, b) => b.utxo.value - a.utxo.value);
    return withHints(coins).map((c, i) => {
      const hints: Hint[] = [...c.hints];
      if (c.utxo.value < P2PKH_DUST_LIMIT) hints.push({ kind: "dust" });
      else if (c.utxo.value <= INPUT_VB[scriptType(c.address)] * REFERENCE_FEE_RATE) hints.push({ kind: "uneconomical" });
      return { ...c, hints, n: i + 1, derived: derived.get(c.address) };
    });
  }, [addressInfos]);

  const sorted = useMemo(() => {
    // Older coins have a lower block height; unconfirmed ones are the newest.
    const age = (r: (typeof rows)[number]) => (r.utxo.status.confirmed && r.utxo.status.block_height ? -r.utxo.status.block_height : -Infinity);
    const by = sort.key === "amount" ? (r: (typeof rows)[number]) => r.utxo.value : age;
    return [...rows].sort((a, b) => (sort.desc ? by(b) - by(a) : by(a) - by(b)) || a.n - b.n);
  }, [rows, sort]);

  const total = rows.reduce((s, r) => s + r.utxo.value, 0);
  const visible = showAll ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const sats = t("common.sats", { defaultValue: "sats" });
  const confirmations = (count: number) => t("wallet.utxos.confirmations", { count, n: fmtN(count), defaultValue: "{{n}} confirmations" });

  const sortButton = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => setSort(s => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))}
        className={`inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[13px] transition-colors cursor-pointer ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
      >
        {label}
        {active && <Arrow size={13} aria-hidden="true" />}
      </button>
    );
  };

  return (
    <div className="space-y-3" data-testid="utxo-list">
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[13px] text-muted mr-1">{t("wallet.utxos.sortBy", { defaultValue: "Sort by" })}</span>
        {sortButton("amount", t("wallet.utxos.amount", { defaultValue: "Amount" }))}
        {sortButton("age", t("wallet.utxos.age", { defaultValue: "Age" }))}
      </div>

      <div className="rounded-lg border border-hairline divide-y divide-hairline">
        <div aria-hidden="true" className={`hidden md:grid ${COLS} gap-x-4 px-3 py-2 eyebrow`}>
          <span>#</span>
          <span>{t("wallet.utxos.coin", { defaultValue: "Coin" })}</span>
          <span>{t("wallet.utxos.address", { defaultValue: "Address" })}</span>
          <span>{t("wallet.utxos.age", { defaultValue: "Age" })}</span>
          <span>{t("wallet.utxos.origin", { defaultValue: "Origin" })}</span>
          <span className="text-right">{t("wallet.utxos.amount", { defaultValue: "Amount" })}</span>
        </div>

        <ol>
          {visible.map(r => {
            const { txid, vout, value, status } = r.utxo;
            const outpoint = `${txid}:${vout}`;
            const short = `${txid.slice(0, 8)}...${txid.slice(-4)}:${vout}`;
            const age = !status.confirmed || !status.block_height
              ? t("wallet.utxos.unconfirmed", { defaultValue: "Unconfirmed" })
              : tip
                ? confirmations(Math.max(1, tip - status.block_height + 1))
                : t("wallet.utxos.block", { height: fmtN(status.block_height), defaultValue: "Block {{height}}" });
            return (
              <li
                key={outpoint}
                data-testid="utxo-row"
                className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] ${COLS} gap-x-3 md:gap-x-4 gap-y-1.5 items-center px-3 py-2.5 border-t border-hairline first:border-t-0`}
              >
                <span className="num text-[13px] text-faint">#{r.n}</span>
                <span className="flex items-center gap-1.5 min-w-0">
                  {TXID_RE.test(txid) ? (
                    <a
                      href={`/#tx=${txid}`}
                      title={outpoint}
                      aria-label={t("wallet.utxos.scanTx", { outpoint, defaultValue: "Scan the funding transaction of {{outpoint}}" })}
                      className="num text-[12px] md:text-[13px] text-foreground truncate hover:text-bitcoin underline-offset-2 hover:underline"
                    >
                      {short}
                    </a>
                  ) : (
                    <span className="num text-[12px] md:text-[13px] text-foreground truncate" title={outpoint}>{short}</span>
                  )}
                  <CopyButton text={outpoint} variant="inline" iconSize={13} className="shrink-0 p-1.5 -m-1" />
                </span>
                <span data-testid="utxo-amount" className="num text-[13px] text-foreground text-right whitespace-nowrap col-start-3 row-start-1 md:col-start-auto md:row-start-auto md:order-last">
                  {fmtN(value)} {sats}
                </span>
                <span className={`flex items-center gap-2 min-w-0 ${MOBILE_FULL}`}>
                  {r.derived && (
                    <span className={`text-[11px] leading-none rounded px-1.5 py-1 shrink-0 ${r.derived.isChange ? "bg-surface-2 text-muted" : "bg-bitcoin/10 text-bitcoin"}`}>
                      {r.derived.isChange ? t("wallet.change_label", { defaultValue: "change" }) : t("wallet.receive_label", { defaultValue: "receive" })}
                    </span>
                  )}
                  {r.derived && <span className="num text-[12px] text-muted shrink-0">{r.derived.path}</span>}
                  <span className="num text-[12px] text-muted truncate" title={r.address}>{r.address.slice(0, 8)}...{r.address.slice(-6)}</span>
                </span>
                <span className={`text-[12px] md:text-[13px] ${status.confirmed ? "text-muted" : "text-severity-medium"} ${MOBILE_FULL}`}>{age}</span>
                <span className={`flex flex-wrap gap-1.5 empty:hidden md:empty:block ${MOBILE_FULL}`}>
                  {r.hints.map(h => <HintChip key={h.kind} hint={h} />)}
                </span>
              </li>
            );
          })}
        </ol>

        <div data-testid="utxo-total" className="flex items-baseline justify-between gap-3 px-3 py-2.5 bg-surface-2/40">
          <span className="text-[13px] text-muted">
            {t("wallet.utxos.total", { defaultValue: "Total" })}{" "}
            <span className="num">{t("flows.utxosAvailable", { count: rows.length, defaultValue: "{{count}} UTXOs" })}</span>
          </span>
          <span className="num text-[13px] font-medium text-foreground">{fmtN(total)} {sats}</span>
        </div>
      </div>

      {rows.length > COLLAPSED_ROWS && (
        <button
          type="button"
          onClick={() => setShowAll(s => !s)}
          className="text-[13px] text-bitcoin hover:text-bitcoin-hover min-h-[44px] cursor-pointer"
        >
          {showAll
            ? t("wallet.utxos.showFewer", { defaultValue: "Show fewer" })
            : t("wallet.utxos.showAll", { n: fmtN(rows.length), defaultValue: "Show all {{n}}" })}
        </button>
      )}
    </div>
  );
}

export function HintChip({ hint }: { hint: Hint }) {
  const { t } = useTranslation();
  const tone =
    hint.kind === "coinjoin" ? "text-severity-good border-severity-good/30"
    : hint.kind === "reused-address" ? "text-severity-high border-severity-high/30"
    : hint.kind === "dust" || hint.kind === "uneconomical" ? "text-severity-medium border-severity-medium/30"
    : "text-muted border-hairline-strong";
  const label =
    hint.kind === "dust" ? t("wallet.utxos.hint.dust", { defaultValue: "Dust" })
    : hint.kind === "uneconomical" ? t("wallet.utxos.hint.uneconomical", { rate: REFERENCE_FEE_RATE, defaultValue: "Uneconomical at {{rate}} sat/vB" })
    : t(`wallet.coinSel.hint.${hint.kind}`, { n: "with" in hint ? hint.with : 0 });
  return <span className={`text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 ${tone}`}>{label}</span>;
}
