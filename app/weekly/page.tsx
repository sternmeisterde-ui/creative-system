"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, PageHeader, Button, Badge, SectionTitle, Stat } from "@/components/ui";
import type { WeeklyCreativeRow, WeeklyReport, WeeklyReportSummary } from "@/app/api/analytics/weekly/route";
import type { CreativeParams } from "@/lib/gemini";

// ── Каноничная шкала hook rate (как на /panel) ──
const HOOK_BANDS = [
  { min: 45, color: "#48B8D0", label: "Elite" },
  { min: 35, color: "#6EC8A0", label: "Strong" },
  { min: 25, color: "#E8AA42", label: "Solid" },
  { min: 15, color: "#FF8B5A", label: "Workable" },
  { min: 0,  color: "#D96B6B", label: "Fix-it" },
];
function hookBand(r: number | null | undefined) {
  if (r == null) return { color: "#444", label: "—" };
  return HOOK_BANDS.find(b => r >= b.min) ?? HOOK_BANDS[HOOK_BANDS.length - 1];
}

const STATUS: Record<WeeklyCreativeRow["status"], { color: string; label: string }> = {
  winner:  { color: "#6EC8A0", label: "Winner" },
  loser:   { color: "#D96B6B", label: "Loser" },
  testing: { color: "#E8AA42", label: "Testing" },
};

const fmt = (n: number | null | undefined, d = 2) =>
  n == null ? "—" : n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const int = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("de-DE"));
const nk = (s: string) => (s ?? "").trim().toLowerCase();

// Понедельник–воскресенье прошлой недели
function prevWeek(): { start: string; end: string } {
  const now = new Date();
  const diffToMon = (now.getDay() + 6) % 7;
  const thisMon = new Date(now); thisMon.setDate(now.getDate() - diffToMon);
  const prevMon = new Date(thisMon); prevMon.setDate(thisMon.getDate() - 7);
  const prevSun = new Date(prevMon); prevSun.setDate(prevMon.getDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(prevMon), end: iso(prevSun) };
}

interface NoteState { note: string; aiNote: string; todo: string; }

