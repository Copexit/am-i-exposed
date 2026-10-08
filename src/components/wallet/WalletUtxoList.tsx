"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { buildCoinInputs, groupLetters, INPUT_VB, scriptType, withHints } from "@/lib/analysis/coin-selection";
import { parseLabel, type LabelTag } from "@/lib/wallet/labels";
import { LabelTagChip, LabelText, useWalletLabels } from "./WalletLabels";
import { P2PKH_DUST_LIMIT, TXID_RE } from "@/lib/constants";
import { fmtN } from "@/lib/format";
import { useChainTip } from "@/hooks/useChainTip";
import { CopyButton } from "@/components/ui/CopyButton";
import { HintChip, REFERENCE_FEE_RATE, type Hint } from "./HintChip";
import { CoinControlBar } from "./CoinControlBar";
import { LabelsHint, NoPrefixHint } from "./LabelsHint";
import type { CoinControl } from "./useCoinControl";

/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 20;

type SortKey = "amount" | "age";

const COLS = "md:grid-cols-[3.5rem_minmax(0,1.1fr)_6.5rem_minmax(0,1fr)_8rem_minmax(0,1.4fr)_9.5rem]";
const MOBILE_FULL = "col-start-2 col-span-2 md:col-start-auto md:col-span-1";

/** Every coin of the wallet: amount, outpoint, address, age and origin hints. */
export function WalletUtxoList({ addressInfos, onScan, accountPath, control, onCompare, onImportLabels }: {
  addressInfos: WalletAddressInfo[];
  onScan: (txid: string) => void;
  /** Account derivation path (e.g. m/84'/1'/0') when known */
  accountPath?: string;
  /** Manual coin control: a checkbox per row and the selection summary */
  control?: CoinControl;
  /** "Compare with suggestions" was pressed */
  onCompare?: () => void;
  /** Open the labels import (from the no-labels hint) */
  onImportLabels?: () => void;
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
  // Label checks by outpoint (labels that disagree with the chain), for the row marker
  const checksOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of labels?.checks ?? []) for (const ref of c.refs) m.set(ref, [...(m.get(ref) ?? []), c.id]);
    return m;
  }, [labels]);

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
    const m = new Map<string, { key: string; origins: string[]; tags: LabelTag[]; who: string; rows: typeof sorted; sats: number }>();
    for (const r of sorted) {
      const l = labels.coins.get(`${r.utxo.txid}:${r.utxo.vout}`);
      const parsed = l?.text ? parseLabel(l.text) : null;
      const who = parsed?.who ?? "";
      const key = l?.origins.length ? l.origins.join("+") : who ? `:${who.toLowerCase()}` : "";
      let g = m.get(key);
      // Chips: the origin tags, or for a group by text the label's own tags
      const tags = l?.origins.length ? [...new Set(l.origins.map(o => o.split(":")[0] as LabelTag))] : parsed?.tags ?? [];
      if (!g) m.set(key, (g = { key, origins: l?.origins ?? [], tags, who, rows: [], sats: 0 }));
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
      const checked = control?.selected.has(outpoint) ?? false;
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
          aria-selected={control ? checked : undefined}
          className={`grid ${control ? "grid-cols-[3.25rem_minmax(0,1fr)_auto]" : "grid-cols-[2rem_minmax(0,1fr)_auto]"} ${COLS} gap-x-3 md:gap-x-4 gap-y-1.5 items-center px-3 py-2.5 border-t border-hairline first:border-t-0 ${checked ? "bg-bitcoin/5" : ""}`}
        >
          {control ? (
            <label role="cell" className="flex items-center gap-1.5 min-h-10 -my-2 cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={e => {
                  // Frozen by a label: selectable only after a confirmation.
                  if (e.target.checked && label?.frozen && !window.confirm(t("wallet.coinControl.frozenConfirm", { defaultValue: "This coin is frozen by its label. Select it anyway?" }))) return;
                  control.toggle(outpoint, e.target.checked);
                }}
                aria-label={t("wallet.coinControl.select", { n: r.n, amount: fmtN(value), defaultValue: "Select coin #{{n}} ({{amount}} sats)" })}
                className="size-4 accent-bitcoin cursor-pointer"
              />
              <span className="num text-[13px] text-faint">#{r.n}</span>
            </label>
          ) : (
            <span role="cell" className="num text-[13px] text-faint">#{r.n}</span>
          )}
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
            {r.hints.map(h => <HintChip key={h.kind} hint={h} />)}
          </span>
          {(label || checksOf.has(outpoint)) && (
            // The label area: origin tags from the labels, freeze, label check and text; on-chain chips stay in their column.
            <span role="cell" data-testid="utxo-label" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 min-w-0 col-start-2 col-span-2 md:col-span-6 md:col-start-2 md:order-last">
              {label?.tags.map(tag => <LabelTagChip key={tag} tag={tag} inherited={label.inherited && !(label.text && parseLabel(label.text).tags.includes(tag))} />)}
              {label?.frozen && <HintChip hint={{ kind: "frozen" }} />}
              {checksOf.has(outpoint) && (
                <span
                  data-testid="label-check-marker"
                  title={checksOf.get(outpoint)!.map(id => t(`wallet.labels.check.${id}`)).join(" ")}
                  className="text-[11px] leading-none whitespace-nowrap border border-severity-medium/30 text-severity-medium rounded px-1.5 py-1"
                >
                  {t("wallet.labels.checkMarker", { defaultValue: "Check label" })}
                </span>
              )}
              {label?.text && (
                <span className="flex items-baseline gap-2 min-w-0 max-w-full">
                  <LabelText text={label.text} />
                  {label.source === "addr" && <span className="text-[11px] text-faint shrink-0">{t("wallet.labels.fromAddress", { defaultValue: "address label" })}</span>}
                  {label.source === "tx" && <span className="text-[11px] text-faint shrink-0">{t("wallet.labels.fromTx", { defaultValue: "from transaction" })}</span>}
                </span>
              )}
            </span>
          )}
        </div>
      );
  };

  return (
    <div className="space-y-3" data-testid="utxo-list">
      {labels === null && <LabelsHint onImport={onImportLabels} />}
      {labels !== null && !labels.hasPrefixes && <NoPrefixHint />}
      {allLinked && (
        <p data-testid="utxo-all-linked" className="text-[13px] text-muted">
          {allLinked === "certain"
            ? t("wallet.utxos.allLinked", { count: rows.length, defaultValue: "All {{count}} coins are linked by this wallet's history." })
            : t("wallet.utxos.allProbablyLinked", { count: rows.length, defaultValue: "All {{count}} coins are probably linked by this wallet's history." })}
        </p>
      )}
      <LinksLegend />
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
          <span role="columnheader">{t("wallet.utxos.links", { defaultValue: "On-chain links" })}</span>
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
                        {g.tags.map(tag => <LabelTagChip key={tag} tag={tag} />)}
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

      {control && <CoinControlBar control={control} onCompare={onCompare ?? (() => {})} />}
    </div>
  );
}

