"use client";
import { useEffect, useState, useCallback } from "react";
import { creativeStore, personaStore, hookStore, bodyStore, angleStore } from "@/lib/store";
import type { Creative, Persona, Hook, Body, Angle, Format, WinnerStatus, Source } from "@/lib/types";
import { Card, PageHeader, Button, Badge, Modal, Label, Empty, SectionTitle } from "@/components/ui";

const FORMATS: Format[] = ["ugc", "static", "animation", "human", "mixed"];
const STATUS_COLORS: Record<WinnerStatus, string> = { winner: "#6EC8A0", loser: "#D96B6B", unknown: "#555", testing: "#E8AA42" };
const STATUS_LABELS: Record<WinnerStatus, string> = { winner: "Виннер", loser: "Лузер", unknown: "Неизвестно", testing: "Тестирование" };

function CreativeForm({ personas, hooks, bodies, angles, initial, onSave, onCancel }: {
  personas: Persona[]; hooks: Hook[]; bodies: Body[]; angles: Angle[];
  initial?: Partial<Creative>; onSave: (data: Omit<Creative, "id" | "createdAt">) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({
    source: (initial?.source || "internal") as Source,
    personaId: initial?.personaId || "",
    hookId: initial?.hookId || "",
    bodyId: initial?.bodyId || "",
    angleId: initial?.angleId || "",
    format: (initial?.format || "ugc") as Format,
    status: (initial?.status || "unknown") as WinnerStatus,
    description: initial?.description || "",
    notes: initial?.notes || "",
    competitorName: initial?.competitorName || "",
    rawText: initial?.rawText || "",
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    onSave({ ...form });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><Label>Источник</Label>
          <select value={form.source} onChange={f("source")}>
            <option value="internal">Наш</option>
            <option value="competitor">Конкурент</option>
          </select>
        </div>
        <div><Label>Статус</Label>
          <select value={form.status} onChange={f("status")}>
            <option value="unknown">Неизвестно</option>
            <option value="testing">Тестирование</option>
            <option value="winner">Виннер</option>
            <option value="loser">Лузер</option>
          </select>
        </div>
      </div>

      {form.source === "competitor" && (
        <div><Label>Название конкурента</Label><input value={form.competitorName} onChange={f("competitorName")} placeholder="Competitor name..." /></div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><Label>Персона</Label>
          <select value={form.personaId} onChange={f("personaId")}>
            <option value="">— не выбрана —</option>
            {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><Label>Формат</Label>
          <select value={form.format} onChange={f("format")}>
            {FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><Label>Хук</Label>
          <select value={form.hookId} onChange={f("hookId")}>
            <option value="">— не выбран —</option>
            {hooks.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div><Label>Боди</Label>
          <select value={form.bodyId} onChange={f("bodyId")}>
            <option value="">— не выбрано —</option>
            {bodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      </div>

      <div><Label>Энгл</Label>
        <select value={form.angleId} onChange={f("angleId")}>
          <option value="">— не выбран —</option>
          {angles.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div><Label>Описание / сценарий</Label><textarea value={form.description} onChange={f("description")} /></div>
      {form.source === "competitor" && <div><Label>Текст / транскрипция</Label><textarea value={form.rawText} onChange={f("rawText")} placeholder="Текст на картинке или транскрипция видео..." /></div>}
      <div><Label>Заметки</Label><textarea value={form.notes} onChange={f("notes")} style={{ minHeight: 60 }} /></div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="primary" onClick={submit}>Сохранить</Button>
      </div>
    </div>
  );
}

export default function DatabasePage() {
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: Creative }>({ open: false });
  const [filter, setFilter] = useState<WinnerStatus | "all">("all");
  const [source, setSource] = useState<Source | "all">("all");

  const reload = useCallback(async () => {
    setCreatives((await creativeStore.getAll()).reverse());
    setPersonas(await personaStore.getAll());
    setHooks(await hookStore.getAll());
    setBodies(await bodyStore.getAll());
    setAngles(await angleStore.getAll());
  }, []);

  useEffect(() => {
    const load = async () => { await reload(); };
    load();
  }, [reload]);

  const nameMap = {
    personas: Object.fromEntries(personas.map(p => [p.id, p.name])),
    hooks: Object.fromEntries(hooks.map(h => [h.id, h.name])),
    bodies: Object.fromEntries(bodies.map(b => [b.id, b.name])),
    angles: Object.fromEntries(angles.map(a => [a.id, a.name])),
  };

  const filtered = creatives.filter(c => {
    if (filter !== "all" && c.status !== filter) return false;
    if (source !== "all" && c.source !== source) return false;
    return true;
  });

  const handleSave = async (data: Omit<Creative, "id" | "createdAt">) => {
    if (modal.editing) await creativeStore.update(modal.editing.id, data);
    else await creativeStore.save(data);
    setModal({ open: false });
    await reload();
  };

  const stats = {
    total: creatives.length,
    winners: creatives.filter(c => c.status === "winner").length,
    losers: creatives.filter(c => c.status === "loser").length,
    internal: creatives.filter(c => c.source === "internal").length,
    competitor: creatives.filter(c => c.source === "competitor").length,
  };

  return (
    <div>
      <PageHeader
        title="База данных креативов"
        subtitle="Виннеры, лузеры, конкуренты"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="primary" onClick={() => setModal({ open: true })}>+ Добавить креатив</Button>
          </div>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Всего", value: stats.total, color: "#E8AA42" },
          { label: "Виннеров", value: stats.winners, color: "#6EC8A0" },
          { label: "Лузеров", value: stats.losers, color: "#D96B6B" },
          { label: "Наших", value: stats.internal, color: "#48B8D0" },
          { label: "Конкурентов", value: stats.competitor, color: "#C490D1" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {(["all", "winner", "loser", "testing", "unknown"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: filter === f ? 700 : 400, cursor: "pointer",
            border: filter === f ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.06)",
            background: filter === f ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)", color: filter === f ? "#E8AA42" : "#666", fontFamily: "inherit",
          }}>
            {f === "all" ? "Все" : STATUS_LABELS[f]}
          </button>
        ))}
        <div style={{ width: 1, background: "rgba(255,255,255,0.06)" }} />
        {(["all", "internal", "competitor"] as const).map(s => (
          <button key={s} onClick={() => setSource(s)} style={{
            padding: "7px 14px", borderRadius: 8, fontSize: 11, fontWeight: source === s ? 700 : 400, cursor: "pointer",
            border: source === s ? "1px solid rgba(72,184,208,0.3)" : "1px solid rgba(255,255,255,0.06)",
            background: source === s ? "rgba(72,184,208,0.1)" : "rgba(255,255,255,0.02)", color: source === s ? "#48B8D0" : "#666", fontFamily: "inherit",
          }}>
            {s === "all" ? "Все источники" : s === "internal" ? "Наши" : "Конкуренты"}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty icon="🗄" text="Нет креативов в базе. Добавьте первый." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map(c => (
            <Card key={c.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Badge color={STATUS_COLORS[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                <Badge color={c.source === "internal" ? "#48B8D0" : "#C490D1"}>{c.source === "internal" ? "Наш" : "Конкурент"}</Badge>
                <Badge color="#555">{c.format.toUpperCase()}</Badge>
                {c.metaAdName && (
                  <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: "#E8AA42", background: "rgba(232,170,66,0.1)", padding: "2px 8px", borderRadius: 5 }}>
                    {c.metaAdName}
                  </span>
                )}
                {!c.metaAdName && c.personaId && <Badge color="#48B8D018">{nameMap.personas[c.personaId] || "?"}</Badge>}
                {!c.metaAdName && c.hookId && <span style={{ fontSize: 11, color: "#555" }}>· {nameMap.hooks[c.hookId] || "?"}</span>}
                <div style={{ flex: 1 }} />
                {c.competitorName && <span style={{ fontSize: 11, color: "#555" }}>{c.competitorName}</span>}
                <Button size="sm" onClick={() => setModal({ open: true, editing: c })}>Изменить</Button>
              </div>
              {c.description && <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>{c.description.slice(0, 120)}{c.description.length > 120 ? "…" : ""}</div>}
            </Card>
          ))}
        </div>
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? "Изменить креатив" : "Новый креатив"}>
        <CreativeForm
          personas={personas} hooks={hooks} bodies={bodies} angles={angles}
          initial={modal.editing}
          onSave={handleSave}
          onCancel={() => setModal({ open: false })}
        />
      </Modal>
    </div>
  );
}
