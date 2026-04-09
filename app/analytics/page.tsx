"use client";
import { useEffect, useState } from "react";
import type { ParamStat } from "@/app/api/analytics/params/route";
import type { ComboStat } from "@/app/api/analytics/combinations/route";
import type { SessionLineage } from "@/app/api/analytics/lineage/route";
import { Card, PageHeader, Button, Badge, Empty } from "@/components/ui";

const TARGET_CPL  = 20;
const TARGET_CPQL = 28;

const TYPE_COLOR: Record<string, string> = {
  persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A",
};
const TYPE_LABEL: Record<string, string> = {
  persona: "Персоны", hook: "Хуки", body: "Боди", angle: "Энглы",
};
const PAIR_LABELS: Record<string, string> = {
  "personaCode__hookCode":  "P × H",
  "personaCode__bodyCode":  "P × B",
  "personaCode__angleCode": "P × A",
  "hookCode__bodyCode":     "H × B",
  "hookCode__angleCode":    "H × A",
  "bodyCode__angleCode":    "B × A",
};

function cplColor(v: number | null) {
  if (v == null) return "#444";
  return v <= TARGET_CPL ? "#6EC8A0" : v <= TARGET_CPL * 1.3 ? "#E8AA42" : "#D96B6B";
}
function winColor(v: number | null) {
  if (v == null) return "#444";
  return v >= 0.5 ? "#6EC8A0" : v >= 0.25 ? "#E8AA42" : "#D96B6B";
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden", marginTop: 4 }}>
      <div style={{ width: `${pct * 100}%`, height: "100%", background: color, borderRadius: 2 }} />
    </div>
  );
}

// ── Tab: Параметры ────────────────────────────────────────────────────────────

interface AllStats { personas: ParamStat[]; hooks: ParamStat[]; bodies: ParamStat[]; angles: ParamStat[]; }