export default function WeeklyPage() {
  const def = prevWeek();
  const [weekStart, setWeekStart] = useState(def.start);
  const [weekEnd, setWeekEnd]     = useState(def.end);
  const [reports, setReports]     = useState<WeeklyReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [report, setReport]       = useState<WeeklyReport | null>(null);
  const [notes, setNotes]         = useState<Record<string, NoteState>>({});
  const [params, setParams]       = useState<Record<string, CreativeParams>>({});
  const [paramsBusy, setParamsBusy] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [summaryNote, setSummaryNote] = useState("");
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [building, setBuilding]   = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/analytics/weekly");
    const j = await r.json();
    if (j.reports) setReports(j.reports);
    return j.reports as WeeklyReportSummary[] | undefined;
  }, []);

  const loadParams = useCallback(async (names: string[]) => {
    if (!names.length) { setParams({}); return; }
    const q = encodeURIComponent(names.join("|"));
    const r = await fetch(`/api/gemini/params?adNames=${q}`);
    const j = await r.json();
    setParams(j.params ?? {});
  }, []);

  const loadReport = useCallback(async (id: string) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/analytics/weekly?id=${id}`);
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      setReport(j.report);
      const map: Record<string, NoteState> = {};
      for (const n of (j.notes ?? [])) map[n.ad_id] = { note: n.note ?? "", aiNote: n.ai_note ?? "", todo: n.todo ?? "" };
      setNotes(map);
      setSelectedId(id);
      setSummaryNote(j.report.summaryNote ?? "");
      loadParams((j.report.rows as WeeklyCreativeRow[]).map(x => x.adName));
    } finally { setLoading(false); }
  }, [loadParams]);

  useEffect(() => { loadList().then(list => { if (list?.length) loadReport(list[0].id); }); }, [loadList, loadReport]);

  async function build() {
    setBuilding(true); setError(null);
    try {
      const r = await fetch("/api/analytics/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart, weekEnd }),
      });
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      await loadList();
      setReport(j.report); setNotes({}); setSelectedId(j.report.id);
      setSummaryNote(j.report.summaryNote ?? "");
      loadParams((j.report.rows as WeeklyCreativeRow[]).map(x => x.adName));
    } finally { setBuilding(false); }
  }

  async function genSummary() {
    if (!selectedId) return;
    setSummaryBusy(true); setError(null);
    try {
      const r = await fetch("/api/analytics/weekly/summary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: selectedId, generate: true }),
      });
      const j = await r.json();
      if (j.error) { setError(j.error); return; }
      setReport(prev => prev ? { ...prev, summary: j.summary } : prev);
    } finally { setSummaryBusy(false); }
  }
  async function saveSummaryNote() {
    if (!selectedId) return;
    await fetch("/api/analytics/weekly/summary", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: selectedId, note: summaryNote }),
    });
  }

  async function genParams(adName: string) {
    setParamsBusy(prev => new Set(prev).add(nk(adName)));
    try {
      const r = await fetch("/api/gemini/params", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adName }),
      });
      const j = await r.json();
      if (j.params) setParams(prev => ({ ...prev, [nk(adName)]: j.params }));
      else if (j.error) setError(`${adName}: ${j.error}`);
    } finally {
      setParamsBusy(prev => { const s = new Set(prev); s.delete(nk(adName)); return s; });
    }
  }

  async function genAllParams() {
    if (!report) return;
    setBulkRunning(true); setError(null);
    try {
      for (const row of report.rows) {
        if (params[nk(row.adName)]) continue;
        await genParams(row.adName);   // последовательно — видео тяжёлые
      }
    } finally { setBulkRunning(false); }
  }

  function setNote(adId: string, note: string) {
    setNotes(prev => ({ ...prev, [adId]: { note, aiNote: prev[adId]?.aiNote ?? "", todo: prev[adId]?.todo ?? "" } }));
  }
  async function saveNote(adId: string) {
    if (!selectedId) return;
    await fetch("/api/analytics/weekly/note", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: selectedId, adId, note: notes[adId]?.note ?? "" }),
    });
  }
  function setTodo(adId: string, todo: string) {
    setNotes(prev => ({ ...prev, [adId]: { note: prev[adId]?.note ?? "", aiNote: prev[adId]?.aiNote ?? "", todo } }));
  }
  async function saveTodo(adId: string) {
    if (!selectedId) return;
    await fetch("/api/analytics/weekly/note", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: selectedId, adId, todo: notes[adId]?.todo ?? "" }),
    });
  }
  async function genAI(adId: string) {
    if (!selectedId) return;
    setNotes(prev => ({ ...prev, [adId]: { note: prev[adId]?.note ?? "", aiNote: "…генерирую", todo: prev[adId]?.todo ?? "" } }));
    const r = await fetch("/api/analytics/weekly/note", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId: selectedId, adId, generate: true }),
    });
    const j = await r.json();
    if (j.error) { setError(j.error); setNotes(prev => ({ ...prev, [adId]: { note: prev[adId]?.note ?? "", aiNote: "", todo: prev[adId]?.todo ?? "" } })); return; }
    setNotes(prev => ({ ...prev, [adId]: { note: j.note ?? prev[adId]?.note ?? "", aiNote: j.aiNote ?? "", todo: prev[adId]?.todo ?? "" } }));
  }

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: "0 auto" }}>
      <PageHeader
        title="Субъективный анализ крео"
        subtitle="Понедельный срез по всем крео + человеческая/AI оценка"
      />

      {/* Контролы сборки */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Начало недели (пн)"><input type="date" value={weekStart} onChange={e => setWeekStart(e.target.value)} style={inputStyle} /></Field>
          <Field label="Конец недели (вс)"><input type="date" value={weekEnd} onChange={e => setWeekEnd(e.target.value)} style={inputStyle} /></Field>
          <Button variant="primary" onClick={build} disabled={building}>{building ? "Собираю…" : "📥 Собрать неделю"}</Button>
          {reports.length > 0 && (
            <Field label="История">
              <select value={selectedId ?? ""} onChange={e => loadReport(e.target.value)} style={inputStyle}>
                {reports.map(r => <option key={r.id} value={r.id}>{r.label} · {r.adCount} крео</option>)}
              </select>
            </Field>
          )}
          {report && (() => {
            const missing = report.rows.filter(r => !params[nk(r.adName)]).length;
            return (
              <Button onClick={genAllParams} disabled={bulkRunning || missing === 0}>
                {bulkRunning ? `Разбираю… (${paramsBusy.size})` : missing === 0 ? "🧩 Параметры разобраны" : `🧩 Разобрать параметры (${missing})`}
              </Button>
            );
          })()}
        </div>
        {error && <div style={{ color: "#D96B6B", fontSize: 12, marginTop: 12 }}>⚠️ {error}</div>}
      </Card>

      {/* Легенда hook rate */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#666" }}>Hook rate (3-сек / показы):</span>
        {[...HOOK_BANDS].reverse().map(b => (
          <span key={b.label} style={{ fontSize: 11, color: b.color, border: `1px solid ${b.color}55`, borderRadius: 6, padding: "2px 8px" }}>
            {b.label} {b.min === 0 ? "<15%" : b.min === 45 ? "≥45%" : `${b.min}–${(HOOK_BANDS[HOOK_BANDS.indexOf(b) - 1]?.min ?? b.min)}%`}
          </span>
        ))}
      </div>

      {loading && <div style={{ color: "#666" }}>Загрузка…</div>}
      {!loading && report && report.rows.length === 0 && (
        <Card><div style={{ color: "#666", textAlign: "center", padding: 20 }}>Нет крео за это окно</div></Card>
      )}
      {!loading && !report && <Card><div style={{ color: "#666", textAlign: "center", padding: 20 }}>Соберите первую неделю ↑</div></Card>}

      {!loading && report && report.rows.length > 0 && (
        <WeekSummary
          report={report}
          note={summaryNote}
          busy={summaryBusy}
          onGenerate={genSummary}
          onNoteChange={setSummaryNote}
          onNoteSave={saveSummaryNote}
          todos={report.rows.map(r => ({ adName: r.adName, todo: notes[r.adId]?.todo ?? "" })).filter(t => t.todo.trim())}
        />
      )}

      {!loading && report?.rows.map(row => (
        <CreativeCard
          key={row.adId}
          row={row}
          note={notes[row.adId]?.note ?? ""}
          onNoteChange={t => setNote(row.adId, t)}
          onSave={() => saveNote(row.adId)}
          onGenAI={() => genAI(row.adId)}
          params={params[nk(row.adName)]}
          paramsBusy={paramsBusy.has(nk(row.adName))}
          onGenParams={() => genParams(row.adName)}
          todo={notes[row.adId]?.todo ?? ""}
          onTodoChange={t => setTodo(row.adId, t)}
          onTodoSave={() => saveTodo(row.adId)}
        />
      ))}
    </div>
  );
}

// ── Сводный разбор недели (основа для шторма) ────────────────────────────
function WeekSummary({ report, note, busy, onGenerate, onNoteChange, onNoteSave, todos }: {
  report: WeeklyReport; note: string; busy: boolean;
  onGenerate: () => void; onNoteChange: (t: string) => void; onNoteSave: () => void;
  todos: { adName: string; todo: string }[];
}) {
  const rows = report.rows;
  const sum = (f: (r: WeeklyCreativeRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const spend = sum(r => r.spend), leads = sum(r => r.leads), qual = sum(r => r.qualLeads);
  const cpl = leads ? spend / leads : null, cpql = qual ? spend / qual : null;
  const counts = rows.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const withCpl = rows.filter(r => r.cpl != null && r.leads > 0);
  const top = [...withCpl].sort((a, b) => a.cpl! - b.cpl!).slice(0, 3);
  const bot = [...withCpl].sort((a, b) => b.cpl! - a.cpl!).slice(0, 3);
  const miniLine = (r: WeeklyCreativeRow, color: string) => (
    <div key={r.adId} style={{ fontSize: 12, color: "#BBB", padding: "2px 0" }}>
      <span style={{ color, fontWeight: 700 }}>€{fmt(r.cpl)}</span> · {r.adName} <span style={{ color: "#666" }}>({r.leads} лид., hook {r.hookRate == null ? "—" : Math.round(r.hookRate) + "%"})</span>
    </div>
  );

  return (
    <Card style={{ marginBottom: 20, border: "1px solid rgba(196,144,209,0.25)" }}>
      <SectionTitle color="#C490D1">🧠 Разбор недели — {report.label}</SectionTitle>

      {/* Объективный блок (в коде) */}
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "8px 0 16px" }}>
        <Stat label="Спенд" value={`€${int(Math.round(spend))}`} />
        <Stat label="Лиды" value={int(leads)} color="#6EC8A0" />
        <Stat label="Квал" value={int(qual)} color="#6EC8A0" />
        <Stat label="Blended CPL" value={cpl == null ? "—" : `€${fmt(cpl)}`} color={cpl != null && cpl <= 20 ? "#6EC8A0" : "#D96B6B"} />
        <Stat label="Blended CPQL" value={cpql == null ? "—" : `€${fmt(cpql)}`} color={cpql != null && cpql <= 28 ? "#6EC8A0" : "#D96B6B"} />
        <Stat label="Winner / Loser / Test" value={`${counts.winner ?? 0} / ${counts.loser ?? 0} / ${counts.testing ?? 0}`} />
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: "1 1 320px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6EC8A0", fontWeight: 700, marginBottom: 4 }}>Лучшие по CPL</div>
          {top.length ? top.map(r => miniLine(r, "#6EC8A0")) : <div style={{ fontSize: 12, color: "#666" }}>нет лидов</div>}
        </div>
        <div style={{ flex: "1 1 320px" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#D96B6B", fontWeight: 700, marginBottom: 4 }}>Худшие по CPL</div>
          {bot.length ? bot.map(r => miniLine(r, "#D96B6B")) : <div style={{ fontSize: 12, color: "#666" }}>нет лидов</div>}
        </div>
      </div>

      {/* AI-разбор паттернов */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "#C490D1", fontWeight: 600 }}>Паттерны и над чем штормить (AI)</span>
        <Button size="sm" onClick={onGenerate} disabled={busy}>{busy ? "Анализирую…" : report.summary ? "↻ Пересобрать" : "🧠 Сделать разбор недели"}</Button>
      </div>
      {report.summary ? (
        <div style={{ fontSize: 13, color: "#DDD", lineHeight: 1.6, whiteSpace: "pre-wrap", background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: 14, marginBottom: 16 }}>
          {report.summary}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
          {busy ? "Claude собирает картину недели…" : "Сначала «Разобрать параметры» по крео — тогда разбор будет по хукам/энглам/персонам. Затем жми «Сделать разбор недели»."}
        </div>
      )}

      {/* Ту-ду недели — собрано из «Что делаем?» по каждому крео */}
      <div style={{ fontSize: 11, color: "#48B8D0", fontWeight: 600, marginBottom: 8 }}>
        📋 Ту-ду недели {todos.length > 0 && `— ${todos.length}`} <span style={{ color: "#555", fontWeight: 400 }}>(из «Что делаем?» по крео)</span>
      </div>
      {todos.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
          {todos.map((t, i) => (
            <div key={i} style={{ fontSize: 12, color: "#DDD", display: "flex", gap: 8, background: "rgba(72,184,208,0.06)", border: "1px solid rgba(72,184,208,0.18)", borderRadius: 6, padding: "6px 10px" }}>
              <span style={{ color: "#48B8D0" }}>▸</span>
              <span><b style={{ color: "#7EC8E0", fontWeight: 600 }}>{t.adName}:</b> {t.todo}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>Заполняй «🎯 Что делаем?» под крео — пункты соберутся сюда.</div>
      )}

      {/* Командный шторм уровня недели */}
      <div style={{ fontSize: 11, color: "#E8AA42", fontWeight: 600, marginBottom: 6 }}>✍️ Шторм команды (уровень недели)</div>
      <textarea
        value={note}
        onChange={e => onNoteChange(e.target.value)}
        onBlur={onNoteSave}
        placeholder="Идеи новых крео на следующую пачку — поверх AI-разбора…"
        style={{ width: "100%", minHeight: 90, background: "rgba(232,170,66,0.05)", border: "1px solid rgba(232,170,66,0.2)", borderRadius: 8, color: "#DDD", fontSize: 13, fontFamily: "inherit", padding: 12, resize: "vertical", lineHeight: 1.5 }}
      />
    </Card>
  );
}

// ── Карточка одного крео ────────────────────────────────────────────────
function CreativeCard({ row, note, onNoteChange, onSave, onGenAI, params, paramsBusy, onGenParams, todo, onTodoChange, onTodoSave }: {
  row: WeeklyCreativeRow; note: string;
  onNoteChange: (t: string) => void; onSave: () => void; onGenAI: () => void;
  params?: CreativeParams; paramsBusy: boolean; onGenParams: () => void;
  todo: string; onTodoChange: (t: string) => void; onTodoSave: () => void;
}) {
  const st = STATUS[row.status];
  const band = hookBand(row.hookRate);
  const [open, setOpen] = useState(false);
  const isVideo = !!row.videoId;
  const frame: React.CSSProperties = { width: 150, height: 188, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", display: "block", objectFit: "cover" };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Превью */}
        <div style={{ flexShrink: 0, width: 150 }}>
          {isVideo ? (
            <button
              onClick={() => setOpen(true)}
              title="Смотреть видео крупно"
              style={{ position: "relative", padding: 0, border: "none", background: "none", cursor: "pointer", display: "block" }}
            >
              {row.assetUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={row.assetUrl} alt={row.adName} style={frame} />
              ) : (
                <div style={{ ...frame, background: "rgba(255,255,255,0.02)" }} />
              )}
              <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.55)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>▶</span>
              </span>
            </button>
          ) : row.assetUrl ? (
            <a href={row.assetUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={row.assetUrl} alt={row.adName} style={frame} />
            </a>
          ) : (
            <div style={{ ...frame, background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 11, textAlign: "center", padding: 8 }}>
              нет ассета{row.objectType ? ` (${row.objectType})` : ""}
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Badge color={st.color}>{st.label}</Badge>
            {row.format && <Badge color="#C490D1">{row.format}</Badge>}
            {row.flow && <Badge color="#48B8D0">{row.flow.toUpperCase()}</Badge>}
          </div>
          {isVideo && <div style={{ marginTop: 6, fontSize: 10, color: "#555" }}>🎬 видео — клик, чтобы открыть крупно</div>}
        </div>

        {/* Метрики */}
        <div style={{ flex: "1 1 260px", minWidth: 260 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>{row.adName}</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto auto", gap: "2px 0" }}>
            <M l="Spend" v={`€${fmt(row.spend)}`} />
            <M l="Impressions" v={int(row.impressions)} />
            <M l="CPM" v={`€${fmt(row.cpm)}`} />
            <M l="Clicks" v={int(row.clicks)} />
            <M l="CPC" v={`€${fmt(row.cpc)}`} />
            <M l="CTR" v={`${fmt(row.ctr)}%`} />
            <M l="CR Click/Lead" v={`${fmt(row.crClickLead)}%`} />
            <M l="Leads" v={int(row.leads)} />
            <M l="CPL" v={`€${fmt(row.cpl)}`} highlight={row.cpl != null && row.cpl <= 20 ? "#6EC8A0" : row.cpl != null ? "#D96B6B" : undefined} />
            <M l="Qual Leads" v={int(row.qualLeads)} />
            <M l="CPQL" v={`€${fmt(row.cpql)}`} highlight={row.cpql != null && row.cpql <= 28 ? "#6EC8A0" : row.cpql != null ? "#D96B6B" : undefined} />
            <M l="Hook Rate" v={row.hookRate == null ? "—" : `${fmt(row.hookRate, 1)}% ${band.label}`} highlight={band.color} />
            <M l="Hold Rate" v={row.holdRate == null ? "—" : `${fmt(row.holdRate, 1)}%`} />
          </div>
        </div>

        {/* Зелёная зона — субъективная оценка */}
        <div style={{ flex: "1 1 300px", minWidth: 280, background: "rgba(110,200,160,0.06)", border: "1px solid rgba(110,200,160,0.2)", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "#6EC8A0", fontWeight: 600 }}>Субъективный разбор</span>
            <Button size="sm" onClick={onGenAI}>✨ AI-разбор</Button>
          </div>
          <textarea
            value={note}
            onChange={e => onNoteChange(e.target.value)}
            onBlur={onSave}
            placeholder="Что сработало / не сработало, гипотеза, что попробовать…"
            style={{ width: "100%", minHeight: 150, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#DDD", fontSize: 12, fontFamily: "inherit", padding: 10, resize: "vertical", lineHeight: 1.5 }}
          />
        </div>
      </div>

      {/* Разбор параметров (объективно, AI) — основа для шторма */}
      <div style={{ marginTop: 16, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 11, color: "#C490D1", fontWeight: 600, letterSpacing: 0.3 }}>🧩 Разбор параметров</span>
          <Button size="sm" variant={params ? "ghost" : "secondary"} onClick={onGenParams} disabled={paramsBusy}>
            {paramsBusy ? "Разбираю…" : params ? "↻ Пересобрать" : "Разобрать"}
          </Button>
        </div>
        {!params && (
          <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
            {paramsBusy ? "Gemini разбирает содержание креатива…" : "Система вытащит хук / энгл / персону / боди из содержания — основа для шторма и субъективной оценки."}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
          {params && <>
            <P label="Формат" v={params.format} />
            <P label="Персона" v={params.persona} />
            <P label="Хук" v={params.hook} />
            <P label="Энгл" v={params.angle} />
            <P label="Боди" v={params.body} />
            <P label="Чем силён" v={params.strength} color="#6EC8A0" />
            <P label="Над чем штормить" v={params.brainstorm} color="#E8AA42" />
          </>}
          {/* Что делаем? — коммент команды → ту-ду недели */}
          <div style={{ background: "rgba(232,170,66,0.05)", border: "1px solid rgba(232,170,66,0.3)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: "#E8AA42", marginBottom: 4, fontWeight: 700 }}>🎯 Что делаем?</div>
            <textarea
              value={todo}
              onChange={e => onTodoChange(e.target.value)}
              onBlur={onTodoSave}
              placeholder="Коммент / действие по крео → попадёт в ту-ду недели"
              style={{ width: "100%", minHeight: 84, background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#DDD", fontSize: 12, fontFamily: "inherit", padding: 8, resize: "vertical", lineHeight: 1.4, boxSizing: "border-box" }}
            />
          </div>
        </div>
      </div>

      {/* Лайтбокс — крупный плеер на весь экран */}
      {open && isVideo && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.88)", zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <video
            src={`/api/meta/video?videoId=${row.videoId}`}
            poster={row.assetUrl ?? undefined}
            controls autoPlay
            onClick={e => e.stopPropagation()}
            style={{ height: "88vh", maxWidth: "94vw", borderRadius: 12, background: "#000", display: "block" }}
          />
          <button
            onClick={() => setOpen(false)}
            aria-label="Закрыть"
            title="Закрыть (Esc)"
            style={{ position: "absolute", top: 20, right: 24, width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontSize: 22, lineHeight: 1, cursor: "pointer" }}
          >×</button>
        </div>
      )}
    </Card>
  );
}

function P({ label, v, color }: { label: string; v: string; color?: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: color ?? "#888", marginBottom: 3, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 12, color: "#DDD", lineHeight: 1.45 }}>{v}</div>
    </div>
  );
}

function M({ l, v, highlight }: { l: string; v: string; highlight?: string }) {
  return (
    <>
      <div style={{ fontSize: 12, color: "#888", padding: "4px 12px 4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{l}</div>
      <div style={{ fontSize: 12, color: highlight ?? "#DDD", fontWeight: highlight ? 700 : 500, textAlign: "right", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>{v}</div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 8, color: "#DDD", fontSize: 12, fontFamily: "inherit", padding: "8px 12px",
};
