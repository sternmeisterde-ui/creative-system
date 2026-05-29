"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { CreativePerformance, WinnerStatus, AdFlow } from "@/lib/types";
import { parseAdName } from "@/lib/naming";
import { Card, PageHeader, Button, Badge, SectionTitle, Empty } from "@/components/ui";

const STATUS_COLOR: Record<string, string> = {
  winner: "#6EC8A0", fake_winner: "#FF8B5A", loser: "#D96B6B", testing: "#E8AA42", unknown: "#555",
};
const STATUS_LABEL: Record<string, string> = {
  winner: "Виннер", fake_winner: "Fake winner", loser: "Лузер", testing: "Тест", unknown: "—",
};
const CODE_COLOR: Record<string, string> = {
  P: "#48B8D0", H: "#C490D1", B: "#6EC8A0", A: "#FF8B5A",
};

const TARGET_CPL  = 20;
const TARGET_CPQL = 28;
const MIN_IMP     = 8000;

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `€${n.toFixed(1)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function MetricPill({ value, target }: { value: number | null; target: number }) {
  if (value == null) return <span style={{ color: "#444", fontSize: 12 }}>—</span>;
  const good = value <= target;
  const warn = value <= target * 1.3;
  return (
    <span style={{ fontSize: 12, fontWeight: 700, color: good ? "#6EC8A0" : warn ? "#E8AA42" : "#D96B6B" }}>
      €{value.toFixed(1)}
    </span>
  );
}

function CodeBadges({ adName }: { adName: string }) {
  const parts = parseAdName(adName);
  const codes = [
    parts.personaCode && { prefix: "P", code: parts.personaCode },
    parts.hookCode    && { prefix: "H", code: parts.hookCode },
    parts.bodyCode    && { prefix: "B", code: parts.bodyCode },
    parts.angleCode   && { prefix: "A", code: parts.angleCode },
  ].filter(Boolean) as { prefix: string; code: string }[];

  if (!codes.length) return <span style={{ fontSize: 11, color: "#444", fontFamily: "monospace" }}>{adName}</span>;

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
      {codes.map(({ prefix, code }) => (
        <span key={prefix} style={{
          fontFamily: "monospace", fontSize: 11, fontWeight: 700,
          color: CODE_COLOR[prefix], background: `${CODE_COLOR[prefix]}18`,
          padding: "2px 7px", borderRadius: 5,
        }}>{code}</span>
      ))}
      {parts.format && <span style={{ fontFamily: "monospace", fontSize: 11, color: "#555" }}>{parts.format}</span>}
      {parts.flow && <span style={{ fontFamily: "monospace", fontSize: 11, color: "#444" }}>{parts.flow}</span>}
    </div>
  );
}

function AdCard({ row }: { row: CreativePerformance }) {
  const status = row.autoStatus ?? "unknown";
  const isWinner = status === "winner";
  const isLoser  = status === "loser";
  const hasCpl   = row.cpl != null;

  return (
    <Card style={{
      border: isWinner
        ? "1px solid rgba(110,200,160,0.25)"
        : isLoser
        ? "1px solid rgba(217,107,107,0.15)"
        : "1px solid rgba(255,255,255,0.06)",
      opacity: isLoser ? 0.75 : 1,
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Left: codes + name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
            <Badge color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Badge>
            <Badge color={row.flow === "com" ? "#48B8D0" : "#C490D1"}>{(row.flow ?? "?").toUpperCase()}</Badge>
            <CodeBadges adName={row.adName} />
          </div>
          <div style={{ fontSize: 11, color: "#333", fontFamily: "monospace" }}>{row.adName}</div>
        </div>

        {/* Right: metrics grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, auto)", gap: "4px 18px", flexShrink: 0, textAlign: "right" }}>
          {[
            { label: "CPL",    val: <MetricPill value={row.cpl}  target={TARGET_CPL} /> },
            { label: "CPQL",   val: <MetricPill value={row.cpql} target={TARGET_CPQL} /> },
            { label: "Показы", val: <span style={{ fontSize: 12, fontWeight: 700, color: row.impressions >= MIN_IMP ? "#AAA" : "#555" }}>{row.impressions >= 1000 ? `${(row.impressions / 1000).toFixed(1)}K` : row.impressions}</span> },
            { label: "Spend",  val: <span style={{ fontSize: 12, fontWeight: 700, color: "#AAA" }}>{fmt(row.spend).replace("€", "€")}</span> },
          ].map(({ label, val }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
              {val}
            </div>
          ))}

          {hasCpl && [
            { label: "Лиды",      val: <span style={{ fontSize: 12, color: "#AAA" }}>{row.leads}</span> },
            { label: "Квал.",     val: <span style={{ fontSize: 12, color: "#AAA" }}>{row.qualLeads ?? "—"}</span> },
            { label: "CTR",       val: <span style={{ fontSize: 12, color: "#AAA" }}>{pct(row.ctr / 100)}</span> },
            { label: "CR→квал",   val: <span style={{ fontSize: 12, color: "#AAA" }}>{pct(row.crLeadToQual)}</span> },
          ].map(({ label, val }) => (
            <div key={label}>
              <div style={{ fontSize: 10, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
              {val}
            </div>
          ))}

          {!hasCpl && (
            <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#3a3a3a", marginTop: 4 }}>
              Нет PBI — загрузи данные по лидам
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function FeedbackPage() {
  const [rows, setRows] = useState<CreativePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WinnerStatus | "all">("all");
  const [flow, setFlow] = useState<AdFlow | "all">("all");

  const reload = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("creative_performance").select("*");
    if (flow !== "all") q = q.eq("flow", flow);
    const { data } = await q.order("spend", { ascending: false });
    setRows((data ?? []).map((r: Record<string, unknown>) => ({
      adId:          r.ad_id,
      adName:        r.ad_name,
      flow:          r.flow,
      spend:         r.spend,
      impressions:   r.impressions,
      clicks:        r.clicks,
      frequency:     r.frequency,
      cpm:           r.cpm,
      ctr:           r.ctr,
      cpc:           r.cpc,
      leads:         r.leads,
      qualLeads:     r.qual_leads,
      revenue:       r.revenue,
      cpl:           r.cpl,
      cpql:          r.cpql,
      crLeadToQual:  r.cr_lead_to_qual,
      crClickToLead: r.cr_click_to_lead,
      autoStatus:    r.auto_status,
      targetCpl:     r.target_cpl,
      targetCpql:    r.target_cpql,
      firstSeen:     r.first_seen,
      lastSeen:      r.last_seen,
    })) as CreativePerformance[]);
    setLoading(false);
  }, [flow]);

  useEffect(() => { reload(); }, [reload]);

  const counts = {
    total:       rows.length,
    winners:     rows.filter(r => r.autoStatus === "winner").length,
    fakeWinners: rows.filter(r => r.autoStatus === "fake_winner").length,
    losers:      rows.filter(r => r.autoStatus === "loser").length,
    testing:     rows.filter(r => r.autoStatus === "testing").length,
    unknown:     rows.filter(r => r.autoStatus === "unknown").length,
    withCpl:     rows.filter(r => r.cpl != null).length,
  };

  const avgCpl = (() => {
    const withData = rows.filter(r => r.cpl != null && r.leads > 0);
    if (!withData.length) return null;
    const totalSpend = withData.reduce((s, r) => s + r.spend, 0);
    const totalLeads = withData.reduce((s, r) => s + r.leads, 0);
    return totalLeads > 0 ? totalSpend / totalLeads : null;
  })();

  const filtered = filter === "all" ? rows : rows.filter(r => r.autoStatus === filter);

  return (
    <div>
      <PageHeader
        title="Обратная связь"
        subtitle="Результаты из Meta Ads + PBI — виннеры, лузеры, тесты"
        action={
          <div style={{ display: "flex", gap: 6 }}>
            {(["all", "com", "gov"] as const).map(f => (
              <button key={f} onClick={() => setFlow(f)} style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 11,
                fontWeight: flow === f ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
                border: flow === f ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.06)",
                background: flow === f ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
                color: flow === f ? "#E8AA42" : "#666",
              }}>
                {f === "all" ? "Все" : f.toUpperCase()}
              </button>
            ))}
            <Button onClick={reload}>↻</Button>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Объявлений",  value: String(counts.total),   color: "#E8AA42" },
          { label: "Виннеров",    value: String(counts.winners),  color: "#6EC8A0" },
          { label: "Лузеров",     value: String(counts.losers),   color: "#D96B6B" },
          { label: "Тестируется", value: String(counts.testing),  color: "#48B8D0" },
          { label: "Средний CPL", value: avgCpl != null ? `€${avgCpl.toFixed(1)}` : "—", color: avgCpl != null && avgCpl <= TARGET_CPL ? "#6EC8A0" : "#E8AA42" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Criteria hint */}
      <div style={{ fontSize: 11, color: "#444", marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span>Виннер =</span>
        <span style={{ color: "#6EC8A0" }}>CPL ≤ €{TARGET_CPL}</span>
        <span style={{ color: "#6EC8A0" }}>+ CPQL ≤ €{TARGET_CPQL}</span>
        <span style={{ color: "#6EC8A0" }}>+ ≥{MIN_IMP / 1000}K показов</span>
        <span style={{ color: "#333" }}>|</span>
        <span>С данными PBI: {counts.withCpl} из {counts.total}</span>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {([
          ["all",         `Все (${counts.total})`],
          ["winner",      `Виннеры (${counts.winners})`],
          ["fake_winner", `Fake winners (${counts.fakeWinners})`],
          ["testing",     `Тест (${counts.testing})`],
          ["loser",       `Лузеры (${counts.losers})`],
          ["unknown",     `Без данных (${counts.unknown})`],
        ] as const).map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)} style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 11,
            fontWeight: filter === val ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
            border: filter === val ? `1px solid ${STATUS_COLOR[val === "all" ? "testing" : val]}40` : "1px solid rgba(255,255,255,0.06)",
            background: filter === val ? `${STATUS_COLOR[val === "all" ? "testing" : val]}12` : "rgba(255,255,255,0.02)",
            color: filter === val ? (val === "all" ? "#E8AA42" : STATUS_COLOR[val]) : "#666",
          }}>
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div style={{ fontSize: 13, color: "#444", textAlign: "center", padding: 40 }}>Загружаем данные из Meta...</div>
      ) : filtered.length === 0 ? (
        <Empty icon="🔄" text="Нет данных. Синхронизируй Meta и загрузи PBI с лидами." />
      ) : filter !== "all" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(r => <AdCard key={r.adId} row={r} />)}
        </div>
      ) : (
        <>
          {counts.winners > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle icon="🏆" color="#6EC8A0">Виннеры ({counts.winners})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.filter(r => r.autoStatus === "winner").map(r => <AdCard key={r.adId} row={r} />)}
              </div>
            </div>
          )}
          {counts.testing > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle icon="⏳" color="#E8AA42">Тестируются ({counts.testing})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.filter(r => r.autoStatus === "testing").map(r => <AdCard key={r.adId} row={r} />)}
              </div>
            </div>
          )}
          {counts.losers > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle icon="📉" color="#D96B6B">Лузеры ({counts.losers})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.filter(r => r.autoStatus === "loser").map(r => <AdCard key={r.adId} row={r} />)}
              </div>
            </div>
          )}
          {counts.unknown > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SectionTitle icon="❓" color="#555">Без данных PBI ({counts.unknown})</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.filter(r => r.autoStatus === "unknown").map(r => <AdCard key={r.adId} row={r} />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
