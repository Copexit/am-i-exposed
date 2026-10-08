"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { buildCoinInputs, groupLetters, INPUT_VB, scriptType, withHints } from "@/lib/analysis/coin-selection";
import { parseLabel } from "@/lib/wallet/labels";
import { LabelTagChip, LabelText, useWalletLabels } from "./WalletLabels";
import { P2PKH_DUST_LIMIT, TXID_RE } from "@/lib/constants";
import { fmtN } from "@/lib/format";
import { useChainTip } from "@/hooks/useChainTip";
import { CopyButton } from "@/components/ui/CopyButton";
import { HintChip, REFERENCE_FEE_RATE, type Hint } from "./HintChip";

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 20;

type SortKey = "amount" | "age";

const COLS = "md:grid-cols-[2.25rem_minmax(0,1.1fr)_6.5rem_minmax(0,1fr)_8rem_minmax(0,1.4fr)_9.5rem]";
const MOBILE_FULL = "col-start-2 col-span-2 md:col-start-auto md:col-span-1";

/** Every coin of the wallet: amount, outpoint, address, age and origin hints. */
export function WalletUtxoList({ addressInfos, onScan, accountPath }: {
  addressInfos: WalletAddressInfo[];
  onScan: (txid: string) => void;
  /** Account derivation path (e.g. m/84'/1'/0') when known */
  accountPath?: string;
}) {
  const { t } = useTranslation();
  const tip = useChainTip();
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "amount", desc: true });
  const [showAll, setShowAll] = useState(false);

  // Row numbers (#n, also used by the hints) follow the amount order and stay with the coin when re-sorted.
  const { rows, allLinked } = useMemo(() => {
    const derived = new Map(addressInfos.map(i => [i.derived.address, i.derived]));
    const coins = buildCoinInputs(addressInfos).sort((a, b) => b.utxo.value - a.utxo.value);
    // Linkage groups (inferred clusters, wallet-clusters.ts). One group for the whole
    // wallet is said once above the list; otherwise each group of 2+ coins gets a letter,
    // with a "?" when only probably linked (it spans several certain clusters).
    const { letters, allLinked } = groupLetters(coins);
    const one = allLinked !== null;
    const linkKinds = new Set<Hint["kind"]>(["linked", "probably-linked", ...(one ? (["same-tx", "same-address"] as const) : [])]);
    const rows = withHints(coins).map((c, i) => {
      const d = derived.get(c.address);
      const hints: Hint[] = c.hints.filter(h => !linkKinds.has(h.kind));
      // Each coin shows its origin class as counted in the coin-origins bar, unless the chain chip already says it.
      if (c.origin && c.origin !== "mixed" && c.origin !== "coinjoin-change" && !(c.origin === "change" && d?.isChange)) {
        hints.unshift({ kind: "class", origin: c.origin });
      }
      const letter = letters.get(`${c.utxo.txid}:${c.utxo.vout}`);
      if (letter) hints.push({ kind: "group", ...letter });
      if (c.utxo.value < P2PKH_DUST_LIMIT) hints.push({ kind: "dust" });
      else if (c.utxo.value <= INPUT_VB[scriptType(c.address)] * REFERENCE_FEE_RATE) hints.push({ kind: "uneconomical" });
      return { ...c, hints, n: i + 1, derived: d };
    });
    return { rows, allLinked };
  }, [addressInfos]);

  const labels = useWalletLabels();
  const [byLabel, setByLabel] = useState(false);
  const labelOf = (r: (typeof rows)[number]) => labels?.coins.get(`${r.utxo.txid}:${r.utxo.vout}`);

  const sorted = useMemo(() => {
    // Older coins have a lower block height; unconfirmed ones are the newest.
    const age = (r: (typeof rows)[number]) => (r.utxo.status.confirmed && r.utxo.status.block_height ? -r.utxo.status.block_height : -Infinity);
    const by = sort.key === "amount" ? (r: (typeof rows)[number]) => r.utxo.value : age;
    return [...rows].sort((a, b) => (sort.desc ? by(b) - by(a) : by(a) - by(b)) || a.n - b.n);
  }, [rows, sort]);

  const total = rows.reduce((s, r) => s + r.utxo.value, 0);
  const grouped = byLabel && labels !== null;
  const visible = showAll || grouped ? sorted : sorted.slice(0, COLLAPSED_ROWS);

  // Group-by-label view: by origin (prefix and counterparty), else by the label's text before "·"; unlabeled last.
  const groups = useMemo(() => {
    if (!grouped) return null;
    const m = new Map<string, { key: string; origins: string[]; who: string; rows: typeof sorted; sats: number }>();
    for (const r of sorted) {
      const l = labels.coins.get(`${r.utxo.txid}:${r.utxo.vout}`);
      const who = l?.text ? parseLabel(l.text).who : "";
      const key = l?.origins.length ? l.origins.join("+") : who ? `:${who.toLowerCase()}` : "";
      let g = m.get(key);
      if (!g) m.set(key, (g = { key, origins: l?.origins ?? [], who, rows: [], sats: 0 }));
      g.rows.push(r);
      g.sats += r.utxo.value;
    }
    return [...m.values()].sort((a, b) => (a.key === "" ? 1 : 0) - (b.key === "" ? 1 : 0) || b.sats - a.sats);
  }, [grouped, sorted, labels]);
  const sats = t("common.sats", { defaultValue: "sats" });
  const pathTitle = (d: (typeof rows)[number]["derived"]) =>
    d && t("wallet.utxos.pathTitle", {
      chain: d.isChange ? t("wallet.utxos.chainChange", { defaultValue: "Change chain" }) : t("wallet.utxos.chainReceive", { defaultValue: "Receive chain" }),
      index: d.index,
      path: accountPath ? `${accountPath}/${d.path}` : d.path,
      defaultValue: "{{chain}}, index {{index}} ({{path}})",
    });
  const confirmations = (count: number) => t("wallet.utxos.confirmations", { count, n: fmtN(count), defaultValue: "{{n}} confirmations" });

  const SORT_LABEL = {
    amount: [t("wallet.utxos.sortAmountDesc", { defaultValue: "Amount, largest first" }), t("wallet.utxos.sortAmountAsc", { defaultValue: "Amount, smallest first" })],
    age: [t("wallet.utxos.sortAgeDesc", { defaultValue: "Age, oldest first" }), t("wallet.utxos.sortAgeAsc", { defaultValue: "Age, newest first" })],
  } as const;
  const sortButton = (key: SortKey, label: string) => {
    const active = sort.key === key;
    const Arrow = sort.desc ? ArrowDown : ArrowUp;
    return (
      <button
        type="button"
        aria-pressed={active}
        aria-label={active ? SORT_LABEL[key][sort.desc ? 0 : 1] : label}
        onClick={() => setSort(s => (s.key === key ? { key, desc: !s.desc } : { key, desc: true }))}
        className={`inline-flex items-center gap-1 h-10 px-3 rounded-md text-[13px] transition-colors cursor-pointer ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
      >
        {label}
        {active && <Arrow size={13} aria-hidden="true" />}
      </button>
    );
  };

  const renderRow = (r: (typeof rows)[number]) => {
      const { txid, vout, value, status } = r.utxo;
    const label = labelOf(r);
      const outpoint = `${txid}:${vout}`;
      const short = `${txid.slice(0, 8)}...${txid.slice(-4)}:${vout}`;
      const age = !status.confirmed || !status.block_height
        ? t("wallet.utxos.unconfirmed", { defaultValue: "Unconfirmed" })
        : tip
          ? confirmations(Math.max(1, tip - status.block_height + 1))
          : t("wallet.utxos.block", { height: fmtN(status.block_height), defaultValue: "Block {{height}}" });
      return (
        <div
          role="row"
          key={outpoint}
          data-testid="utxo-row"
          className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] ${COLS} gap-x-3 md:gap-x-4 gap-y-1.5 items-center px-3 py-2.5 border-t border-hairline first:border-t-0`}
        >
          <span role="cell" className="num text-[13px] text-faint">#{r.n}</span>
          <span role="cell" className="flex items-center min-w-0">
            {/* 40 px touch targets; negative margins keep the row compact. */}
            {TXID_RE.test(txid) ? (
              <button
                type="button"
                onClick={() => onScan(txid)}
                title={outpoint}
                aria-label={t("wallet.utxos.scanTx", { outpoint, defaultValue: "Scan the funding transaction of {{outpoint}}" })}
                className="num min-h-10 -my-2 min-w-0 truncate text-left text-[12px] md:text-[13px] text-foreground hover:text-bitcoin underline-offset-2 hover:underline cursor-pointer"
              >
                {short}
              </button>
            ) : (
              <span className="num text-[12px] md:text-[13px] text-foreground truncate" title={outpoint}>{short}</span>
            )}
            <CopyButton
              text={outpoint}
              label={t("wallet.utxos.copyOutpoint", { outpoint, defaultValue: "Copy {{outpoint}}" })}
              variant="inline"
              iconSize={13}
              className="shrink-0 inline-flex items-center justify-center size-10 -my-2 -mx-1.5"
            />
          </span>
          <span role="cell" data-testid="utxo-amount" className="num text-[13px] text-foreground text-right whitespace-nowrap col-start-3 row-start-1 md:col-start-auto md:row-start-auto md:order-last">
            {fmtN(value)} {sats}
          </span>
          <span role="cell" className="flex items-center gap-2 min-w-0 col-start-2 md:col-start-auto" title={pathTitle(r.derived)}>
            {r.derived && (
              <>
                <span className={`text-[11px] leading-none rounded px-1.5 py-1 shrink-0 ${r.derived.isChange ? "bg-surface-2 text-muted" : "bg-bitcoin/10 text-bitcoin"}`}>
                  {r.derived.isChange ? t("wallet.change_label", { defaultValue: "change" }) : t("wallet.receive_label", { defaultValue: "receive" })}
                </span>
                <span className="num text-[12px] text-muted shrink-0">{r.derived.path}</span>
                <span className="sr-only">{pathTitle(r.derived)}</span>
              </>
            )}
          </span>
          <span role="cell" className="flex items-center justify-end md:justify-start min-w-0 col-start-3 md:col-start-auto">
            <span className="num text-[12px] text-muted truncate" title={r.address}>{r.address.slice(0, 8)}...{r.address.slice(-6)}</span>
          </span>
          <span role="cell" className={`text-[12px] md:text-[13px] ${status.confirmed ? "text-muted" : "text-severity-medium"} ${MOBILE_FULL}`}>{age}</span>
          <span role="cell" className={`flex flex-wrap gap-1.5 empty:hidden md:empty:block ${MOBILE_FULL}`}>
            {label?.tags.map(tag => <LabelTagChip key={tag} tag={tag} inherited={label.inherited && !(label.text && parseLabel(label.text).tags.includes(tag))} />)}
            {label?.frozen && <HintChip hint={{ kind: "frozen" }} />}
            {r.hints.map(h => <HintChip key={h.kind} hint={h} />)}
          </span>
          {label?.text && (
            <span role="cell" className={`flex items-baseline gap-2 min-w-0 md:col-start-2 md:col-span-6 md:order-last ${MOBILE_FULL}`}>
              <LabelText text={label.text} />
              {label.source === "addr" && <span className="text-[11px] text-faint shrink-0">{t("wallet.labels.fromAddress", { defaultValue: "address label" })}</span>}
            </span>
          )}
        </div>
      );
  };

  return (
    <div className="space-y-3" data-testid="utxo-list">
      {allLinked && (
        <p data-testid="utxo-all-linked" className="text-[13px] text-muted">
          {allLinked === "certain"
            ? t("wallet.utxos.allLinked", { count: rows.length, defaultValue: "All {{count}} coins are linked by this wallet's history." })
            : t("wallet.utxos.allProbablyLinked", { count: rows.length, defaultValue: "All {{count}} coins are probably linked by this wallet's history." })}
        </p>
      )}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[13px] text-muted mr-1">{t("wallet.utxos.sortBy", { defaultValue: "Sort by" })}</span>
        {sortButton("amount", t("wallet.utxos.amount", { defaultValue: "Amount" }))}
        {sortButton("age", t("wallet.utxos.age", { defaultValue: "Age" }))}
        {labels && (
          <button
            type="button"
            aria-pressed={byLabel}
            onClick={() => setByLabel(b => !b)}
            className={`inline-flex items-center h-10 px-3 rounded-md text-[13px] transition-colors cursor-pointer ${byLabel ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {t("wallet.labels.groupBy", { defaultValue: "Group by label" })}
          </button>
        )}
      </div>

      <div className="rounded-lg border border-hairline divide-y divide-hairline">
        <div role="table" aria-label={t("wallet.utxos.title", { defaultValue: "Coins (UTXOs)" })}>
        {/* Column labels: visible from md, read by screen readers at every width. Same DOM order as the cells. */}
        <div role="row" className={`max-md:sr-only grid ${COLS} gap-x-4 px-3 py-2 eyebrow border-b border-hairline`}>
          <span role="columnheader">#</span>
          <span role="columnheader">{t("wallet.utxos.coin", { defaultValue: "Coin" })}</span>
          <span role="columnheader" className="text-right md:order-last">{t("wallet.utxos.amount", { defaultValue: "Amount" })}</span>
          <span role="columnheader" title={t("wallet.utxos.pathHeaderTitle", { defaultValue: "Derivation path: chain (0 receive, 1 change) and index" })}>
            {t("wallet.utxos.path", { defaultValue: "Path" })}
          </span>
          <span role="columnheader">{t("wallet.utxos.address", { defaultValue: "Address" })}</span>
          <span role="columnheader">{t("wallet.utxos.age", { defaultValue: "Age" })}</span>
          <span role="columnheader">{t("wallet.utxos.origin", { defaultValue: "Origin" })}</span>
        </div>

        <div role="rowgroup">
          {groups
            ? groups.map(g => (
              <div key={g.key} data-testid="utxo-label-group">
                <div role="row" className="flex items-center gap-2 flex-wrap px-3 py-2 bg-surface-2/50 border-t border-hairline first:border-t-0">
                  <span role="cell" className="flex items-center gap-1.5 flex-wrap min-w-0 flex-1">
                    {g.key === ""
                      ? <span className="text-[13px] text-muted">{t("wallet.labels.unlabeled", { defaultValue: "No label" })}</span>
                      : <>
                        {[...new Set(g.origins.map(o => o.split(":")[0]!))].map(tag => <LabelTagChip key={tag} tag={tag as Parameters<typeof LabelTagChip>[0]["tag"]} />)}
                        <span className="text-[13px] font-medium text-foreground truncate">{(g.origins[0] && labels?.originNames.get(g.origins[0])) || g.who}</span>
                      </>}
                  </span>
                  <span role="cell" className="num text-[12px] text-muted whitespace-nowrap">
                    {t("flows.utxosAvailable", { count: g.rows.length, defaultValue: "{{count}} UTXOs" })} · {fmtN(g.sats)} {sats}
                  </span>
                </div>
                {g.rows.map(renderRow)}
              </div>
            ))
            : visible.map(renderRow)}
        </div>
        </div>

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