function ParamTable({ stats, type }: { stats: ParamStat[]; type: string }) {
  const color = TYPE_COLOR[type];
  const maxSpend = Math.max(...stats.map(s => s.spend), 1);
  if (!stats.length) return <Empty icon="📊" text="Нет данных. Синхронизируй Meta и загрузи PBI." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {["Код", "Spend", "Показы", "Лиды", "Квал.", "CPL", "CPQL", "Win%", "Объявл."].map(h => (
              <th key={h} style={{ padding: "6px 12px", textAlign: h === "Код" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map(s => (
            <tr key={s.code} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
              <td style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color, background: `${color}18`, padding: "2px 8px", borderRadius: 5 }}>{s.code}</span>
                  {s.winnerCount > 0 && <span style={{ fontSize: 10, color: "#6EC8A0" }}>{"★".repeat(Math.min(s.winnerCount, 3))}</span>}
                </div>
                <Bar value={s.spend} max={maxSpend} color={color} />
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#AAA", fontWeight: 600 }}>€{s.spend.toFixed(0)}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#666" }}>{s.impressions >= 1000 ? `${(s.impressions / 1000).toFixed(1)}K` : s.impressions}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: s.leads > 0 ? "#AAA" : "#333" }}>{s.leads || "—"}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: s.qualLeads > 0 ? "#AAA" : "#333" }}>{s.qualLeads || "—"}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(s.cpl) }}>{s.cpl != null ? `€${s.cpl.toFixed(1)}` : "—"}</td>
              <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(s.cpql) }}>{s.cpql != null ? `€${s.cpql.toFixed(1)}` : "—"}</td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                {s.winRate != null ? <span style={{ fontWeight: 700, color: winColor(s.winRate) }}>{Math.round(s.winRate * 100)}%</span> : <span style={{ color: "#333" }}>—</span>}
                {(s.winnerCount > 0 || s.loserCount > 0) && <span style={{ fontSize: 10, color: "#444", marginLeft: 4 }}>{s.winnerCount}W/{s.loserCount}L</span>}
              </td>
              <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{s.adCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Tab: Комбинации ───────────────────────────────────────────────────────────

function ComboView({ combos }: { combos: Record<string, ComboStat[]> }) {
  const [pairKey, setPairKey] = useState(Object.keys(combos)[0] ?? "");
  const current = combos[pairKey] ?? [];
  const maxSpend = Math.max(...current.map(c => c.spend), 1);

  if (!Object.keys(combos).length) return <Empty icon="🔗" text="Нет данных по комбинациям." />;

  return (
    <div>
      {/* Pair selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {Object.keys(combos).map(k => (
          <button key={k} onClick={() => setPairKey(k)} style={{
            padding: "6px 14px", borderRadius: 8, fontSize: 11,
            fontWeight: pairKey === k ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
            border: pairKey === k ? "1px solid rgba(232,170,66,0.35)" : "1px solid rgba(255,255,255,0.06)",
            background: pairKey === k ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
            color: pairKey === k ? "#E8AA42" : "#555",
          }}>
            {PAIR_LABELS[k] ?? k} <span style={{ opacity: 0.5 }}>({combos[k].length})</span>
          </button>
        ))}
      </div>

      {current.length === 0 ? (
        <Empty icon="🔗" text="Нет протестированных комбинаций для этой пары." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                {["Комбинация", "Spend", "Лиды", "Квал.", "CPL", "CPQL", "Win%", "Объявл."].map(h => (
                  <th key={h} style={{ padding: "6px 12px", textAlign: h === "Комбинация" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.map(c => {
                const colorA = TYPE_COLOR[c.typeA];
                const colorB = TYPE_COLOR[c.typeB];
                return (
                  <tr key={`${c.codeA}|${c.codeB}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px 12px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: colorA, background: `${colorA}18`, padding: "2px 7px", borderRadius: 5 }}>{c.codeA}</span>
                        <span style={{ color: "#333" }}>+</span>
                        <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: colorB, background: `${colorB}18`, padding: "2px 7px", borderRadius: 5 }}>{c.codeB}</span>
                        {c.winners > 0 && <span style={{ fontSize: 10, color: "#6EC8A0" }}>{"★".repeat(Math.min(c.winners, 3))}</span>}
                      </div>
                      <Bar value={c.spend} max={maxSpend} color={c.winners > 0 ? "#6EC8A0" : "#444"} />
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#AAA", fontWeight: 600 }}>€{c.spend.toFixed(0)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: c.leads > 0 ? "#AAA" : "#333" }}>{c.leads || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: c.qualLeads > 0 ? "#AAA" : "#333" }}>{c.qualLeads || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(c.cpl) }}>{c.cpl != null ? `€${c.cpl.toFixed(1)}` : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(c.cpql) }}>{c.cpql != null ? `€${c.cpql.toFixed(1)}` : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {c.winRate != null ? <span style={{ fontWeight: 700, color: winColor(c.winRate) }}>{Math.round(c.winRate * 100)}%</span> : <span style={{ color: "#333" }}>—</span>}
                      {(c.winners > 0 || c.losers > 0) && <span style={{ fontSize: 10, color: "#444", marginLeft: 4 }}>{c.winners}W/{c.losers}L</span>}
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{c.adCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab: История (Генеалогия) ─────────────────────────────────────────────────

const STATUS_COLOR_AD: Record<string, string> = { winner: "#6EC8A0", loser: "#D96B6B", testing: "#E8AA42", unknown: "#555" };
const STATUS_LABEL_AD: Record<string, string> = { winner: "Виннер", loser: "Лузер", testing: "Тест", unknown: "—" };
const BRIEF_COLOR: Record<string, string> = { approved: "#6EC8A0", needs_revision: "#E8AA42", pending: "#555", rejected: "#D96B6B" };

function LineageView({ sessions }: { sessions: SessionLineage[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  if (!sessions.length) return <Empty icon="🌳" text="Нет сессий. Создай первую в Конструкторе." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {sessions.map(s => {
        const isOpen = open.has(s.id);
        const publishedBriefs = s.briefs.filter(b => b.adName);
        return (
          <Card key={s.id} style={{ border: s.winners > 0 ? "1px solid rgba(110,200,160,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
            {/* Session header */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => toggle(s.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#DDD" }}>{s.name}</span>
                  {s.flow && <Badge color={s.flow === "com" ? "#48B8D0" : "#C490D1"}>{s.flow.toUpperCase()}</Badge>}
                  {s.winners > 0 && <Badge color="#6EC8A0">🏆 {s.winners} виннер{s.winners > 1 ? "а" : ""}</Badge>}
                  {s.losers > 0 && <Badge color="#D96B6B">📉 {s.losers} лузер{s.losers > 1 ? "а" : ""}</Badge>}
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#555", flexWrap: "wrap" }}>
                  <span>{new Date(s.createdAt).toLocaleDateString("ru")}</span>
                  <span>Брифов: {s.totalBriefs} → Одобрено: {s.approvedBriefs} → Опубликовано: {s.publishedAds}</span>
                  {s.totalSpend > 0 && <span>Spend: €{s.totalSpend.toFixed(0)}</span>}
                  {s.avgCpl != null && <span style={{ color: cplColor(s.avgCpl) }}>Avg CPL: €{s.avgCpl.toFixed(1)}</span>}
                </div>
              </div>
              <span style={{ fontSize: 12, color: "#444" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {/* Expanded: brief → ad → performance chain */}
            {isOpen && (
              <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
                {publishedBriefs.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#444" }}>Нет опубликованных объявлений из этой сессии.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {publishedBriefs.map(b => {
                      const p = b.performance;
                      return (
                        <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6, flexWrap: "wrap" }}>
                          {/* Brief status */}
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: BRIEF_COLOR[b.status] ?? "#555", flexShrink: 0 }} />
                          {/* Ad name */}
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "#AAA", flex: 1, minWidth: 0 }}>{b.adName}</span>
                          {/* Performance */}
                          {p ? (
                            <>
                              <Badge color={STATUS_COLOR_AD[p.autoStatus]}>{STATUS_LABEL_AD[p.autoStatus]}</Badge>
                              {p.cpl != null && <span style={{ fontSize: 11, fontWeight: 700, color: cplColor(p.cpl) }}>CPL €{p.cpl.toFixed(1)}</span>}
                              {p.cpql != null && <span style={{ fontSize: 11, color: cplColor(p.cpql) }}>CPQL €{p.cpql.toFixed(1)}</span>}
                              <span style={{ fontSize: 11, color: "#444" }}>€{p.spend.toFixed(0)}</span>
                              <span style={{ fontSize: 11, color: "#333" }}>{p.impressions >= 1000 ? `${(p.impressions / 1000).toFixed(1)}K` : p.impressions} показов</span>
                            </>
                          ) : (
                            <span style={{ fontSize: 11, color: "#333" }}>Нет данных Meta</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Unpublished approved briefs */}
                {s.briefs.filter(b => b.status === "approved" && !b.adName).length > 0 && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#444" }}>
                    + {s.briefs.filter(b => b.status === "approved" && !b.adName).length} одобренных брифов не опубликованы
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = "params" | "combos" | "lineage";

export default function AnalyticsPage() {
  const [mainTab, setMainTab]   = useState<MainTab>("params");
  const [paramTab, setParamTab] = useState<keyof AllStats>("personas");

  const [stats,    setStats]    = useState<AllStats | null>(null);
  const [combos,   setCombos]   = useState<Record<string, ComboStat[]>>({});
  const [lineage,  setLineage]  = useState<SessionLineage[]>([]);
  const [loading,  setLoading]  = useState(true);

  const reload = async () => {
    setLoading(true);
    const [paramsRes, combosRes, lineageRes] = await Promise.all([
      fetch("/api/analytics/params"),
      fetch("/api/analytics/combinations"),
      fetch("/api/analytics/lineage"),
    ]);
    if (paramsRes.ok)  { const d = await paramsRes.json();  setStats(d.stats); }
    if (combosRes.ok)  { const d = await combosRes.json();  setCombos(d.combinations ?? {}); }
    if (lineageRes.ok) { const d = await lineageRes.json(); setLineage(d.sessions ?? []); }
    setLoading(false);
  };

  useEffect(() => { reload(); }, []);

  const MAIN_TABS: { key: MainTab; label: string; icon: string }[] = [
    { key: "params",  label: "Параметры",  icon: "📊" },
    { key: "combos",  label: "Комбинации", icon: "🔗" },
    { key: "lineage", label: "История",    icon: "🌳" },
  ];

  return (
    <div>
      <PageHeader
        title="Аналитика"
        subtitle="Параметры · Комбинации · Генеалогия сессий"
        action={<Button onClick={reload}>↻ Обновить</Button>}
      />

      <div style={{ fontSize: 11, color: "#444", marginBottom: 16, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span style={{ color: "#6EC8A0" }}>Виннер: CPL ≤ €{TARGET_CPL} + CPQL ≤ €{TARGET_CPQL} + ≥8K показов</span>
        <span style={{ color: "#E8AA42" }}>Предупр.: CPL ≤ €{TARGET_CPL * 1.3}</span>
        <span style={{ color: "#D96B6B" }}>Лузер: CPL {">"} €{TARGET_CPL * 1.3}</span>
      </div>

      {/* Main tab switcher */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
        {MAIN_TABS.map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)} style={{
            padding: "8px 20px", borderRadius: 8, fontSize: 12,
            fontWeight: mainTab === t.key ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
            border: mainTab === t.key ? "1px solid rgba(232,170,66,0.35)" : "1px solid rgba(255,255,255,0.06)",
            background: mainTab === t.key ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
            color: mainTab === t.key ? "#E8AA42" : "#555",
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: 60, textAlign: "center", fontSize: 13, color: "#444" }}>Загружаем данные...</div>
      ) : (
        <>
          {/* ── Параметры ── */}
          {mainTab === "params" && (
            <>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {(Object.keys(TYPE_LABEL) as (keyof AllStats)[]).map(t => {
                  const color = TYPE_COLOR[t];
                  const cnt = stats?.[t]?.length ?? 0;
                  return (
                    <button key={t} onClick={() => setParamTab(t)} style={{
                      padding: "6px 16px", borderRadius: 8, fontSize: 11,
                      fontWeight: paramTab === t ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
                      border: paramTab === t ? `1px solid ${color}40` : "1px solid rgba(255,255,255,0.06)",
                      background: paramTab === t ? `${color}12` : "rgba(255,255,255,0.02)",
                      color: paramTab === t ? color : "#555",
                    }}>
                      {TYPE_LABEL[t]} {cnt > 0 && <span style={{ opacity: 0.6 }}>({cnt})</span>}
                    </button>
                  );
                })}
              </div>
              <Card style={{ padding: 0, overflow: "hidden" }}>
                <ParamTable stats={stats?.[paramTab] ?? []} type={paramTab} />
              </Card>
              <div style={{ marginTop: 10, fontSize: 11, color: "#444", display: "flex", gap: 16 }}>
                <span>★ = виннеры с этим кодом · Bar = spend · Win% = W/(W+L)</span>
              </div>
            </>
          )}

          {/* ── Комбинации ── */}
          {mainTab === "combos" && (
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ padding: 16 }}>
                <ComboView combos={combos} />
              </div>
            </Card>
          )}

          {/* ── История / Генеалогия ── */}
          {mainTab === "lineage" && (
            <LineageView sessions={lineage} />
          )}
        </>
      )}
    </div>
  );
}
