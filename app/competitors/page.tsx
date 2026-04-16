"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card, PageHeader, Button, Badge, Modal, Label, Empty } from "@/components/ui";

type ConceptType = "hook" | "angle" | "persona" | "body" | "format" | "other";
type ConceptStatus = "pending" | "approved" | "rejected";
type ViewMode = "table" | "cards";

interface Concept {
  id: string;
  source: string;
  conceptType: ConceptType | null;
  title: string;
  description: string | null;
  status: ConceptStatus;
  createdAt: string;
  rawData: Record<string, string> | null;
}

const TYPE_COLOR: Record<string, string> = {
  hook: "#C490D1", angle: "#FF8B5A", persona: "#48B8D0",
  body: "#6EC8A0", format: "#E8AA42", other: "#555",
};
const TYPE_LABELS: Record<string, string> = {
  hook: "Хук", angle: "Энгл", persona: "Персона",
  body: "Боди", format: "Формат", other: "Другое",
};
const STATUS_COLOR: Record<ConceptStatus, string> = {
  pending: "#E8AA42", approved: "#6EC8A0", rejected: "#D96B6B",
};

// ── Table view ────────────────────────────────────────────────────────────────

const TABLE_COLS: { key: string; label: string; width?: number }[] = [
  { key: "page_name",     label: "Конкурент",    width: 130 },
  { key: "ai_hook",       label: "Хук",          width: 200 },
  { key: "ai_offer",      label: "Оффер",        width: 180 },
  { key: "ai_utp",        label: "УТП",          width: 180 },
  { key: "ai_cta",        label: "CTA",          width: 140 },
  { key: "ai_psychology", label: "Психология",   width: 160 },
  { key: "ai_jtbd",       label: "JTBD",         width: 160 },
  { key: "ai_description",label: "Описание",     width: 200 },
];

function Cell({ text, width }: { text: string; width: number }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <td style={{ padding: "8px 10px", borderRight: "1px solid rgba(255,255,255,0.05)", color: "#444", fontSize: 11, width }}></td>;
  const short = text.length > 80 && !expanded;
  return (
    <td style={{ padding: "8px 10px", borderRight: "1px solid rgba(255,255,255,0.05)", width, maxWidth: width, verticalAlign: "top" }}>
      <div style={{ fontSize: 11, color: "#CCC", lineHeight: 1.5 }}>
        {short ? text.slice(0, 80) + "…" : text}
        {text.length > 80 && (
          <span onClick={() => setExpanded(v => !v)}
            style={{ marginLeft: 4, color: "#48B8D0", cursor: "pointer", fontSize: 10 }}>
            {expanded ? "свернуть" : "ещё"}
          </span>
        )}
      </div>
    </td>
  );
}

