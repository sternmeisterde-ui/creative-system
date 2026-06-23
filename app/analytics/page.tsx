"use client";
import { useEffect, useState } from "react";
import type { ParamStat } from "@/app/api/analytics/params/route";
import type { ComboStat } from "@/app/api/analytics/combinations/route";
import type { SessionLineage } from "@/app/api/analytics/lineage/route";
import type { BivariateResult, GenealogyFamily } from "@/app/api/analytics/bivariate/route";
import type { RiskSignal } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { parseAdNameWithMapping, type AdNameMapping } from "@/lib/naming";
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
                  {s.fakeWinnerCount > 0 && <span style={{ fontSize: 10, color: "#FF8B5A" }} title={`${s.fakeWinnerCount} fake winners — прошли KPI, но имеют red flags`}>{"⚠".repeat(Math.min(s.fakeWinnerCount, 3))}</span>}
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
                {(s.winnerCount > 0 || s.fakeWinnerCount > 0 || s.loserCount > 0) && (
                  <span style={{ fontSize: 10, marginLeft: 4 }}>
                    <span style={{ color: "#6EC8A0" }}>{s.winnerCount}W</span>
                    <span style={{ color: "#444" }}>/</span>
                    <span style={{ color: "#FF8B5A" }}>{s.fakeWinnerCount}F</span>
                    <span style={{ color: "#444" }}>/</span>
                    <span style={{ color: "#D96B6B" }}>{s.loserCount}L</span>
                  </span>
                )}
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
                        {c.fakeWinners > 0 && <span style={{ fontSize: 10, color: "#FF8B5A" }} title={`${c.fakeWinners} fake winners`}>{"⚠".repeat(Math.min(c.fakeWinners, 3))}</span>}
                      </div>
                      <Bar value={c.spend} max={maxSpend} color={c.winners > 0 ? "#6EC8A0" : c.fakeWinners > 0 ? "#FF8B5A" : "#444"} />
                    </td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: "#AAA", fontWeight: 600 }}>€{c.spend.toFixed(0)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: c.leads > 0 ? "#AAA" : "#333" }}>{c.leads || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", color: c.qualLeads > 0 ? "#AAA" : "#333" }}>{c.qualLeads || "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(c.cpl) }}>{c.cpl != null ? `€${c.cpl.toFixed(1)}` : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(c.cpql) }}>{c.cpql != null ? `€${c.cpql.toFixed(1)}` : "—"}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {c.winRate != null ? <span style={{ fontWeight: 700, color: winColor(c.winRate) }}>{Math.round(c.winRate * 100)}%</span> : <span style={{ color: "#333" }}>—</span>}
                      {(c.winners > 0 || c.fakeWinners > 0 || c.losers > 0) && (
                        <span style={{ fontSize: 10, marginLeft: 4 }}>
                          <span style={{ color: "#6EC8A0" }}>{c.winners}W</span>
                          <span style={{ color: "#444" }}>/</span>
                          <span style={{ color: "#FF8B5A" }}>{c.fakeWinners}F</span>
                          <span style={{ color: "#444" }}>/</span>
                          <span style={{ color: "#D96B6B" }}>{c.losers}L</span>
                        </span>
                      )}
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

// ── Tab: Бивариативный анализ ─────────────────────────────────────────────────

const PARAM_TYPE_COLOR: Record<string, string> = {
  persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A",
  format: "#E8AA42", flow: "#888",
};
const PARAM_TYPE_LABEL: Record<string, string> = {
  persona: "Персона", hook: "Хук", body: "Боди", angle: "Энгл",
  format: "Формат", flow: "Флоу",
};
const VERDICT_COLOR: Record<string, string> = {
  HELPS: "#6EC8A0", HURTS: "#D96B6B", NEUTRAL: "#555", INSUFFICIENT: "#333",
};
const VERDICT_LABEL: Record<string, string> = {
  HELPS: "HELPS", HURTS: "HURTS", NEUTRAL: "NEUTRAL", INSUFFICIENT: "мало данных",
};
// Светофор-шкала hook rate (3-сек просмотры / показы).
function hookBand(r: number | null | undefined): { color: string; label: string } {
  if (r == null) return { color: "#333", label: "—" };
  if (r >= 45) return { color: "#48B8D0", label: "Elite" };
  if (r >= 35) return { color: "#6EC8A0", label: "Strong" };
  if (r >= 25) return { color: "#E8AA42", label: "Solid" };
  if (r >= 15) return { color: "#FF8B5A", label: "Workable" };
  return { color: "#D96B6B", label: "Fix-it" };
}

function RatioBar({ ratio }: { ratio: number | null }) {
  if (ratio == null) return <span style={{ color: "#333", fontSize: 11 }}>—</span>;
  const isHelps = ratio < 0.75;
  const isHurts = ratio > 1.33;
  const color = isHelps ? "#6EC8A0" : isHurts ? "#D96B6B" : "#666";
  const pct = Math.min(Math.abs(ratio - 1) / 1.5, 1);
  const direction = ratio < 1 ? "left" : "right";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 700, color, minWidth: 44, textAlign: "right" }}>
        {ratio.toFixed(2)}×
      </span>
      <div style={{ width: 60, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, position: "relative", overflow: "hidden" }}>
        <div style={{
          position: "absolute",
          height: "100%",
          width: `${pct * 50}%`,
          background: color,
          borderRadius: 2,
          left: direction === "left" ? `${50 - pct * 50}%` : "50%",
        }} />
        <div style={{ position: "absolute", left: "50%", top: 0, width: 1, height: "100%", background: "rgba(255,255,255,0.15)" }} />
      </div>
    </div>
  );
}