/** What each on-chain link chip says, in plain words (a native disclosure, so it works at any width). */
function LinksLegend() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const items: { hint: Hint; key: string }[] = [
    { hint: { kind: "class", origin: "received" }, key: "received" },
    { hint: { kind: "class", origin: "change" }, key: "change" },
    { hint: { kind: "class", origin: "self" }, key: "self" },
    { hint: { kind: "coinjoin" }, key: "mixed" },
    { hint: { kind: "coinjoin-change" }, key: "coinjoin-change" },
    { hint: { kind: "same-tx", with: 3 }, key: "same-tx" },
    { hint: { kind: "same-address", with: 3 }, key: "same-address" },
    { hint: { kind: "group", letter: "A", inferred: false }, key: "group" },
    { hint: { kind: "group", letter: "A", inferred: true }, key: "group-inferred" },
    { hint: { kind: "reused-address" }, key: "reused-address" },
    { hint: { kind: "dust" }, key: "dust" },
  ];
  return (
    <details data-testid="links-legend" className="text-[13px]" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary className="inline-flex items-center min-h-10 text-muted hover:text-foreground cursor-pointer select-none">
        {t("wallet.utxos.legendTitle", { defaultValue: "On-chain links: what the chips mean" })}
      </summary>
      {/* Rendered only while open, so the sample chips never mix with the list's own */}
      {open && <dl className="mt-1 grid grid-cols-1 sm:grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-hairline px-3 py-3">
        {items.map(({ hint, key }) => (
          <div key={key} className="contents">
            <dt className="flex items-start"><HintChip hint={hint} /></dt>
            <dd className="text-muted leading-relaxed -mt-0.5 sm:mt-0 mb-1 sm:mb-0">{t(`wallet.utxos.legend.${key}`)}</dd>
          </div>
        ))}
      </dl>}
    </details>
  );
}