function CompetitorTable({ concepts, onStatusChange }: {
  concepts: Concept[];
  onStatusChange: (id: string, status: ConceptStatus) => void;
}) {
  const rows = concepts.filter(c => c.rawData && c.rawData.page_name);

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#555", fontSize: 13 }}>
        Нет данных с AI-анализом. Импортируйте из Google Sheets с полями ai_hook, ai_offer и т.д.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,0.07)" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            {TABLE_COLS.map(col => (
              <th key={col.key} style={{
                padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700,
                color: "#666", textTransform: "uppercase", letterSpacing: 0.8,
                borderRight: "1px solid rgba(255,255,255,0.05)", width: col.width,
              }}>
                {col.label}
              </th>
            ))}
            <th style={{ padding: "10px 10px", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.8, width: 120 }}>Статус</th>
            <th style={{ padding: "10px 10px", width: 60 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const raw = c.rawData!;
            const archiveId = raw.ad_archive_id;
            const adUrl = archiveId ? `https://www.facebook.com/ads/library/?id=${archiveId}` : "";
            return (
              <tr key={c.id} style={{
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                opacity: c.status === "rejected" ? 0.5 : 1,
              }}>
                {TABLE_COLS.map(col => (
                  <Cell key={col.key} text={raw[col.key] ?? ""} width={col.width ?? 160} />
                ))}
                <td style={{ padding: "8px 10px", verticalAlign: "top" }}>
                  <select
                    value={c.status}
                    onChange={e => onStatusChange(c.id, e.target.value as ConceptStatus)}
                    style={{
                      fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 6, color: STATUS_COLOR[c.status], padding: "4px 6px", cursor: "pointer",
                    }}
                  >
                    <option value="pending">Ожидает</option>
                    <option value="approved">Одобрен</option>
                    <option value="rejected">Отклонён</option>
                  </select>
                </td>
                <td style={{ padding: "8px 10px", verticalAlign: "top", textAlign: "center" }}>
                  {adUrl && (
                    <a href={adUrl} target="_blank" rel="noreferrer"
                      style={{ fontSize: 14, textDecoration: "none" }} title="Открыть в FB Ads Library">
                      🔗
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Concept form ──────────────────────────────────────────────────────────────

function ConceptForm({ initial, onSave, onCancel }: {
  initial?: Partial<Concept>;
  onSave: (data: Omit<Concept, "id" | "createdAt" | "rawData">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
    conceptType: (initial?.conceptType ?? "hook") as ConceptType,
    source: initial?.source ?? "manual",
    status: (initial?.status ?? "pending") as ConceptStatus,
  });
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <Label>Тип</Label>
          <select value={form.conceptType} onChange={f("conceptType")}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <Label>Источник</Label>
          <input value={form.source} onChange={f("source")} placeholder="manual / apify / google_sheets..." />
        </div>
      </div>
      <div><Label>Название / идея *</Label><input value={form.title} onChange={f("title")} placeholder="Что именно работает у конкурента..." /></div>
      <div><Label>Описание / транскрипция</Label><textarea value={form.description} onChange={f("description")} style={{ minHeight: 120 }} placeholder="Подробное описание, текст с экрана, структура видео..." /></div>
      <div>
        <Label>Статус</Label>
        <select value={form.status} onChange={f("status")}>
          <option value="pending">Ожидает оценки</option>
          <option value="approved">Одобрен для тестирования</option>
          <option value="rejected">Отклонён</option>
        </select>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="primary" onClick={() => form.title.trim() && onSave({ ...form })}>Сохранить</Button>
      </div>
    </div>
  );
}

// ── AI hypothesis ─────────────────────────────────────────────────────────────

async function generateHypothesis(concepts: Concept[]): Promise<string> {
  const res = await fetch("/api/ai/competitor-hypothesis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ concepts }),
  });
  const data = await res.json();
  return data.hypothesis ?? "Ошибка генерации";
}

// ── Sheets import ─────────────────────────────────────────────────────────────

const AI_FIELDS = ["title", "body_text", "ai_jtbd", "ai_utp", "ai_description", "ai_hook", "ai_offer", "ai_cta", "ai_psychology", "ai_transcribe"];

function buildAdText(row: Record<string, string>): string {
  const parts: string[] = [];
  if (row.title) parts.push(`Заголовок: ${row.title}`);
  if (row.body_text) parts.push(`Текст: ${row.body_text}`);
  if (row.ai_hook) parts.push(`Хук: ${row.ai_hook}`);
  if (row.ai_utp) parts.push(`УТП: ${row.ai_utp}`);
  if (row.ai_jtbd) parts.push(`JTBD: ${row.ai_jtbd}`);
  if (row.ai_offer) parts.push(`Оффер: ${row.ai_offer}`);
  if (row.ai_cta) parts.push(`CTA: ${row.ai_cta}`);
  if (row.ai_psychology) parts.push(`Психология: ${row.ai_psychology}`);
  if (row.ai_description) parts.push(`Описание: ${row.ai_description}`);
  if (row.ai_transcribe) parts.push(`Транскрипция: ${row.ai_transcribe}`);
  return parts.join("\n");
}

function isKnownSchema(headers: string[]): boolean {
  return headers.includes("ad_archive_id") && headers.includes("page_name");
}

function SheetsImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [knownSchema, setKnownSchema] = useState(false);
  const [competitorCol, setCompetitorCol] = useState("");
  const [textCol, setTextCol] = useState("");
  const [preview, setPreview] = useState<{ competitor: string; text: string; url: string }[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; total: number } | null>(null);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(""); setHeaders([]); setRows([]); setPreview([]); setResult(null);
    try {
      const res = await fetch("/api/competitors/sheets", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!data.ok) { setError(data.error ?? "Ошибка"); return; }
      setHeaders(data.headers); setRows(data.rows);
      const known = isKnownSchema(data.headers);
      setKnownSchema(known);
      if (!known) {
        const h = data.headers as string[];
        const guess = (keys: string[]) => h.find(col => keys.some(k => col.toLowerCase().includes(k))) ?? "";
        setCompetitorCol(guess(["page_name", "конкурент", "competitor", "компания"]));
        setTextCol(guess(["body_text", "текст", "text", "описание"]));
      }
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const buildAds = () => rows.filter(r => {
    const competitor = knownSchema ? r.page_name : r[competitorCol];
    const text = knownSchema ? buildAdText(r) : r[textCol];
    return competitor && text && text.length > 5;
  }).map(r => ({
    competitor_name: knownSchema ? r.page_name : (r[competitorCol] ?? ""),
    ad_text: knownSchema ? buildAdText(r) : (r[textCol] ?? ""),
    ad_url: r.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${r.ad_archive_id}` : (r.link_url ?? r.ad_url ?? "") || undefined,
    source: "google_sheets",
    raw_data: knownSchema ? r : undefined,
  }));

  const handlePreview = () => {
    const ads = buildAds().slice(0, 3);
    setPreview(ads.map(a => ({ competitor: a.competitor_name, text: a.ad_text, url: a.ad_url ?? "" })));
  };

  const handleImport = async () => {
    const ads = buildAds();
    if (!ads.length) return;
    setImporting(true); setResult(null);
    try {
      const res = await fetch("/api/competitors/import", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ads }),
      });
      const data = await res.json();
      setResult({ imported: data.imported ?? 0, total: ads.length });
      onImported();
    } finally { setImporting(false); }
  };

  const readyToImport = headers.length > 0 && (knownSchema || (competitorCol && textCol));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Label>Ссылка на Google Sheets</Label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={url} onChange={e => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/..." style={{ flex: 1 }} />
          <Button variant="primary" onClick={handleFetch} disabled={loading || !url.trim()}>
            {loading ? "⏳" : "Загрузить"}
          </Button>
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>Файл → Поделиться → Все у кого есть ссылка → Читатель</div>
      </div>

      {error && <div style={{ fontSize: 12, color: "#D96B6B", background: "rgba(217,107,107,0.08)", border: "1px solid rgba(217,107,107,0.2)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>}

      {headers.length > 0 && (
        <>
          {knownSchema ? (
            <div style={{ fontSize: 12, background: "rgba(110,200,160,0.06)", border: "1px solid rgba(110,200,160,0.2)", borderRadius: 8, padding: "10px 14px", color: "#6EC8A0" }}>
              ✓ Распознана схема с AI-анализом. Загружено {rows.length} строк.
              <br /><span style={{ color: "#666", fontSize: 11 }}>Конкурент ← page_name · {AI_FIELDS.filter(f => f.startsWith("ai_")).length} AI полей · URL ← ad_archive_id</span>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <Label>Колонка: конкурент *</Label>
                <select value={competitorCol} onChange={e => setCompetitorCol(e.target.value)}>
                  <option value="">— выбери —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div>
                <Label>Колонка: текст объявления *</Label>
                <select value={textCol} onChange={e => setTextCol(e.target.value)}>
                  <option value="">— выбери —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
          )}
          <Button onClick={handlePreview} disabled={!readyToImport}>👁 Предпросмотр 3 строк</Button>
        </>
      )}

      {preview.length > 0 && (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {preview.map((r, i) => (
            <div key={i} style={{ fontSize: 12, borderBottom: i < preview.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", paddingBottom: i < preview.length - 1 ? 10 : 0 }}>
              <span style={{ color: "#C490D1", fontWeight: 700 }}>{r.competitor}</span>
              {r.url && <span style={{ marginLeft: 8, fontSize: 10, color: "#444" }}>🔗</span>}
              <div style={{ color: "#888", marginTop: 3, lineHeight: 1.5 }}>{r.text.slice(0, 250)}{r.text.length > 250 ? "…" : ""}</div>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div style={{ fontSize: 13, fontWeight: 700, color: "#6EC8A0", background: "rgba(110,200,160,0.06)", border: "1px solid rgba(110,200,160,0.2)", borderRadius: 8, padding: "10px 14px" }}>
          ✓ Импортировано {result.imported} из {result.total} строк.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onClose}>Закрыть</Button>
        {readyToImport && !result && (
          <Button variant="primary" onClick={handleImport} disabled={importing}>
            {importing ? `⏳ Импортирую...` : `📥 Импортировать ${rows.length} строк`}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── n8n guide ─────────────────────────────────────────────────────────────────

function N8nGuideModal({ onClose }: { onClose: () => void }) {
  const webhookUrl = typeof window !== "undefined" ? `${window.location.origin}/api/competitors/import` : "/api/competitors/import";
  const examplePayload = JSON.stringify({ ads: [{ competitor_name: "БухПро", ad_text: "Хотите работать бухгалтером в Германии?...", ad_url: "https://www.facebook.com/ads/library/?id=..." }] }, null, 2);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 12, color: "#AAA", lineHeight: 1.7 }}>Автоматический сбор рекламы конкурентов через Apify + n8n.</div>
      {[
        { color: "#E8AA42", title: "Шаг 1 — Apify: Facebook Ads Library Scraper", body: "1. Зарегистрируйтесь на apify.com\n2. Найдите актор Facebook Ads Library Scraper\n3. Настройте: keywords = «бухгалтер Германия»\n4. Возьмите API Token и Actor ID" },
        { color: "#48B8D0", title: "Шаг 2 — n8n Workflow", body: "① Schedule Trigger — каждый день 09:00\n② HTTP Request — запустить Apify\n③ Wait — 60 сек\n④ HTTP Request — получить результаты\n⑤ Code — трансформация\n⑥ HTTP Request — POST на webhook" },
      ].map(s => (
        <div key={s.title}>
          <div style={{ fontSize: 11, fontWeight: 700, color: s.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{s.title}</div>
          <div style={{ fontSize: 12, color: "#999", lineHeight: 1.7, whiteSpace: "pre-line" }}>{s.body}</div>
        </div>
      ))}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6EC8A0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Webhook</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 12px", color: "#E8AA42", wordBreak: "break-all" }}>{webhookUrl}</div>
        <pre style={{ fontFamily: "monospace", fontSize: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: 12, color: "#AAA", margin: "10px 0 0", overflow: "auto" }}>{examplePayload}</pre>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Button onClick={onClose}>Закрыть</Button></div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CompetitorsPage() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: Concept }>({ open: false });
  const [n8nModal, setN8nModal] = useState(false);
  const [sheetsModal, setSheetsModal] = useState(false);
  const [filter, setFilter] = useState<ConceptStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ConceptType | "all">("all");
  const [search, setSearch] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [generating, setGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("competitor_concepts")
      .select("*")
      .order("created_at", { ascending: false });
    setConcepts((data ?? []).map(r => ({
      id: r.id,
      source: r.source ?? "manual",
      conceptType: r.concept_type as ConceptType,
      title: r.title,
      description: r.description,
      status: r.status as ConceptStatus,
      createdAt: r.created_at,
      rawData: r.raw_data ?? null,
    })));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async (data: Omit<Concept, "id" | "createdAt" | "rawData">) => {
    if (modal.editing) {
      await supabase.from("competitor_concepts").update({
        title: data.title, description: data.description,
        concept_type: data.conceptType, source: data.source, status: data.status,
      }).eq("id", modal.editing.id);
    } else {
      await supabase.from("competitor_concepts").insert({
        title: data.title, description: data.description,
        concept_type: data.conceptType, source: data.source, status: data.status,
      });
    }
    setModal({ open: false });
    reload();
  };

  const quickStatus = async (id: string, status: ConceptStatus) => {
    await supabase.from("competitor_concepts").update({ status }).eq("id", id);
    reload();
  };

  const handleGenerateHypothesis = async () => {
    const approved = concepts.filter(c => c.status === "approved");
    if (!approved.length) return;
    setGenerating(true); setHypothesis("");
    try { setHypothesis(await generateHypothesis(approved)); }
    finally { setGenerating(false); }
  };

  const filtered = concepts.filter(c => {
    if (filter !== "all" && c.status !== filter) return false;
    if (typeFilter !== "all" && c.conceptType !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const raw = c.rawData ? Object.values(c.rawData).join(" ").toLowerCase() : "";
      if (!c.title.toLowerCase().includes(q) && !raw.includes(q)) return false;
    }
    return true;
  });

  const counts = {
    pending: concepts.filter(c => c.status === "pending").length,
    approved: concepts.filter(c => c.status === "approved").length,
    rejected: concepts.filter(c => c.status === "rejected").length,
  };

  const tableRows = concepts.filter(c => c.rawData?.page_name).length;

  return (
    <div>
      <PageHeader
        title="База конкурентов"
        subtitle="Анализ рекламы конкурентов"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {counts.approved > 0 && (
              <Button onClick={handleGenerateHypothesis} disabled={generating}
                style={{ background: "rgba(232,170,66,0.12)", border: "1px solid rgba(232,170,66,0.3)", color: generating ? "#666" : "#E8AA42" }}>
                {generating ? "⏳ Генерирую..." : `✨ Гипотезы (${counts.approved})`}
              </Button>
            )}
            <Button onClick={() => setSheetsModal(true)}
              style={{ border: "1px solid rgba(110,200,160,0.3)", color: "#6EC8A0", background: "rgba(110,200,160,0.08)" }}>
              📊 Импорт из Sheets
            </Button>
            <Button onClick={() => setN8nModal(true)}
              style={{ border: "1px solid rgba(196,144,209,0.3)", color: "#C490D1", background: "rgba(196,144,209,0.08)" }}>
              🔗 n8n
            </Button>
            <Button variant="primary" onClick={() => setModal({ open: true })}>+ Добавить</Button>
          </div>
        }
      />

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Всего", value: concepts.length, color: "#48B8D0" },
          { label: "Ожидают", value: counts.pending, color: "#E8AA42" },
          { label: "Одобрены", value: counts.approved, color: "#6EC8A0" },
          { label: "Отклонены", value: counts.rejected, color: "#D96B6B" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Hypothesis */}
      {hypothesis && (
        <Card style={{ marginBottom: 20, background: "rgba(232,170,66,0.04)", border: "1px solid rgba(232,170,66,0.2)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#E8AA42", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>✨ AI Гипотезы</div>
          <div style={{ fontSize: 12, color: "#AAA", lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{hypothesis}</div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <Button size="sm" onClick={() => navigator.clipboard.writeText(hypothesis)}>📋 Копировать</Button>
            <Button size="sm" onClick={() => setHypothesis("")}>✕</Button>
          </div>
        </Card>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {/* View toggle */}
        <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden", marginRight: 4 }}>
          {([["table", `📋 Таблица${tableRows > 0 ? ` (${tableRows})` : ""}`], ["cards", "🗂 Карточки"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setViewMode(v)} style={{
              padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", border: "none",
              background: viewMode === v ? "rgba(72,184,208,0.15)" : "rgba(255,255,255,0.02)",
              color: viewMode === v ? "#48B8D0" : "#555", fontWeight: viewMode === v ? 700 : 400,
            }}>{l}</button>
          ))}
        </div>

        {/* Status filter */}
        {(["all", "pending", "approved", "rejected"] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: filter === s ? 700 : 400,
            cursor: "pointer", fontFamily: "inherit",
            border: filter === s ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.06)",
            background: filter === s ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
            color: filter === s ? "#E8AA42" : "#666",
          }}>
            {s === "all" ? `Все` : s === "pending" ? `Ожидают` : s === "approved" ? `Одобрены` : `Отклонены`}
          </button>
        ))}

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск..."
          style={{ marginLeft: "auto", width: 180, fontSize: 12, padding: "6px 12px" }}
        />
      </div>

      {/* Content */}
      {viewMode === "table" ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <CompetitorTable concepts={filtered} onStatusChange={quickStatus} />
        </Card>
      ) : (
        filtered.length === 0 ? (
          <Empty icon="🔍" text="Нет идей. Добавьте первую находку из рекламы конкурентов." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(c => (
              <Card key={c.id} style={{
                border: c.status === "approved" ? "1px solid rgba(110,200,160,0.2)" : c.status === "rejected" ? "1px solid rgba(217,107,107,0.1)" : "1px solid rgba(255,255,255,0.06)",
                opacity: c.status === "rejected" ? 0.6 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                      <Badge color={STATUS_COLOR[c.status]}>
                        {c.status === "pending" ? "Ожидает" : c.status === "approved" ? "Одобрен" : "Отклонён"}
                      </Badge>
                      {c.conceptType && <Badge color={TYPE_COLOR[c.conceptType] ?? "#555"}>{TYPE_LABELS[c.conceptType] ?? c.conceptType}</Badge>}
                      <span style={{ fontSize: 10, color: "#444" }}>{c.source}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#DDD", marginBottom: 4 }}>{c.title}</div>
                    {c.description && <div style={{ fontSize: 12, color: "#777", lineHeight: 1.6 }}>{c.description.slice(0, 200)}{c.description.length > 200 ? "…" : ""}</div>}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                    {c.status !== "approved" && <Button size="sm" variant="primary" onClick={() => quickStatus(c.id, "approved")}>✓</Button>}
                    {c.status !== "rejected" && <Button size="sm" onClick={() => quickStatus(c.id, "rejected")}>✕</Button>}
                    {c.status !== "pending" && <Button size="sm" onClick={() => quickStatus(c.id, "pending")} style={{ opacity: 0.5 }}>↺</Button>}
                    <Button size="sm" onClick={() => setModal({ open: true, editing: c })}>✏</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? "Редактировать идею" : "Новая идея конкурента"}>
        <ConceptForm initial={modal.editing} onSave={handleSave} onCancel={() => setModal({ open: false })} />
      </Modal>

      <Modal open={sheetsModal} onClose={() => setSheetsModal(false)} title="📊 Импорт из Google Sheets">
        <SheetsImportModal onClose={() => setSheetsModal(false)} onImported={reload} />
      </Modal>

      <Modal open={n8nModal} onClose={() => setN8nModal(false)} title="🔗 Автоматизация через n8n + Apify">
        <N8nGuideModal onClose={() => setN8nModal(false)} />
      </Modal>
    </div>
  );
}