function BivariateTable({ results, filterType }: { results: BivariateResult[]; filterType: string | null }) {
  const rows = filterType ? results.filter(r => r.paramType === filterType) : results;
  if (rows.length === 0) return <Empty icon="📊" text="Нет данных. Синхронизируй Meta и сопоставь объявления." />;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            {["Признак", "Тип", "С ним (n)", "CPL (X=1)", "Без (n)", "CPL (X=0)", "Ratio", "Вердикт", "Hook% / Hold%", "Hook"].map(h => (
              <th key={h} style={{ padding: "7px 12px", textAlign: h === "Признак" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const typeColor = PARAM_TYPE_COLOR[r.paramType] ?? "#666";
            const meta = r.color ? r.color : typeColor;
            return (
              <tr key={`${r.paramType}__${r.code}`} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "9px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: meta, background: `${meta}18`, padding: "2px 8px", borderRadius: 5 }}>{r.code}</span>
                    {r.label && <span style={{ fontSize: 11, color: "#888" }}>{r.label}</span>}
                  </div>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <span style={{ fontSize: 10, color: typeColor, fontWeight: 600 }}>{PARAM_TYPE_LABEL[r.paramType]}</span>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#555", fontSize: 11 }}>{r.withCount} / {r.withLeads}л</td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: r.withCpl != null ? cplColor(r.withCpl) : "#333" }}>
                  {r.withCpl != null ? `€${r.withCpl.toFixed(1)}` : "—"}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#555", fontSize: 11 }}>{r.withoutCount} / {r.withoutLeads}л</td>
                <td style={{ padding: "9px 12px", textAlign: "right", color: "#666" }}>
                  {r.withoutCpl != null ? `€${r.withoutCpl.toFixed(1)}` : "—"}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <RatioBar ratio={r.ratio} />
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: VERDICT_COLOR[r.verdict],
                    background: `${VERDICT_COLOR[r.verdict]}14`, padding: "3px 8px", borderRadius: 4, letterSpacing: 0.5,
                  }}>{VERDICT_LABEL[r.verdict]}</span>
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right", fontSize: 11, whiteSpace: "nowrap" }}>
                  {r.withHookRate != null ? (() => { const b = hookBand(r.withHookRate); return <span title={b.label} style={{ color: b.color, fontWeight: 700 }}>{r.withHookRate.toFixed(1)}% <span style={{ fontSize: 9, opacity: 0.85 }}>{b.label}</span></span>; })() : <span style={{ color: "#333" }}>—</span>}
                  {r.withHoldRate != null && <span style={{ color: "#C490D1" }}> · hold {r.withHoldRate.toFixed(0)}%</span>}
                </td>
                <td style={{ padding: "9px 12px", textAlign: "right" }}>
                  <span title={r.hookRatio != null ? `hook ×${r.hookRatio.toFixed(2)} vs остальные` : "мало показов"} style={{
                    fontSize: 10, fontWeight: 700, color: VERDICT_COLOR[r.hookVerdict],
                    background: `${VERDICT_COLOR[r.hookVerdict]}14`, padding: "3px 8px", borderRadius: 4, letterSpacing: 0.5,
                  }}>{VERDICT_LABEL[r.hookVerdict]}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GenealogyView({ families }: { families: GenealogyFamily[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const withData = families.filter(f => f.bestCpl != null);
  if (withData.length === 0) return <Empty icon="🧬" text="Нет семей с достаточными данными." />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {withData.map(f => {
        const isOpen = open.has(f.id);
        const spread = f.bestCpl != null && f.worstCpl != null ? f.worstCpl - f.bestCpl : null;
        const sharedCodes = [f.sharedPersona, f.sharedHook, f.sharedBody, f.sharedAngle].filter(Boolean);
        const varyColor = PARAM_TYPE_COLOR[f.varyingParam];

        return (
          <Card key={f.id} style={{ border: spread && spread > 5 ? "1px solid rgba(232,170,66,0.15)" : "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => toggle(f.id)}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: "#555" }}>Варьируется:</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: varyColor }}>{PARAM_TYPE_LABEL[f.varyingParam]}</span>
                  <span style={{ fontSize: 11, color: "#333" }}>·</span>
                  <span style={{ fontSize: 11, color: "#555" }}>Общее:</span>
                  {sharedCodes.map(c => (
                    <span key={c} style={{ fontFamily: "monospace", fontSize: 10, color: "#888", background: "rgba(255,255,255,0.04)", padding: "1px 6px", borderRadius: 4 }}>{c}</span>
                  ))}
                  <span style={{ fontSize: 11, color: "#555", marginLeft: 4 }}>{f.members.length} вариант{f.members.length > 1 ? "а" : ""}</span>
                </div>
                <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#555" }}>
                  {f.bestCpl != null && <span style={{ color: "#6EC8A0" }}>Лучший CPL: €{f.bestCpl.toFixed(1)}</span>}
                  {f.worstCpl != null && <span style={{ color: "#D96B6B" }}>Худший CPL: €{f.worstCpl.toFixed(1)}</span>}
                  {spread != null && <span style={{ color: spread > 5 ? "#E8AA42" : "#444" }}>Разброс: €{spread.toFixed(1)}</span>}
                </div>
              </div>
              <span style={{ fontSize: 12, color: "#444" }}>{isOpen ? "▲" : "▼"}</span>
            </div>

            {isOpen && (
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {f.members.map(m => (
                    <div key={m.adName} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "rgba(255,255,255,0.02)", borderRadius: 6, flexWrap: "wrap" }}>
                      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: varyColor, background: `${varyColor}18`, padding: "2px 7px", borderRadius: 5 }}>{m.code}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: "#555", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.adName}</span>
                      {m.cpl != null && <span style={{ fontSize: 11, fontWeight: 700, color: cplColor(m.cpl) }}>€{m.cpl.toFixed(1)}</span>}
                      {m.cpl == null && m.leads === 0 && <span style={{ fontSize: 10, color: "#333" }}>нет лидов</span>}
                      <span style={{ fontSize: 10, color: "#444" }}>€{m.spend.toFixed(0)} спенд</span>
                      {m.autoStatus !== "unknown" && (
                        <span style={{ fontSize: 10, color: STATUS_COLOR_AD[m.autoStatus] ?? "#555" }}>
                          {STATUS_LABEL_AD[m.autoStatus] ?? m.autoStatus}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

interface BivariateData {
  totalAds: number;
  totalSpend: number;
  totalLeads: number;
  results: BivariateResult[];
  families: GenealogyFamily[];
}

function BivariateView() {
  const [data, setData] = useState<BivariateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"split" | "genealogy">("split");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/analytics/bivariate");
      const d = await res.json();
      if (!d.ok) { setError(d.error ?? "Ошибка"); return; }
      setData(d);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontSize: 13, color: "#444" }}>Вычисляем split...</div>;
  if (error) return <div style={{ fontSize: 12, color: "#D96B6B", padding: 20 }}>{error}</div>;
  if (!data) return null;

  const helps  = data.results.filter(r => r.verdict === "HELPS").length;
  const hurts  = data.results.filter(r => r.verdict === "HURTS").length;
  const neutral = data.results.filter(r => r.verdict === "NEUTRAL").length;

  const paramTypes = Array.from(new Set(data.results.map(r => r.paramType)));

  return (
    <div>
      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Признаков", value: data.results.length, color: "#48B8D0" },
          { label: "HELPS", value: helps, color: "#6EC8A0" },
          { label: "HURTS", value: hurts, color: "#D96B6B" },
          { label: "NEUTRAL", value: neutral, color: "#555" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Methodology note */}
      <div style={{ fontSize: 11, color: "#444", marginBottom: 16, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 14px", lineHeight: 1.7 }}>
        <span style={{ color: "#6EC8A0", fontWeight: 700 }}>HELPS</span> = ratio &lt; 0.75 (CPL на 25%+ ниже без этого признака) ·{" "}
        <span style={{ color: "#D96B6B", fontWeight: 700 }}>HURTS</span> = ratio &gt; 1.33 ·{" "}
        <span style={{ color: "#888" }}>blended CPL = SUM(spend)/SUM(leads) по группе · минимум 3 лида в каждой группе</span>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {([["split", "🔀 Параметрический split"], ["genealogy", "🧬 Семьи"]] as const).map(([key, label]) => (
          <button key={key} onClick={() => setSubTab(key)} style={{
            padding: "7px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            fontWeight: subTab === key ? 700 : 400,
            border: subTab === key ? "1px solid rgba(72,184,208,0.35)" : "1px solid rgba(255,255,255,0.06)",
            background: subTab === key ? "rgba(72,184,208,0.08)" : "rgba(255,255,255,0.02)",
            color: subTab === key ? "#48B8D0" : "#555",
          }}>{label}</button>
        ))}
        <div style={{ marginLeft: "auto" }}>
          <Button onClick={load} style={{ fontSize: 11 }}>↻</Button>
        </div>
      </div>

      {subTab === "split" && (
        <>
          {/* Type filter */}
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            <button onClick={() => setFilterType(null)} style={{
              padding: "5px 12px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              fontWeight: !filterType ? 700 : 400,
              border: !filterType ? "1px solid rgba(255,255,255,0.2)" : "1px solid rgba(255,255,255,0.06)",
              background: !filterType ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.02)",
              color: !filterType ? "#DDD" : "#555",
            }}>Все</button>
            {paramTypes.map(t => {
              const col = PARAM_TYPE_COLOR[t] ?? "#666";
              return (
                <button key={t} onClick={() => setFilterType(t)} style={{
                  padding: "5px 12px", borderRadius: 7, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: filterType === t ? 700 : 400,
                  border: filterType === t ? `1px solid ${col}40` : "1px solid rgba(255,255,255,0.06)",
                  background: filterType === t ? `${col}12` : "rgba(255,255,255,0.02)",
                  color: filterType === t ? col : "#555",
                }}>{PARAM_TYPE_LABEL[t]}</button>
              );
            })}
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <BivariateTable results={data.results} filterType={filterType} />
          </Card>
        </>
      )}

      {subTab === "genealogy" && (
        <GenealogyView families={data.families} />
      )}
    </div>
  );
}

// ── Tab: Status (winner / fake_winner / loser) ────────────────────────────────

type StatusKind = "winner" | "fake_winner" | "loser";

const STATUS_META: Record<StatusKind, { label: string; titlePlural: string; color: string; barColor: string; titleSpend: string; titleParams: string }> = {
  winner:      { label: "Виннеры",     titlePlural: "Winners",      color: "#6EC8A0", barColor: "#6EC8A0", titleSpend: "Spend на виннеров",     titleParams: "Топ параметров среди виннеров" },
  fake_winner: { label: "Fake winners", titlePlural: "Fake winners", color: "#FF8B5A", barColor: "#FF8B5A", titleSpend: "Spend на FW",            titleParams: "Топ параметров, сжигающих бюджет в fake winners" },
  loser:       { label: "Лузеры",       titlePlural: "Losers",       color: "#D96B6B", barColor: "#D96B6B", titleSpend: "Spend на лузеров",       titleParams: "Топ параметров среди лузеров" },
};

interface StatusRow {
  adId: string;
  adName: string;
  flow: string | null;
  spend: number;
  impressions: number;
  leads: number;
  qualLeads: number;
  cpl: number | null;
  cpql: number | null;
  crLeadToQual: number | null;
  roas: number | null;
  lifespanDays: number;
  ageDays: number;
  isActive: boolean;
  riskSignals: RiskSignal[];
}

const RISK_LABEL: Record<RiskSignal, string> = {
  low_qual_cr:    "Lead→Qual <60%",
  short_lifespan: "lifespan <7д",
  low_roas_30d:   "ROAS<1 (30+д)",
};
const RISK_COLOR: Record<RiskSignal, string> = {
  low_qual_cr:    "#C490D1",
  short_lifespan: "#E8AA42",
  low_roas_30d:   "#D96B6B",
};

function StatusView({ status }: { status: StatusKind }) {
  const meta = STATUS_META[status];
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [mapping, setMapping] = useState<AdNameMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<"all" | "com" | "gov">("all");
  const [signalFilter, setSignalFilter] = useState<RiskSignal | "all">("all");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [perfRes, mapRes] = await Promise.all([
        supabase
          .from("creative_performance")
          .select("ad_id, ad_name, flow, spend, impressions, leads, qual_leads, cpl, cpql, cr_lead_to_qual, roas, lifespan_days, age_days, is_active, risk_signals")
          .eq("auto_status", status)
          .order("spend", { ascending: false }),
        supabase.from("ad_name_mapping").select("ad_name, persona_code, hook_code, body_code, angle_code, format, flow"),
      ]);
      const data = (perfRes.data ?? []).map((r: Record<string, unknown>) => ({
        adId:          String(r.ad_id ?? ""),
        adName:        String(r.ad_name ?? ""),
        flow:          (r.flow as string | null) ?? null,
        spend:         Number(r.spend ?? 0),
        impressions:   Number(r.impressions ?? 0),
        leads:         Number(r.leads ?? 0),
        qualLeads:     Number(r.qual_leads ?? 0),
        cpl:           r.cpl as number | null,
        cpql:          r.cpql as number | null,
        crLeadToQual:  r.cr_lead_to_qual as number | null,
        roas:          r.roas as number | null,
        lifespanDays:  Number(r.lifespan_days ?? 0),
        ageDays:       Number(r.age_days ?? 0),
        isActive:      Boolean(r.is_active),
        riskSignals:   (Array.isArray(r.risk_signals) ? r.risk_signals : []) as RiskSignal[],
      }));
      setRows(data);
      setMapping((mapRes.data ?? []).map(m => ({
        adName: m.ad_name, personaCode: m.persona_code, hookCode: m.hook_code,
        bodyCode: m.body_code, angleCode: m.angle_code, format: m.format, flow: m.flow,
      })));
      setLoading(false);
    })();
  }, [status]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", fontSize: 13, color: "#444" }}>Загружаем {meta.titlePlural.toLowerCase()}...</div>;

  const filtered = rows
    .filter(r => flow === "all" || r.flow === flow)
    .filter(r => status !== "fake_winner" || signalFilter === "all" || r.riskSignals.includes(signalFilter));

  // Сводка
  const totalSpend = filtered.reduce((s, r) => s + r.spend, 0);
  const totalLeads = filtered.reduce((s, r) => s + r.leads, 0);
  const totalQuals = filtered.reduce((s, r) => s + r.qualLeads, 0);
  const sigCounts: Record<RiskSignal, number> = { low_qual_cr: 0, short_lifespan: 0, low_roas_30d: 0 };
  for (const r of filtered) for (const s of r.riskSignals) sigCounts[s]++;

  // Топ параметров среди fake_winners
  const paramCounts: Record<string, { code: string; type: string; count: number; spend: number }> = {};
  for (const r of filtered) {
    const parts = parseAdNameWithMapping(r.adName, mapping);
    for (const [code, type] of [[parts.personaCode, "persona"], [parts.hookCode, "hook"], [parts.bodyCode, "body"], [parts.angleCode, "angle"]] as const) {
      if (!code) continue;
      if (!paramCounts[code]) paramCounts[code] = { code, type, count: 0, spend: 0 };
      paramCounts[code].count++;
      paramCounts[code].spend += r.spend;
    }
  }
  const topParams = Object.values(paramCounts).sort((a, b) => b.spend - a.spend).slice(0, 10);
  const maxSpend = Math.max(...filtered.map(r => r.spend), 1);

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["all", "com", "gov"] as const).map(f => (
            <button key={f} onClick={() => setFlow(f)} style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              fontWeight: flow === f ? 700 : 400,
              border: flow === f ? "1px solid rgba(232,170,66,0.35)" : "1px solid rgba(255,255,255,0.06)",
              background: flow === f ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
              color: flow === f ? "#E8AA42" : "#555",
            }}>{f === "all" ? "Все потоки" : f.toUpperCase()}</button>
          ))}
        </div>
        {status === "fake_winner" && (
          <>
            <div style={{ width: 1, background: "rgba(255,255,255,0.06)", margin: "0 6px" }} />
            <div style={{ display: "flex", gap: 4 }}>
              {(["all", "low_qual_cr", "short_lifespan", "low_roas_30d"] as const).map(s => {
                const active = signalFilter === s;
                const col = s === "all" ? "#FF8B5A" : RISK_COLOR[s];
                return (
                  <button key={s} onClick={() => setSignalFilter(s)} style={{
                    padding: "6px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                    fontWeight: active ? 700 : 400,
                    border: active ? `1px solid ${col}55` : "1px solid rgba(255,255,255,0.06)",
                    background: active ? `${col}14` : "rgba(255,255,255,0.02)",
                    color: active ? col : "#555",
                  }}>{s === "all" ? "Все red flags" : RISK_LABEL[s]}</button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 16 }}>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: meta.color }}>{filtered.length}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{meta.titlePlural}</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#FFF" }}>€{totalSpend.toFixed(0)}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{meta.titleSpend}</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#48B8D0" }}>{totalLeads}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Лиды</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#6EC8A0" }}>{totalQuals}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Квал.лиды</div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#AAA" }}>{totalLeads > 0 ? `€${(totalSpend / totalLeads).toFixed(1)}` : "—"}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>blended CPL</div>
        </Card>
      </div>

      {/* Red flag breakdown — только для fake_winner */}
      {status === "fake_winner" && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Распределение red flags</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {(Object.keys(RISK_LABEL) as RiskSignal[]).map(s => (
              <div key={s} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
                <div style={{ fontSize: 11, color: RISK_COLOR[s], fontWeight: 700 }}>{RISK_LABEL[s]}</div>
                <div style={{ fontSize: 18, color: "#DDD", fontWeight: 700 }}>{sigCounts[s]}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Top params */}
      {topParams.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>{meta.titleParams}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {topParams.map(p => (
              <div key={p.code} style={{ padding: "6px 10px", borderRadius: 6, background: `${TYPE_COLOR[p.type]}14`, border: `1px solid ${TYPE_COLOR[p.type]}30`, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 700, color: TYPE_COLOR[p.type], fontSize: 12 }}>{p.code}</span>
                <span style={{ fontSize: 10, color: "#888" }}>€{p.spend.toFixed(0)} · {p.count}×</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
        <Empty icon="✨" text={`Нет ${meta.titlePlural.toLowerCase()} по выбранным фильтрам.`} />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {(["Объявление", "Spend", "CPL", "CPQL", "L→Q CR", "ROAS", "Возр./Lifespan", ...(status === "fake_winner" ? ["Red flags"] : [])]).map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: h === "Объявление" ? "left" : "right", fontSize: 10, fontWeight: 700, color: "#444", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const parts = parseAdNameWithMapping(r.adName, mapping);
                  return (
                    <tr key={r.adId} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: "#DDD", fontWeight: 600 }}>{r.adName}</span>
                          {r.flow && <Badge color={r.flow === "com" ? "#48B8D0" : "#C490D1"}>{r.flow.toUpperCase()}</Badge>}
                          {!r.isActive && <span style={{ fontSize: 9, color: "#666", padding: "1px 5px", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 3 }}>OFF</span>}
                        </div>
                        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                          {parts.personaCode && <span style={{ fontFamily: "monospace", fontSize: 10, color: TYPE_COLOR.persona, background: `${TYPE_COLOR.persona}18`, padding: "1px 5px", borderRadius: 3 }}>{parts.personaCode}</span>}
                          {parts.hookCode    && <span style={{ fontFamily: "monospace", fontSize: 10, color: TYPE_COLOR.hook,    background: `${TYPE_COLOR.hook}18`,    padding: "1px 5px", borderRadius: 3 }}>{parts.hookCode}</span>}
                          {parts.bodyCode    && <span style={{ fontFamily: "monospace", fontSize: 10, color: TYPE_COLOR.body,    background: `${TYPE_COLOR.body}18`,    padding: "1px 5px", borderRadius: 3 }}>{parts.bodyCode}</span>}
                          {parts.angleCode   && <span style={{ fontFamily: "monospace", fontSize: 10, color: TYPE_COLOR.angle,   background: `${TYPE_COLOR.angle}18`,   padding: "1px 5px", borderRadius: 3 }}>{parts.angleCode}</span>}
                        </div>
                        <Bar value={r.spend} max={maxSpend} color={meta.barColor} />
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#AAA", fontWeight: 600 }}>€{r.spend.toFixed(0)}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(r.cpl) }}>{r.cpl != null ? `€${r.cpl.toFixed(1)}` : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: cplColor(r.cpql) }}>{r.cpql != null ? `€${r.cpql.toFixed(1)}` : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: r.crLeadToQual != null ? (r.crLeadToQual >= 60 ? "#6EC8A0" : "#D96B6B") : "#444" }}>{r.crLeadToQual != null ? `${r.crLeadToQual.toFixed(0)}%` : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", fontWeight: 700, color: r.roas != null ? (r.roas >= 1 ? "#6EC8A0" : "#D96B6B") : "#444" }}>{r.roas != null ? r.roas.toFixed(2) : "—"}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#888", fontSize: 11 }}>{r.ageDays}д / {r.lifespanDays}д</td>
                      {status === "fake_winner" && (
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {r.riskSignals.map(s => (
                              <span key={s} style={{ fontSize: 10, fontWeight: 700, color: RISK_COLOR[s], background: `${RISK_COLOR[s]}18`, padding: "2px 6px", borderRadius: 4, whiteSpace: "nowrap" }}>{RISK_LABEL[s]}</span>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type MainTab = "params" | "combos" | "lineage" | "bivariate" | "winners" | "fake_winners" | "losers";

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
    { key: "params",       label: "Параметры",      icon: "📊" },
    { key: "combos",       label: "Комбинации",     icon: "🔗" },
    { key: "winners",      label: "Виннеры",        icon: "🟢" },
    { key: "fake_winners", label: "Fake winners",   icon: "🟠" },
    { key: "losers",       label: "Лузеры",         icon: "🔴" },
    { key: "lineage",      label: "История",        icon: "🌳" },
    { key: "bivariate",    label: "Бивариативный",  icon: "⚖️" },
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
        <span style={{ color: "#FF8B5A" }}>Fake winner: прошёл KPI, но имеет red flags</span>
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

          {/* ── Бивариативный анализ ── */}
          {mainTab === "bivariate" && (
            <BivariateView />
          )}

          {/* ── Winners / Fake winners / Losers ── */}
          {mainTab === "winners"      && <StatusView status="winner" />}
          {mainTab === "fake_winners" && <StatusView status="fake_winner" />}
          {mainTab === "losers"       && <StatusView status="loser" />}
        </>
      )}
    </div>
  );
}
