"use client";

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNetwork } from "@/context/NetworkContext";
import { useServiceCheck } from "@/hooks/useServiceCheck";
import { fmtN, formatBtc } from "@/lib/format";
import { SATS_PER_BTC } from "@/lib/constants";
import type { CoinRef, RoundRef, TxAttribution } from "@/lib/services/wabisabi-attribution";
import { Chip } from "@/components/flows/FlowUi";

interface ServiceCheckProps {
  txids: string[];
  mode: "tx" | "wallet-like";
  totalAvailable?: number;
  isLocalCoinJoin: (txid: string) => boolean;
  onScan: (txid: string) => void;
}

type CoinjoinResult = Extract<TxAttribution, { kind: "coinjoin" }>;

const shortTx = (txid: string) => `${txid.slice(0, 8)}…${txid.slice(-8)}`;
const fmtTime = (unix: number) => new Date(unix * 1000).toLocaleString();
const fmtSats = (sats: number) => `${fmtN(sats)} sats`;
const btcToSats = (btc: number) => Math.round(btc * SATS_PER_BTC);
const btnCls =
  "inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg border border-hairline-strong text-sm text-foreground hover:border-bitcoin hover:text-bitcoin transition-colors cursor-pointer";

/** Opt-in Wabisator lookup: which WabiSabi coordinator ran a round, where coins came from or went. */
export function ServiceCheck({ txids, mode, totalAvailable, isLocalCoinJoin, onScan }: ServiceCheckProps) {
  const { t } = useTranslation();
  const { isUmbrel } = useNetwork();
  const { phase, done, total, results, summary, start, retryFailed } = useServiceCheck(txids, isLocalCoinJoin);

  const coverage = (
    <p className="text-[13px] text-muted leading-relaxed">
      {t("services.coverage", {
        defaultValue:
          "Covers the WabiSabi coordinators Wabisator monitors (Kruw, OpenCoordinator, GingerWallet and others). No record does not rule out Whirlpool, JoinMarket or unmonitored coordinators.",
      })}
    </p>
  );
  const retry = (
    <button type="button" onClick={retryFailed} className={btnCls}>
      {t("services.retry", { defaultValue: "Retry" })}
    </button>
  );

  let body: ReactNode = null;
  if (phase === "idle") {
    body = (
      <>
        <p className="text-sm text-foreground leading-relaxed">
          {t("services.desc", {
            defaultValue: "See whether this was part of a WabiSabi CoinJoin, which coordinator ran it, and where the coins came from or went.",
          })}
        </p>
        <p className="text-[13px] text-muted leading-relaxed">
          {isUmbrel
            ? t("services.privacyTor", {
                count: txids.length,
                defaultValue: "Sends {{count}} transaction ID(s) to Wabisator (wabisator.com) through Tor from your node. Nothing is stored.",
              })
            : t("services.privacyPublic", {
                count: txids.length,
                defaultValue:
                  "Sends {{count}} transaction ID(s) to Wabisator (wabisator.com) through the am-i.exposed relay. Your IP address is not shared with Wabisator. Nothing is stored.",
              })}
        </p>
        {mode === "wallet-like" && totalAvailable !== undefined && totalAvailable > txids.length && (
          <p className="text-[13px] text-muted">
            {t("services.capped", {
              count: txids.length,
              total: totalAvailable,
              defaultValue: "Checks the {{count}} most recent of {{total}} transactions.",
            })}
          </p>
        )}
        {coverage}
        <button type="button" onClick={start} className={btnCls}>
          {t("services.check", { defaultValue: "Check CoinJoin services" })}
        </button>
      </>
    );
  } else if (phase === "running") {
    body = (
      <div className="space-y-2">
        <p className="num text-sm text-muted" aria-live="polite">
          {t("services.progress", { done, total, defaultValue: "Checked {{done}} of {{total}}" })}
        </p>
        <div className="h-1.5 rounded-full bg-surface-inset overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
          <div className="h-full bg-bitcoin transition-[width]" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
      </div>
    );
  } else if (mode === "tx") {
    const r = results[0];
    if (r?.kind === "coinjoin") body = <RoundView r={r} onScan={onScan} />;
    else if (r?.kind === "linked")
      body = (
        <>
          {r.outOf.length > 0 && (
            <CoinList title={t("services.outOf", { count: r.outOf.length, defaultValue: "{{count}} coins came out of recorded CoinJoins" })} coins={r.outOf} onScan={onScan} />
          )}
          {r.into.length > 0 && (
            <CoinList title={t("services.into", { count: r.into.length, defaultValue: "{{count}} coins went into recorded CoinJoins" })} coins={r.into} onScan={onScan} />
          )}
        </>
      );
    else if (r?.kind === "error")
      body = (
        <>
          <p className="text-sm text-muted">{t("services.error", { defaultValue: "Wabisator could not be reached. Local results are unaffected." })}</p>
          {retry}
        </>
      );
    else
      body = (
        <>
          <p className="text-sm text-foreground">{t("services.none", { defaultValue: "No recorded WabiSabi CoinJoin activity for this transaction." })}</p>
          {coverage}
        </>
      );
  } else if (summary) {
    const intoSats = summary.into.reduce((a, g) => a + g.sats, 0);
    body = (
      <>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5">
          <Tile label={t("services.tileRounds", { defaultValue: "CoinJoin rounds" })} value={fmtN(summary.rounds.length)} />
          <Tile label={t("services.tileOutOf", { defaultValue: "Out of CoinJoins" })} value={fmtSats(summary.outOf.reduce((a, g) => a + g.sats, 0))}>
            {summary.outOf.map((g) => (
              <span key={g.coordinator} className="block text-[12px] text-muted truncate">
                {g.name}: <span className="num">{fmtSats(g.sats)}</span>
              </span>
            ))}
          </Tile>
          <Tile label={t("services.tileInto", { defaultValue: "Into CoinJoins" })} value={fmtSats(intoSats)} />
          <Tile label={t("services.tilePostMix", { defaultValue: "Post-mix merges" })} value={fmtN(summary.postMixMerges.length)} warn={summary.postMixMerges.length > 0} />
        </dl>
        {summary.postMixMerges.length > 0 && (
          <div className="rounded-lg border border-severity-medium/40 bg-severity-medium/10 p-4 space-y-2">
            <p className="text-sm text-foreground leading-relaxed">
              {t("services.postMixWarning", {
                count: summary.postMixMerges.length,
                defaultValue: "{{count}} transactions spent coins from different CoinJoin outputs together, which links them again.",
              })}
            </p>
            <ul className="divide-y divide-hairline">
              {summary.postMixMerges.map((m) => (
                <Row key={m.txid} txid={m.txid} onScan={onScan}>
                  <span className="num">{fmtN(m.coins)}</span>
                </Row>
              ))}
            </ul>
          </div>
        )}
        {summary.failed > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">{t("services.failedCount", { count: summary.failed, defaultValue: "{{count}} could not be checked." })}</p>
            {retry}
          </div>
        )}
      </>
    );
  }

  return (
    <section id="services" className="rounded-xl border border-hairline p-5 sm:p-6 space-y-4">
      <p className="eyebrow">{t("services.eyebrow", { defaultValue: "CoinJoin services" })}</p>
      {body}
    </section>
  );
}

