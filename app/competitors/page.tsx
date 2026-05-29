"use client";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { Card, PageHeader, Button, Badge, Modal, Label, Empty } from "@/components/ui";
import { hookStore, bodyStore, angleStore, personaStore } from "@/lib/store";

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function getMediaType(raw: Record<string, string>): "video" | "image" | "none" {
  if (raw.type === "video") return "video";
  if (raw.type === "image" || raw.type === "static") return "image";
  const url = raw.drive_image_url ?? raw.original_image_url ?? raw.image_url ?? "";
  if (url.match(/\.(mp4|mov|webm|avi|mkv)(\?|$)/i)) return "video";
  if (url.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i)) return "image";
  if (raw.video_url ?? raw.video_hd_url ?? raw.video_sd_url) return "video";
  if (url) return "image";
  return "none";
}

function getImageUrl(raw: Record<string, string>): string {
  if (getMediaType(raw) !== "video") {
    return raw.drive_image_url ?? raw.original_image_url ?? raw.image_url ?? raw.snapshot_url ?? raw.thumbnail_url ?? raw.creative_url ?? "";
  }
  return raw.image_url ?? raw.snapshot_url ?? raw.thumbnail_url ?? raw.creative_url ?? "";
}

function getVideoUrl(raw: Record<string, string>): string {
  if (getMediaType(raw) === "video") {
    return raw.drive_image_url ?? raw.original_image_url ?? raw.video_url ?? raw.video_hd_url ?? raw.video_sd_url ?? "";
  }
  return raw.video_url ?? raw.video_hd_url ?? raw.video_sd_url ?? "";
}

function getAdUrl(raw: Record<string, string>): string {
  if (raw.ad_archive_id) return `https://www.facebook.com/ads/library/?id=${raw.ad_archive_id}`;
  return raw.ad_url ?? raw.link_url ?? "";
}

// ── Detail modal ──────────────────────────────────────────────────────────────

const ANALYSIS_SECTIONS: { key: string; label: string; color: string }[] = [
  { key: "ai_hook",        label: "Хук",           color: "#C490D1" },
  { key: "ai_offer",       label: "Оффер",         color: "#FF8B5A" },
  { key: "ai_utp",         label: "УТП",           color: "#48B8D0" },
  { key: "ai_cta",         label: "CTA",           color: "#6EC8A0" },
  { key: "ai_psychology",  label: "Психология",    color: "#E8AA42" },
  { key: "ai_jtbd",        label: "JTBD",          color: "#C490D1" },
  { key: "ai_description", label: "Описание",      color: "#AAA" },
  { key: "ai_transcribe",  label: "Транскрипция",  color: "#888" },
  { key: "title",          label: "Заголовок",     color: "#DDD" },
  { key: "body_text",      label: "Текст",         color: "#BBB" },
];

