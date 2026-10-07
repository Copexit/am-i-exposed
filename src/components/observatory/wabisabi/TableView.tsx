"use client";

import { useTranslation } from "react-i18next";
import { coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Scene } from "@/lib/observatory/sky-model";

const TH = "px-3 py-2.5 font-normal eyebrow whitespace-nowrap";
const TD = "px-3 py-2.5 num text-right whitespace-nowrap";

function Dot({ coordKey }: { coordKey: string }) {
  return <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: coordinatorFgVar(coordKey) }} />;
}

/** The map's facts as two plain tables: per-coordinator figures and the remix flows between them. */
export function TableView({ scene }: { scene: Scene }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const btc = (v: number) => fmtBtc(v, locale);
  const stars = [...scene.stars].sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name));
  const nameOf = new Map(scene.stars.map((s) => [s.key, s.name]));
  // Internal remix is the coordinators table's own column; this table is only flows between coordinators.
  const flows = scene.flows.filter((f) => !f.internal).sort((a, b) => b.btc - a.btc);

  const coordCols = [
    t("observatory.wabisabi.table.status", { defaultValue: "Status" }),
    t("observatory.wabisabi.table.volume", { defaultValue: "Volume (BTC)" }),
    t("observatory.wabisabi.table.coinjoins", { defaultValue: "CoinJoins" }),
    t("observatory.wabisabi.table.fresh", { defaultValue: "Fresh (BTC)" }),
    t("observatory.wabisabi.table.remixIn", { defaultValue: "Remix in (BTC)" }),
    t("observatory.wabisabi.table.remixOut", { defaultValue: "Remix out (BTC)" }),
    t("observatory.wabisabi.table.internal", { defaultValue: "Internal remix (BTC)" }),
  ];

  return (
    <div className="space-y-8">
      <div className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 pb-2 text-left text-sm font-medium text-foreground">
            {t("observatory.wabisabi.table.coordinatorsCaption", { defaultValue: "Coordinators in this period" })}
          </caption>
          <thead>
            <tr className="border-b border-hairline text-right">
              <th scope="col" className={`${TH} text-left`}>{t("observatory.wabisabi.table.coordinator", { defaultValue: "Coordinator" })}</th>
              {coordCols.map((c, i) => <th key={c} scope="col" className={`${TH} ${i === 0 ? "text-left" : ""}`}>{c}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {stars.map((s) => (
              <tr key={s.key} className={s.online ? "" : "text-muted"}>
                <th scope="row" className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><Dot coordKey={s.key} />{s.name}</span>
                </th>
                <td className="px-3 py-2.5 text-left whitespace-nowrap">
                  {s.online ? t("observatory.wabisabi.online", { defaultValue: "Online" }) : t("observatory.wabisabi.offline", { defaultValue: "Offline" })}
                </td>
                <td className={TD}>{btc(s.volume)}</td>
                <td className={TD}>{fmtCount(s.coinjoins, locale)}</td>
                <td className={TD}>{btc(s.freshBtc)}</td>
                <td className={TD}>{btc(s.remixIn)}</td>
                <td className={TD}>{btc(s.remixOut)}</td>
                <td className={TD}>{btc(s.internalRemix)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 pb-2 text-left text-sm font-medium text-foreground">
            {t("observatory.wabisabi.table.flowsCaption", { defaultValue: "Remix flows between coordinators" })}
          </caption>
          <thead>
            <tr className="border-b border-hairline text-right">
              <th scope="col" className={`${TH} text-left`}>{t("observatory.wabisabi.table.from", { defaultValue: "From" })}</th>
              <th scope="col" className={`${TH} text-left`}>{t("observatory.wabisabi.table.to", { defaultValue: "To" })}</th>
              <th scope="col" className={TH}>BTC</th>
              <th scope="col" className={TH}>{t("observatory.wabisabi.table.coins", { defaultValue: "Coins" })}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {flows.map((f) => (
              <tr key={`${f.from}>${f.to}`}>
                <th scope="row" className="px-3 py-2.5 text-left font-medium whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><Dot coordKey={f.from} />{nameOf.get(f.from) ?? f.from}</span>
                </th>
                <td className="px-3 py-2.5 text-left whitespace-nowrap">
                  <span className="inline-flex items-center gap-2"><Dot coordKey={f.to} />{nameOf.get(f.to) ?? f.to}</span>
                </td>
                <td className={TD}>{btc(f.btc)}</td>
                <td className={TD}>{fmtCount(f.coins, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {flows.length === 0 && (
          <p className="px-4 pb-4 pt-1 text-sm text-muted">
            {t("observatory.wabisabi.table.noFlows", { defaultValue: "No remix flows in this period." })}
          </p>
        )}
      </div>
    </div>
  );
}
