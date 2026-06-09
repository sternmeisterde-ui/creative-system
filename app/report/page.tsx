"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, PageHeader, Button, Badge, Stat, SectionTitle, Empty } from "@/components/ui";
import { personaStore, hookStore, bodyStore, angleStore } from "@/lib/store";
import type { AnalysisReport, ReportSignal, ReportFamily, ReportCombo, ReportCompetitor } from "@/lib/types";

// Метаданные параметра для тултипа на коде (P/H/B/A)
type ParamInfo = { type: string; typeLabel: string; name: string; description?: string };
const TYPE_LABEL: Record<string, string> = { persona: "Персона", hook: "Хук", body: "Боди", angle: "Энгл" };

// React Flow — только на клиенте (обращается к window)
const LineageGraph = dynamic(() => import("@/components/LineageGraph"), { ssr: false });

const PARAM_COLOR: Record<string, string> = {
  persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A", format: "#E8AA42", flow: "#888",
};
const HEALTH = {
  healthy: { c: "#6EC8A0", t: "здоров" }, warning: { c: "#FF8B5A", t: "тревога" },
  dying: { c: "#D96B6B", t: "выгорает" }, unknown: { c: "#888", t: "нет данных" },
} as const;

const cplColor = (v: number | null) => v == null ? "#666" : v <= 20 ? "#6EC8A0" : v <= 26 ? "#FF8B5A" : "#D96B6B";
const eur = (v: number | null | undefined) => v == null ? "—" : `€${v.toFixed(1)}`;

// Код параметра с тултипом (наведение → тип, название, описание).
function CodeTag({ code, info, color }: { code: string; info?: ParamInfo; color?: string }) {
  const [hover, setHover] = useState(false);
  const c = color ?? (info ? PARAM_COLOR[info.type] : undefined) ?? "#CCC";
  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span style={{ fontFamily: "monospace", fontWeight: 700, color: c, fontSize: 12, cursor: info ? "help" : "default", borderBottom: info ? "1px dotted rgba(255,255,255,0.3)" : "none" }}>{code}</span>
      {hover && info && (
        <span style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 100, width: 240, padding: "9px 11px", background: "#14161C", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 8, boxShadow: "0 8px 28px rgba(0,0,0,0.55)", whiteSpace: "normal", textAlign: "left", pointerEvents: "none" }}>
          <span style={{ display: "block", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: PARAM_COLOR[info.type] ?? "#888", marginBottom: 3 }}>{info.typeLabel} · {code}</span>
          <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#EEE", marginBottom: info.description ? 4 : 0 }}>{info.name}</span>
          {info.description && <span style={{ display: "block", fontSize: 11, color: "#AAA", lineHeight: 1.5 }}>{info.description}</span>}
        </span>
      )}
    </span>
  );
}