function RoundView({ r, onScan }: { r: CoinjoinResult; onScan: (txid: string) => void }) {
  const { t } = useTranslation();
  const o = r.inputOrigins;
  const originTotal = o.fresh + o.remix + o.other;
  const origins = [
    { key: "fresh", label: t("services.fresh", { defaultValue: "Fresh" }), n: o.fresh, cls: "bg-bitcoin" },
    { key: "remix", label: t("services.remixed", { defaultValue: "Remixed" }), n: o.remix, cls: "bg-severity-low" },
    { key: "other", label: t("services.other", { defaultValue: "Other" }), n: o.other, cls: "bg-faint" },
  ];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{r.coordinator.name}</Chip>
        {r.time > 0 && <span className="num text-[13px] text-muted">{fmtTime(r.time)}</span>}
        {r.isBlame && (
          <span className="text-[11px] uppercase tracking-wider text-severity-medium border border-severity-medium/40 rounded px-1.5 py-1 leading-none">
            {t("services.blame", { defaultValue: "Blame round" })}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-4">
        <Tile label={t("services.feeRate", { defaultValue: "Fee rate" })} value={`${fmtN(r.feeRate)} sat/vB`} />
        <Tile label={t("services.inputs", { defaultValue: "Inputs" })} value={fmtN(r.inputs)} />
        <Tile label={t("services.outputs", { defaultValue: "Outputs" })} value={fmtN(r.outputs)} />
        <Tile label={t("services.anonsetIn", { defaultValue: "Avg. input anonset" })} value={r.anonsetIn.toFixed(1)} />
        <Tile label={t("services.anonsetOut", { defaultValue: "Avg. output anonset" })} value={r.anonsetOut.toFixed(1)} />
      </dl>
      {originTotal > 0 && (
        <div className="space-y-2">
          <div className="flex h-2 rounded-full overflow-hidden bg-surface-inset" aria-hidden="true">
            {origins.map((s) => s.n > 0 && <div key={s.key} className={s.cls} style={{ width: `${(s.n / originTotal) * 100}%` }} />)}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
            {origins.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${s.cls}`} aria-hidden="true" />
                {s.label} <span className="num text-foreground">{fmtN(s.n)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.remixFrom.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-muted">{t("services.remixFrom", { defaultValue: "Remixed from" })}</span>
          {r.remixFrom.map((g) => (
            <Chip key={g.coordinator}>
              {g.name} {formatBtc(btcToSats(g.btc))} · {fmtN(g.coins)}
            </Chip>
          ))}
        </div>
      )}
      {r.nonStandardOutputs > 0 && (
        <p className="text-[13px] text-severity-medium leading-relaxed">
          {t("services.nonStandard", {
            count: r.nonStandardOutputs,
            defaultValue: "{{count}} non-standard outputs: change outputs like these are the linkable ones.",
          })}
        </p>
      )}
      <RoundList title={t("services.remixedFromRounds", { defaultValue: "Rounds its coins came from" })} rounds={r.remixedFromRounds} onScan={onScan} />
      <RoundList title={t("services.remixedIntoRounds", { defaultValue: "Rounds its coins went into" })} rounds={r.remixedIntoRounds} onScan={onScan} />
    </>
  );
}

function Tile({ label, value, warn = false, children }: { label: string; value: string; warn?: boolean; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted">{label}</dt>
      <dd className={`num text-lg mt-1 break-words ${warn ? "text-severity-medium" : "text-foreground"}`}>{value}</dd>
      {children && <dd className="mt-1">{children}</dd>}
    </div>
  );
}

function Row({ txid, onScan, children }: { txid: string; onScan: (txid: string) => void; children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 py-1.5 text-[13px]">
      <span className="num text-foreground shrink-0">{shortTx(txid)}</span>
      <span className="flex-1 min-w-0 flex flex-wrap gap-x-3 text-muted">{children}</span>
      <button
        type="button"
        onClick={() => onScan(txid)}
        aria-label={`${t("services.scan", { defaultValue: "Scan" })} ${txid}`}
        className="shrink-0 min-h-[44px] px-2 -mr-2 text-bitcoin hover:underline underline-offset-2 cursor-pointer"
      >
        {t("services.scan", { defaultValue: "Scan" })}
      </button>
    </li>
  );
}

function RoundList({ title, rounds, onScan }: { title: string; rounds: RoundRef[]; onScan: (txid: string) => void }) {
  if (rounds.length === 0) return null;
  return (
    <details className="group border-t border-hairline pt-2">
      <summary className="min-h-[44px] flex items-center gap-2 text-sm text-foreground cursor-pointer">
        {title} <span className="num text-muted">{fmtN(rounds.length)}</span>
      </summary>
      <ul className="divide-y divide-hairline">
        {rounds.map((r) => (
          <Row key={r.txid} txid={r.txid} onScan={onScan}>
            <span>{r.name}</span>
            <span className="num">{fmtTime(r.time)}</span>
            <span className="num">{formatBtc(btcToSats(r.btc))}</span>
          </Row>
        ))}
      </ul>
    </details>
  );
}

function CoinList({ title, coins, onScan }: { title: string; coins: CoinRef[]; onScan: (txid: string) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-sm text-foreground">{title}</p>
      <ul className="divide-y divide-hairline">
        {coins.map((c) => (
          <Row key={`${c.roundTxid}:${c.index}`} txid={c.roundTxid} onScan={onScan}>
            <span>{c.name}</span>
            <span className="num">{fmtTime(c.time)}</span>
            <span className="num">{fmtSats(c.sats)}</span>
          </Row>
        ))}
      </ul>
    </div>
  );
}