function CreativeDetailModal({ concept, onClose, onStatusChange }: {
  concept: Concept;
  onClose: () => void;
  onStatusChange: (id: string, status: ConceptStatus) => void;
}) {
  const [mediaError, setMediaError] = useState(false);
  const raw = concept.rawData ?? {};
  const imageUrl = getImageUrl(raw);
  const videoUrl = getVideoUrl(raw);
  const adUrl = getAdUrl(raw);
  const competitor = raw.page_name ?? concept.title;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: "80vh", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#EEE" }}>{competitor}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
            <select
              value={concept.status}
              onChange={e => { onStatusChange(concept.id, e.target.value as ConceptStatus); }}
              style={{
                fontSize: 11, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6, color: STATUS_COLOR[concept.status], padding: "4px 8px", cursor: "pointer",
              }}
            >
              <option value="pending">Ожидает</option>
              <option value="approved">Одобрен</option>
              <option value="rejected">Отклонён</option>
            </select>
            {adUrl && (
              <a href={adUrl} target="_blank" rel="noreferrer"
                style={{ fontSize: 11, color: "#48B8D0", textDecoration: "none", border: "1px solid rgba(72,184,208,0.3)", borderRadius: 6, padding: "4px 10px" }}>
                🔗 Открыть в FB Ads Library
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: (videoUrl || imageUrl || adUrl) ? "280px 1fr" : "1fr", gap: 20, overflowY: "auto" }}>
        {/* Creative preview */}
        {(videoUrl || imageUrl || adUrl) && (
          <div style={{ flexShrink: 0 }}>
            {(!videoUrl && !imageUrl) || mediaError ? (
              <div style={{ width: "100%", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "30px 16px", minHeight: 180 }}>
                <div style={{ fontSize: 28 }}>🎬</div>
                <div style={{ fontSize: 11, color: "#555", textAlign: "center" }}>Медиа недоступно напрямую</div>
                {adUrl && (
                  <a href={adUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: "#48B8D0", textDecoration: "none", border: "1px solid rgba(72,184,208,0.3)", borderRadius: 6, padding: "6px 14px" }}>
                    Открыть в FB Ads Library →
                  </a>
                )}
              </div>
            ) : videoUrl ? (
              <video
                src={videoUrl}
                controls
                onError={() => setMediaError(true)}
                style={{ width: "100%", borderRadius: 10, background: "#111", maxHeight: 400, objectFit: "contain" }}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={competitor}
                onError={() => setMediaError(true)}
                style={{ width: "100%", borderRadius: 10, objectFit: "cover", maxHeight: 400 }}
              />
            )}
            {!mediaError && raw.ad_archive_id && (
              <div style={{ fontSize: 10, color: "#444", marginTop: 6, textAlign: "center" }}>
                ID: {raw.ad_archive_id}
              </div>
            )}
          </div>
        )}

        {/* Analysis */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, overflowY: "auto" }}>
          {ANALYSIS_SECTIONS.map(({ key, label, color }) => {
            const val = raw[key];
            if (!val) return null;
            return (
              <div key={key}>
                <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 5 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.7, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "10px 12px" }}>
                  {val}
                </div>
              </div>
            );
          })}

          {/* Any extra raw fields not in the standard list */}
          {Object.entries(raw).filter(([k, v]) =>
            v && !ANALYSIS_SECTIONS.map(s => s.key).includes(k) &&
            !["page_name", "ad_archive_id", "type", "status", "image_url", "video_url", "snapshot_url", "thumbnail_url", "ad_url", "link_url", "video_hd_url", "video_sd_url", "creative_url", "drive_image_url", "original_image_url"].includes(k)
          ).map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>{k}</div>
              <div style={{ fontSize: 12, color: "#888", lineHeight: 1.6 }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table view ────────────────────────────────────────────────────────────────

const TABLE_COLS: { key: string; label: string; width: number }[] = [
  { key: "ai_hook",         label: "Хук",        width: 220 },
  { key: "ai_offer",        label: "Оффер",      width: 180 },
  { key: "ai_utp",          label: "УТП",        width: 160 },
  { key: "ai_cta",          label: "CTA",        width: 130 },
  { key: "ai_psychology",   label: "Психология", width: 150 },
];

function CompetitorTable({ concepts, onRowClick, onStatusChange }: {
  concepts: Concept[];
  onRowClick: (c: Concept) => void;
  onStatusChange: (id: string, status: ConceptStatus) => void;
}) {
  const rows = concepts
    .filter(c => c.rawData)
    .sort((a, b) => {
      const ra = parseInt(a.rawData?.eu_total_reach ?? "0", 10) || 0;
      const rb = parseInt(b.rawData?.eu_total_reach ?? "0", 10) || 0;
      return rb - ra;
    });

  if (rows.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#555", fontSize: 13 }}>
        Нет данных. Импортируйте из Google Sheets.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <th style={{ padding: "10px 10px", width: 48, borderRight: "1px solid rgba(255,255,255,0.05)" }} />
            <th style={{ padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.8, borderRight: "1px solid rgba(255,255,255,0.05)", width: 140 }}>Конкурент</th>
            <th style={{ padding: "10px 10px", textAlign: "right", fontSize: 10, fontWeight: 700, color: "#48B8D0", textTransform: "uppercase", letterSpacing: 0.8, borderRight: "1px solid rgba(255,255,255,0.05)", width: 90 }}>Охват ↓</th>
            {TABLE_COLS.map(col => (
              <th key={col.key} style={{ padding: "10px 10px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.8, borderRight: "1px solid rgba(255,255,255,0.05)", width: col.width }}>
                {col.label}
              </th>
            ))}
            <th style={{ padding: "10px 10px", fontSize: 10, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.8, width: 110 }}>Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c, i) => {
            const raw = c.rawData!;
            const imageUrl = getImageUrl(raw);
            const competitor = raw.page_name ?? c.title;

            return (
              <tr
                key={c.id}
                onClick={() => onRowClick(c)}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                  opacity: c.status === "rejected" ? 0.5 : 1,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(72,184,208,0.05)")}
                onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)")}
              >
                {/* Thumbnail */}
                <td style={{ padding: "6px 8px", borderRight: "1px solid rgba(255,255,255,0.05)", width: 48 }} onClick={e => e.stopPropagation()}>
                  {getMediaType(raw) === "video" ? (
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: "#48B8D0" }}>
                      ▶
                    </div>
                  ) : imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl} alt="" style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: 36, height: 36, borderRadius: 6, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "#555" }}>
                      {competitor.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </td>

                {/* Competitor name */}
                <td style={{ padding: "8px 10px", borderRight: "1px solid rgba(255,255,255,0.05)", width: 140, verticalAlign: "top" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#DDD" }}>{competitor}</div>
                  {getAdUrl(raw) && (
                    <a href={getAdUrl(raw)} target="_blank" rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ fontSize: 10, color: "#48B8D0", textDecoration: "none" }}>FB Ads →</a>
                  )}
                </td>

                {/* Reach */}
                <td style={{ padding: "8px 10px", borderRight: "1px solid rgba(255,255,255,0.05)", width: 90, verticalAlign: "top", textAlign: "right" }}>
                  {raw.eu_total_reach ? (
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#48B8D0" }}>
                      {parseInt(raw.eu_total_reach, 10).toLocaleString("de-DE")}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, color: "#333" }}>—</div>
                  )}
                </td>

                {/* Analysis columns */}
                {TABLE_COLS.map(col => {
                  const text = raw[col.key] ?? "";
                  return (
                    <td key={col.key} style={{ padding: "8px 10px", borderRight: "1px solid rgba(255,255,255,0.05)", width: col.width, maxWidth: col.width, verticalAlign: "top" }}>
                      <div style={{ fontSize: 11, color: "#BBB", lineHeight: 1.5, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                        {text}
                      </div>
                    </td>
                  );
                })}

                {/* Status */}
                <td style={{ padding: "8px 10px", verticalAlign: "top", width: 110 }} onClick={e => e.stopPropagation()}>
                  <select
                    value={c.status}
                    onChange={e => onStatusChange(c.id, e.target.value as ConceptStatus)}
                    style={{ fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: STATUS_COLOR[c.status], padding: "4px 6px", cursor: "pointer" }}
                  >
                    <option value="pending">Ожидает</option>
                    <option value="approved">Одобрен</option>
                    <option value="rejected">Отклонён</option>
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Insights modal ────────────────────────────────────────────────────────────

const INSIGHT_PARAMS: { key: "hook" | "body" | "angle" | "persona"; label: string; color: string }[] = [
  { key: "hook",    label: "Хук",    color: "#C490D1" },
  { key: "angle",   label: "Энгл",   color: "#FF8B5A" },
  { key: "persona", label: "Персона", color: "#48B8D0" },
  { key: "body",    label: "Боди",   color: "#6EC8A0" },
];

const INSIGHT_COLORS: Record<string, string> = {
  hook: "#C490D1", angle: "#FF8B5A", persona: "#48B8D0", body: "#6EC8A0",
};

async function saveInsightToLibrary(key: "hook" | "angle" | "persona" | "body", name: string, text: string): Promise<void> {
  const description = `[Из анализа конкурентов]\n\n${text}`;
  if (key === "hook") {
    await hookStore.save({ name, template: "", description, examples: [], color: INSIGHT_COLORS.hook, flow: "com" });
  } else if (key === "body") {
    await bodyStore.save({ name, template: "", description, examples: [], color: INSIGHT_COLORS.body, flow: "com" });
  } else if (key === "angle") {
    await angleStore.save({ name, template: "", description, examples: [], color: INSIGHT_COLORS.angle, flow: "com" });
  } else if (key === "persona") {
    await personaStore.save({ name, short: "Конкурент", description, pointA: "", pointB: "", pains: [], triggers: [], color: INSIGHT_COLORS.persona, flow: "com" });
  }
}

function InsightSaveForm({ paramKey, text, onDone }: { paramKey: "hook" | "angle" | "persona" | "body"; text: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true); setErr("");
    try {
      await saveInsightToLibrary(paramKey, name.trim(), text);
      setSaved(true);
      setTimeout(onDone, 1200);
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  if (saved) {
    return <div style={{ fontSize: 11, color: "#6EC8A0", padding: "8px 0" }}>Сохранено в библиотеку</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, color: "#888" }}>Название для библиотеки:</div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Например: Хук через страх потери"
          style={{ flex: 1, fontSize: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "6px 10px", color: "#EEE" }}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          autoFocus
        />
        <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? "..." : "Сохранить"}
        </Button>
        <Button onClick={onDone}>Отмена</Button>
      </div>
      {err && <div style={{ fontSize: 11, color: "#D96B6B" }}>{err}</div>}
    </div>
  );
}

function InsightsModal({ concepts, onClose }: { concepts: Concept[]; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<{ hook: string; body: string; angle: string; persona: string } | null>(null);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState<"hook" | "angle" | "persona" | "body" | null>(null);

  const generate = async () => {
    setLoading(true); setError(""); setInsights(null); setSavingKey(null);
    try {
      const res = await fetch("/api/ai/competitor-insights", { method: "POST" });
      let data: { ok?: boolean; error?: string; insights?: { hook: string; body: string; angle: string; persona: string } };
      try {
        data = await res.json();
      } catch {
        setError("Таймаут — попробуй ещё раз.");
        return;
      }
      if (!data.ok) { setError(data.error ?? "Ошибка"); return; }
      setInsights(data.insights!);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!insights && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
            Claude проанализирует топ-20 объявлений конкурентов по охвату и выдаст конкретные паттерны для хуков, боди, энглов и персон — которые стоит тестировать в наших креативах.
          </div>
          <Button variant="primary" onClick={generate}>Сгенерировать инсайты</Button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 13, color: "#888" }}>Анализирую {Math.min(concepts.filter(c => c.rawData).length, 20)} объявлений...</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 8 }}>~20-30 секунд</div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: "#D96B6B", background: "rgba(217,107,107,0.08)", border: "1px solid rgba(217,107,107,0.2)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>
      )}

      {insights && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxHeight: "65vh", overflowY: "auto" }}>
          {INSIGHT_PARAMS.map(({ key, label, color }) => (
            <div key={key}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: "uppercase", letterSpacing: 1.2 }}>{label}</div>
                <div style={{ fontSize: 10, color: "#555", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 4, padding: "2px 7px" }}>из анализа конкурентов</div>
                {savingKey !== key && (
                  <button
                    onClick={() => setSavingKey(key)}
                    style={{ marginLeft: "auto", fontSize: 11, color: color, background: "transparent", border: `1px solid ${color}40`, borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}
                  >
                    Сохранить в библиотеку
                  </button>
                )}
              </div>
              <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.8, whiteSpace: "pre-wrap", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "14px 16px" }}>
                {insights[key]}
              </div>
              {savingKey === key && (
                <InsightSaveForm
                  paramKey={key}
                  text={insights[key]}
                  onDone={() => setSavingKey(null)}
                />
              )}
            </div>
          ))}
          <Button onClick={generate} style={{ alignSelf: "flex-end" }}>Обновить</Button>
        </div>
      )}

      {!loading && <div style={{ display: "flex", justifyContent: "flex-end" }}><Button onClick={onClose}>Закрыть</Button></div>}
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
        <div><Label>Тип</Label>
          <select value={form.conceptType} onChange={f("conceptType")}>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div><Label>Источник</Label>
          <input value={form.source} onChange={f("source")} placeholder="manual / apify..." />
        </div>
      </div>
      <div><Label>Название *</Label><input value={form.title} onChange={f("title")} /></div>
      <div><Label>Описание</Label><textarea value={form.description} onChange={f("description")} style={{ minHeight: 100 }} /></div>
      <div><Label>Статус</Label>
        <select value={form.status} onChange={f("status")}>
          <option value="pending">Ожидает</option>
          <option value="approved">Одобрен</option>
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
    method: "POST", headers: { "Content-Type": "application/json" },
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
  if (row.ai_offer) parts.push(`Оффер: ${row.ai_offer}`);
  if (row.ai_cta) parts.push(`CTA: ${row.ai_cta}`);
  if (row.ai_psychology) parts.push(`Психология: ${row.ai_psychology}`);
  if (row.ai_description) parts.push(`Описание: ${row.ai_description}`);
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
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; total: number } | null>(null);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setLoading(true); setError(""); setHeaders([]); setRows([]); setResult(null);
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
        setCompetitorCol(guess(["page_name", "конкурент", "competitor"]));
        setTextCol(guess(["body_text", "текст", "text"]));
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
    ad_url: r.ad_archive_id ? `https://www.facebook.com/ads/library/?id=${r.ad_archive_id}` : (r.ad_url ?? "") || undefined,
    source: "google_sheets",
    raw_data: r,
  }));

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
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{ flex: 1 }} />
          <Button variant="primary" onClick={handleFetch} disabled={loading || !url.trim()}>{loading ? "⏳" : "Загрузить"}</Button>
        </div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 6 }}>Файл → Поделиться → Все у кого есть ссылка → Читатель</div>
      </div>
      {error && <div style={{ fontSize: 12, color: "#D96B6B", background: "rgba(217,107,107,0.08)", border: "1px solid rgba(217,107,107,0.2)", borderRadius: 8, padding: "10px 14px" }}>{error}</div>}
      {headers.length > 0 && (
        knownSchema ? (
          <div style={{ fontSize: 12, background: "rgba(110,200,160,0.06)", border: "1px solid rgba(110,200,160,0.2)", borderRadius: 8, padding: "10px 14px", color: "#6EC8A0" }}>
            ✓ Распознана схема с AI-анализом. {rows.length} строк.
            <br /><span style={{ color: "#666", fontSize: 11 }}>{AI_FIELDS.filter(f => f.startsWith("ai_")).length} AI полей · thumbnail · FB Ads URL</span>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div><Label>Конкурент</Label>
              <select value={competitorCol} onChange={e => setCompetitorCol(e.target.value)}>
                <option value="">— выбери —</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div><Label>Текст объявления</Label>
              <select value={textCol} onChange={e => setTextCol(e.target.value)}>
                <option value="">— выбери —</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
        )
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
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 12, color: "#AAA", lineHeight: 1.7 }}>Автоматический сбор рекламы конкурентов через Apify + n8n → Schedule → HTTP → Code → Webhook.</div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#6EC8A0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Webhook URL</div>
        <div style={{ fontFamily: "monospace", fontSize: 11, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 12px", color: "#E8AA42", wordBreak: "break-all" }}>{webhookUrl}</div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}><Button onClick={onClose}>Закрыть</Button></div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CompetitorsPage() {
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: Concept }>({ open: false });
  const [detailConcept, setDetailConcept] = useState<Concept | null>(null);
  const [n8nModal, setN8nModal] = useState(false);
  const [sheetsModal, setSheetsModal] = useState(false);
  const [filter, setFilter] = useState<ConceptStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [generating, setGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [insightsModal, setInsightsModal] = useState(false);

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
    setConcepts(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    if (detailConcept?.id === id) setDetailConcept(prev => prev ? { ...prev, status } : null);
  };

  const handleGenerateHypothesis = async () => {
    const approved = concepts.filter(c => c.status === "approved");
    if (!approved.length) return;
    setGenerating(true); setHypothesis("");
    try { setHypothesis(await generateHypothesis(approved)); }
    finally { setGenerating(false); }
  };

  const EXCLUDED_COMPETITORS = ["booking.com", "octopus energy", "alibaba.com"];

  const filtered = concepts.filter(c => {
    const pageName = (c.rawData?.page_name ?? c.title).toLowerCase();
    if (EXCLUDED_COMPETITORS.some(e => pageName.includes(e))) return false;
    if (filter !== "all" && c.status !== filter) return false;
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

  return (
    <div>
      <PageHeader
        title="База конкурентов"
        subtitle="Анализ рекламы конкурентов"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {concepts.filter(c => c.rawData).length > 0 && (
              <Button onClick={() => setInsightsModal(true)}
                style={{ background: "rgba(196,144,209,0.1)", border: "1px solid rgba(196,144,209,0.3)", color: "#C490D1" }}>
                💡 Инсайты по параметрам
              </Button>
            )}
            <Button onClick={() => setSheetsModal(true)} style={{ border: "1px solid rgba(110,200,160,0.3)", color: "#6EC8A0", background: "rgba(110,200,160,0.08)" }}>
              📊 Импорт из Sheets
            </Button>
            <Button onClick={() => setN8nModal(true)} style={{ border: "1px solid rgba(196,144,209,0.3)", color: "#C490D1", background: "rgba(196,144,209,0.08)" }}>
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
        <div style={{ display: "flex", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden", marginRight: 4 }}>
          {(["table", "cards"] as const).map(v => (
            <button key={v} onClick={() => setViewMode(v)} style={{
              padding: "7px 14px", fontSize: 11, cursor: "pointer", fontFamily: "inherit", border: "none",
              background: viewMode === v ? "rgba(72,184,208,0.15)" : "rgba(255,255,255,0.02)",
              color: viewMode === v ? "#48B8D0" : "#555", fontWeight: viewMode === v ? 700 : 400,
            }}>{v === "table" ? "📋 Таблица" : "🗂 Карточки"}</button>
          ))}
        </div>
        {(["all", "pending", "approved", "rejected"] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: filter === s ? 700 : 400,
            cursor: "pointer", fontFamily: "inherit",
            border: filter === s ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.06)",
            background: filter === s ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
            color: filter === s ? "#E8AA42" : "#666",
          }}>
            {s === "all" ? "Все" : s === "pending" ? "Ожидают" : s === "approved" ? "Одобрены" : "Отклонены"}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск..."
          style={{ marginLeft: "auto", width: 180, fontSize: 12, padding: "6px 12px" }} />
      </div>

      {/* Content */}
      {viewMode === "table" ? (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <CompetitorTable concepts={filtered} onRowClick={setDetailConcept} onStatusChange={quickStatus} />
        </Card>
      ) : (
        filtered.length === 0 ? (
          <Empty icon="🔍" text="Нет данных." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(c => {
              const raw = c.rawData ?? {};
              const imageUrl = getImageUrl(raw);
              const competitor = raw.page_name ?? c.title;
              return (
                <Card key={c.id} onClick={() => setDetailConcept(c)} style={{
                  cursor: "pointer",
                  border: c.status === "approved" ? "1px solid rgba(110,200,160,0.2)" : c.status === "rejected" ? "1px solid rgba(217,107,107,0.1)" : "1px solid rgba(255,255,255,0.06)",
                  opacity: c.status === "rejected" ? 0.6 : 1,
                }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 56, height: 56, borderRadius: 8, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, color: "#555", flexShrink: 0 }}>
                        {competitor.slice(0, 1)}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center" }}>
                        <Badge color={STATUS_COLOR[c.status]}>{c.status === "pending" ? "Ожидает" : c.status === "approved" ? "Одобрен" : "Отклонён"}</Badge>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#DDD" }}>{competitor}</span>
                      </div>
                      {raw.ai_hook && <div style={{ fontSize: 11, color: "#C490D1", marginBottom: 3 }}>Хук: {raw.ai_hook.slice(0, 100)}</div>}
                      {raw.ai_offer && <div style={{ fontSize: 11, color: "#888" }}>Оффер: {raw.ai_offer.slice(0, 120)}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 5, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {c.status !== "approved" && <Button size="sm" variant="primary" onClick={() => quickStatus(c.id, "approved")}>✓</Button>}
                      {c.status !== "rejected" && <Button size="sm" onClick={() => quickStatus(c.id, "rejected")}>✕</Button>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {/* Detail modal */}
      <Modal
        open={!!detailConcept}
        onClose={() => setDetailConcept(null)}
        title={detailConcept?.rawData?.page_name ?? detailConcept?.title ?? "Креатив"}
      >
        {detailConcept && (
          <CreativeDetailModal
            concept={detailConcept}
            onClose={() => setDetailConcept(null)}
            onStatusChange={quickStatus}
          />
        )}
      </Modal>

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? "Редактировать" : "Новая идея"}>
        <ConceptForm initial={modal.editing} onSave={handleSave} onCancel={() => setModal({ open: false })} />
      </Modal>

      <Modal open={sheetsModal} onClose={() => setSheetsModal(false)} title="📊 Импорт из Google Sheets">
        <SheetsImportModal onClose={() => setSheetsModal(false)} onImported={reload} />
      </Modal>

      <Modal open={n8nModal} onClose={() => setN8nModal(false)} title="🔗 n8n автоматизация">
        <N8nGuideModal onClose={() => setN8nModal(false)} />
      </Modal>

      <Modal open={insightsModal} onClose={() => setInsightsModal(false)} title="💡 Инсайты по параметрам">
        <InsightsModal concepts={concepts.filter(c => c.rawData)} onClose={() => setInsightsModal(false)} />
      </Modal>
    </div>
  );
}