// Минимальный markdown-рендер (как в /analyze)
function MarkdownBlock({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.9 }}>
      {text.split("\n").map((line, i) => {
        if (line.startsWith("### ") || line.startsWith("## ")) {
          return <div key={i} style={{ fontWeight: 700, color: "#48B8D0", fontSize: 13, marginTop: 18, marginBottom: 4 }}>{line.replace(/^#+\s*/, "")}</div>;
        }
        if (/^\*\*.*\*\*$/.test(line.trim())) {
          return <div key={i} style={{ fontWeight: 700, color: "#E8AA42", marginTop: 12, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          const parts = line.slice(2).split(/\*\*(.*?)\*\*/g);
          return <div key={i} style={{ paddingLeft: 16, color: "#BBB" }}>• {parts.map((p, j) => j % 2 === 1 ? <strong key={j} style={{ color: "#EEE" }}>{p}</strong> : p)}</div>;
        }
        if (line.trim() === "" || line.trim() === "---") return <div key={i} style={{ height: 8 }} />;
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return <div key={i} style={{ color: "#CCC" }}>{parts.map((p, j) => j % 2 === 1 ? <strong key={j} style={{ color: "#EEE" }}>{p}</strong> : p)}</div>;
      })}
    </div>
  );
}

function Chip({ s, helps, paramInfo }: { s: ReportSignal; helps: boolean; paramInfo: Record<string, ParamInfo> }) {
  const c = PARAM_COLOR[s.paramType] ?? "#888";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 8, background: `${helps ? "#6EC8A0" : "#D96B6B"}14`, border: `1px solid ${helps ? "#6EC8A0" : "#D96B6B"}30` }}>
      <CodeTag code={s.code} info={paramInfo[s.code]} color={c} />
      <span style={{ fontSize: 11, color: "#999", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
      <span style={{ fontSize: 10, color: helps ? "#6EC8A0" : "#D96B6B", fontWeight: 700 }}>×{s.ratio?.toFixed(2) ?? "—"}</span>
    </span>
  );
}

export default function ReportPage() {
  const [view, setView] = useState<"report" | "graph">("report");
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [history, setHistory] = useState<{ id: string; created_at: string; flow: string; kpi: AnalysisReport["kpi"] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paramInfo, setParamInfo] = useState<Record<string, ParamInfo>>({});

  // Метаданные параметров (P/H/B/A) для тултипов на кодах — грузим один раз.
  useEffect(() => {
    (async () => {
      try {
        const [ps, hs, bs, as] = await Promise.all([
          personaStore.getAll(), hookStore.getAll(), bodyStore.getAll(), angleStore.getAll(),
        ]);
        const m: Record<string, ParamInfo> = {};
        const add = (arr: { code?: string; name: string; description?: string }[], type: string) => {
          for (const x of arr) if (x.code) m[x.code] = { type, typeLabel: TYPE_LABEL[type], name: x.name, description: x.description };
        };
        add(ps, "persona"); add(hs, "hook"); add(bs, "body"); add(as, "angle");
        setParamInfo(m);
      } catch { /* тултипы просто не покажутся */ }
    })();
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const r = await fetch(`/api/analytics/report?flow=all`);
      const d = await r.json();
      setReport(d.latest ?? null);
      setHistory(d.history ?? []);
    } catch { /* пусто — покажем empty */ }
  }, []);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const generate = async () => {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/analytics/report", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ flow: "all" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Ошибка генерации");
      setReport(d.report);
      await loadLatest();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  const loadSnapshot = async (id: string) => {
    const r = await fetch(`/api/analytics/report?id=${id}`);
    const d = await r.json();
    if (d.latest) setReport(d.latest);
  };

  const kpi = report?.kpi;
  const visual = report?.visual;
  const h = HEALTH[kpi?.packHealth ?? "unknown"];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        title="🧠 Отчёт по массиву"
        subtitle="Единый анализ всех креативов: визуальная сводка + разбор → рекомендации к производству (55/25/20)"
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ display: "flex", gap: 4 }}>
              <Button size="sm" variant={view === "report" ? "primary" : "ghost"} onClick={() => setView("report")}>📊 Отчёт</Button>
              <Button size="sm" variant={view === "graph" ? "primary" : "ghost"} onClick={() => setView("graph")}>🗺 Схема</Button>
            </div>
            {view === "report" && (
              <Button variant="primary" onClick={generate} disabled={loading}>
                {loading ? "⏳ Анализирую…" : "✨ Сгенерировать отчёт"}
              </Button>
            )}
          </div>
        }
      />

      {view === "graph" && (
        <Card style={{ padding: 0 }}>
          <div style={{ padding: "16px 20px 0" }}>
            <SectionTitle icon="🗺" color="#C490D1">Виннеры → новые креативы</SectionTitle>
            <p style={{ fontSize: 12, color: "#666", marginTop: -8, marginBottom: 12 }}>
              Актуальные крео за последние 90 дней (весь массив, с кодами P/H/B/A). Виннеры → предлагаемый креатив (замена 1 параметра на HELPS-код). Лузеры (слева) — что не повторять. Узлы можно таскать, колесо — зум.
            </p>
          </div>
          <LineageGraph />
        </Card>
      )}

      {error && <Card style={{ marginBottom: 16, borderColor: "#D96B6B40" }}><span style={{ color: "#D96B6B", fontSize: 13 }}>{error}</span></Card>}

      {view === "report" && !report && !loading && (
        <Card><Empty icon="🧠" text="Отчёта ещё нет. Нажми «Сгенерировать отчёт» — система соберёт виннеров, бивариат, семьи и конкурентов в единый разбор." /></Card>
      )}

      {view === "report" && report && kpi && visual && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* KPI */}
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <Badge color={h.c}>пакет: {h.t}</Badge>
              <span style={{ fontSize: 11, color: "#555" }}>сгенерирован {new Date(report.createdAt).toLocaleString("ru-RU")}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 12 }}>
              <Stat label="виннеры" value={kpi.winners} color="#6EC8A0" />
              <Stat label="fake" value={kpi.fakeWinners} color="#FF8B5A" />
              <Stat label="лузеры" value={kpi.losers} color="#D96B6B" />
              <Stat label="в тесте" value={kpi.testing} color="#888" />
              <Stat label="blended CPL" value={eur(kpi.blendedCpl)} color={cplColor(kpi.blendedCpl)} />
              <Stat label="blended CPQL" value={eur(kpi.blendedCpql)} color={cplColor(kpi.blendedCpql)} />
              <Stat label="спенд" value={`€${kpi.totalSpend.toFixed(0)}`} color="#E2E0DB" />
            </div>
          </Card>

          {/* HELPS / HURTS */}
          <Card>
            <SectionTitle icon="🎯" color="#6EC8A0">Сигналы по массиву (бивариат)</SectionTitle>
            <div style={{ fontSize: 11, color: "#6EC8A0", marginBottom: 8, fontWeight: 700 }}>HELPS — снижают CPL</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
              {visual.helps.length ? visual.helps.map(s => <Chip key={s.code} s={s} helps paramInfo={paramInfo} />) : <span style={{ color: "#555", fontSize: 12 }}>—</span>}
            </div>
            <div style={{ fontSize: 11, color: "#D96B6B", marginBottom: 8, fontWeight: 700 }}>HURTS — повышают CPL</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {visual.hurts.length ? visual.hurts.map(s => <Chip key={s.code} s={s} helps={false} paramInfo={paramInfo} />) : <span style={{ color: "#555", fontSize: 12 }}>—</span>}
            </div>
          </Card>

          {/* Семьи + комбо */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <Card>
              <SectionTitle icon="🧬" color="#48B8D0">Семьи (1 свап решает)</SectionTitle>
              {visual.families.length ? visual.families.map((f: ReportFamily, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < visual.families.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", fontSize: 12 }}>
                  <span style={{ color: "#AAA" }}><b style={{ color: PARAM_COLOR[f.varyingParam] ?? "#888" }}>{f.varyingParam}</b> @ {f.shared.split(" ").filter(Boolean).map((cd, j, arr) => <span key={j}><CodeTag code={cd} info={paramInfo[cd]} />{j < arr.length - 1 ? " " : ""}</span>)}</span>
                  <span><span style={{ color: "#6EC8A0" }}>{eur(f.bestCpl)}</span> ↔ <span style={{ color: "#D96B6B" }}>{eur(f.worstCpl)}</span></span>
                </div>
              )) : <Empty text="Семей недостаточно" />}
            </Card>
            <Card>
              <SectionTitle icon="🔗" color="#C490D1">Топ-комбо (виннеры)</SectionTitle>
              {visual.combos.length ? visual.combos.map((c: ReportCombo, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: i < visual.combos.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none", fontSize: 12 }}>
                  <span style={{ fontFamily: "monospace", color: "#CCC" }}>{c.codes.split(" + ").map((cd, j, arr) => <span key={j}><CodeTag code={cd} info={paramInfo[cd]} />{j < arr.length - 1 ? " + " : ""}</span>)}</span>
                  <span><Badge color="#6EC8A0">{c.winners}W</Badge> <span style={{ color: cplColor(c.cpl), marginLeft: 6 }}>{eur(c.cpl)}</span></span>
                </div>
              )) : <Empty text="Виннер-комбо нет" />}
            </Card>
          </div>

          {/* Конкуренты */}
          {visual.competitors.length > 0 && (
            <Card>
              <SectionTitle icon="🧩" color="#FF8B5A">Конкуренты (одобренные)</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visual.competitors.map((c: ReportCompetitor, i) => (
                  <div key={i} style={{ fontSize: 12, color: "#BBB" }}>
                    {c.type && <Badge color="#FF8B5A">{c.type}</Badge>} <b style={{ color: "#DDD" }}>{c.title}</b>
                    {c.hook && <span style={{ color: "#888" }}> — {c.hook}</span>}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Нарратив */}
          <Card>
            <SectionTitle icon="📝" color="#E8AA42">Разбор и рекомендации</SectionTitle>
            <MarkdownBlock text={report.narrative} />
          </Card>

          {/* История */}
          {history.length > 1 && (
            <Card>
              <SectionTitle icon="🕘" color="#888">История отчётов</SectionTitle>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {history.map(snap => (
                  <Button key={snap.id} size="sm" variant={snap.id === report.id ? "primary" : "ghost"} onClick={() => loadSnapshot(snap.id)}>
                    {snap.flow.toUpperCase()} · {new Date(snap.created_at).toLocaleDateString("ru-RU")} {new Date(snap.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </Button>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
