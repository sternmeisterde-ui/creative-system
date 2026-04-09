"use client";
import { useEffect, useState, useCallback } from "react";
import { personaStore, hookStore, bodyStore, angleStore } from "@/lib/store";
import type { Persona, Hook, Body, Angle } from "@/lib/types";
import { Card, PageHeader, Button, Badge, Modal, Label, Empty, ColorDot, SectionTitle } from "@/components/ui";

const COLORS = ["#48B8D0", "#C490D1", "#6EC8A0", "#E8AA42", "#FF8B5A", "#D96B6B", "#7B8CDE", "#E88BA0"];

type Tab = "personas" | "hooks" | "bodies" | "angles";

const TAB_META: Record<Tab, { label: string; color: string; icon: string }> = {
  personas: { label: "Персоны", color: "#48B8D0", icon: "👤" },
  hooks: { label: "Хуки", color: "#C490D1", icon: "🎣" },
  bodies: { label: "Боди", color: "#6EC8A0", icon: "📝" },
  angles: { label: "Энглы", color: "#FF8B5A", icon: "🎯" },
};

// ── Persona Form ───────────────────────────────────────────────────────────────

function PersonaForm({ initial, onSave, onCancel }: {
  initial?: Partial<Persona>;
  onSave: (data: Omit<Persona, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    short: initial?.short || "",
    description: initial?.description || "",
    pointA: initial?.pointA || "",
    pointB: initial?.pointB || "",
    pains: (initial?.pains || []).join("\n"),
    triggers: (initial?.triggers || []).join("\n"),
    age: initial?.age || "",
    gender: initial?.gender || "",
    color: initial?.color || COLORS[0],
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const submit = () => {
    if (!form.name.trim()) return;
    onSave({
      ...form,
      pains: form.pains.split("\n").filter(Boolean),
      triggers: form.triggers.split("\n").filter(Boolean),
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><Label>Название *</Label><input value={form.name} onChange={f("name")} placeholder="Бухгалтер из СНГ" /></div>
        <div><Label>Короткое</Label><input value={form.short} onChange={f("short")} placeholder="Возврат статуса" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><Label>Возраст</Label><input value={form.age} onChange={f("age")} placeholder="35–50 лет" /></div>
        <div><Label>Пол</Label>
          <select value={form.gender} onChange={f("gender")}>
            <option value="">Не указан</option>
            <option value="male">Мужской</option>
            <option value="female">Женский</option>
            <option value="any">Любой</option>
          </select>
        </div>
      </div>
      <div><Label>Описание</Label><textarea value={form.description} onChange={f("description")} placeholder="Кто это, откуда, ситуация..." /></div>
      <div><Label>Точка А (текущая ситуация)</Label><textarea value={form.pointA} onChange={f("pointA")} placeholder="Что сейчас происходит в жизни персоны..." /></div>
      <div><Label>Точка Б (желаемый результат)</Label><textarea value={form.pointB} onChange={f("pointB")} placeholder="Чего хочет достичь..." /></div>
      <div><Label>Боли (каждая с новой строки)</Label><textarea value={form.pains} onChange={f("pains")} placeholder="Низкая зарплата&#10;Нет карьерных перспектив&#10;..." /></div>
      <div><Label>Триггеры (каждый с новой строки)</Label><textarea value={form.triggers} onChange={f("triggers")} placeholder="Увидел знакомого с новой профессией&#10;Потерял работу&#10;..." /></div>
      <div>
        <Label>Цвет</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {COLORS.map(c => (
            <div key={c} onClick={() => setForm(p => ({ ...p, color: c }))} style={{ width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent" }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button onClick={submit} variant="primary">Сохранить</Button>
      </div>
    </div>
  );
}

// ── Hook / Body / Angle Form ───────────────────────────────────────────────────

function ParamForm({ type, initial, onSave, onCancel }: {
  type: "hook" | "body" | "angle";
  initial?: Partial<Hook | Body | Angle>;
  onSave: (data: Omit<Hook | Body | Angle, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    template: (initial as Hook)?.template || "",
    description: initial?.description || "",
    examples: ((initial as Hook)?.examples || []).join("\n"),
    color: initial?.color || COLORS[1],
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const labels: Record<string, { template: string; examples: string }> = {
    hook: { template: "Шаблон хука", examples: "Примеры формулировок" },
    body: { template: "Шаблон боди", examples: "Примеры" },
    angle: { template: "Шаблон угла подачи", examples: "Примеры" },
  };

  const submit = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, examples: form.examples.split("\n").filter(Boolean) });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div><Label>Название *</Label><input value={form.name} onChange={f("name")} placeholder="Название..." /></div>
      <div><Label>Описание</Label><textarea value={form.description} onChange={f("description")} placeholder="Что это, когда использовать..." /></div>
      <div><Label>{labels[type].template}</Label><textarea value={form.template} onChange={f("template")} placeholder="Базовый шаблон/структура..." style={{ minHeight: 100 }} /></div>
      <div><Label>{labels[type].examples} (каждый с новой строки)</Label><textarea value={form.examples} onChange={f("examples")} placeholder="Пример 1&#10;Пример 2&#10;..." /></div>
      <div>
        <Label>Цвет</Label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {COLORS.map(c => (
            <div key={c} onClick={() => setForm(p => ({ ...p, color: c }))} style={{ width: 24, height: 24, borderRadius: "50%", background: c, cursor: "pointer", border: form.color === c ? "2px solid white" : "2px solid transparent" }} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button onClick={submit} variant="primary">Сохранить</Button>
      </div>
    </div>
  );
}

// ── Persona Card ───────────────────────────────────────────────────────────────

function PersonaCard({ p, onEdit, onDelete }: { p: Persona; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={{ border: `1px solid ${p.color}18` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ColorDot color={p.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {p.code && <span style={{ fontSize: 11, fontWeight: 700, color: "#48B8D0", background: "rgba(72,184,208,0.12)", padding: "1px 7px", borderRadius: 5, fontFamily: "monospace" }}>{p.code}</span>}
            <span style={{ fontSize: 13, fontWeight: 700, color: "#DDD" }}>{p.name}</span>
            {p.short && <Badge color={p.color}>{p.short}</Badge>}
            {p.gender && <Badge color="#555">{p.gender === "male" ? "М" : p.gender === "female" ? "Ж" : "М/Ж"}</Badge>}
            {p.age && <Badge color="#555">{p.age}</Badge>}
          </div>
          {p.description && <div style={{ fontSize: 12, color: "#777", lineHeight: 1.5 }}>{p.description}</div>}
          {expanded && (
            <div style={{ marginTop: 12 }}>
              {p.pointA && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 10, color: "#555", fontWeight: 700 }}>ТОЧКА А: </span><span style={{ fontSize: 12, color: "#888" }}>{p.pointA}</span></div>}
              {p.pointB && <div style={{ marginBottom: 8 }}><span style={{ fontSize: 10, color: "#555", fontWeight: 700 }}>ТОЧКА Б: </span><span style={{ fontSize: 12, color: "#888" }}>{p.pointB}</span></div>}
              {p.pains.length > 0 && <div style={{ marginBottom: 8 }}><div style={{ fontSize: 10, color: "#D96B6B", fontWeight: 700, marginBottom: 4 }}>БОЛИ:</div>{p.pains.map((x, i) => <div key={i} style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>• {x}</div>)}</div>}
              {p.triggers.length > 0 && <div><div style={{ fontSize: 10, color: "#6EC8A0", fontWeight: 700, marginBottom: 4 }}>ТРИГГЕРЫ:</div>{p.triggers.map((x, i) => <div key={i} style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>• {x}</div>)}</div>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <Button size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Свернуть" : "Подробнее"}</Button>
          <Button size="sm" onClick={onEdit}>Изменить</Button>
          <Button size="sm" variant="danger" onClick={onDelete}>✕</Button>
        </div>
      </div>
    </Card>
  );
}

// ── Param Card ─────────────────────────────────────────────────────────────────

function ParamCard({ item, codeColor, onEdit, onDelete }: { item: Hook | Body | Angle; codeColor: string; onEdit: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card style={{ border: `1px solid ${item.color}18` }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <ColorDot color={item.color} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            {item.code && <span style={{ fontSize: 11, fontWeight: 700, color: codeColor, background: `${codeColor}20`, padding: "1px 7px", borderRadius: 5, fontFamily: "monospace" }}>{item.code}</span>}
            <span style={{ fontSize: 13, fontWeight: 700, color: "#DDD" }}>{item.name}</span>
          </div>
          {item.description && <div style={{ fontSize: 12, color: "#777", lineHeight: 1.5 }}>{item.description}</div>}
          {expanded && item.template && (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(255,255,255,0.03)", borderRadius: 8, fontSize: 12, color: "#888", fontFamily: "monospace", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
              {item.template}
            </div>
          )}
          {expanded && item.examples.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: "#555", fontWeight: 700, marginBottom: 4 }}>ПРИМЕРЫ:</div>
              {item.examples.map((e, i) => <div key={i} style={{ fontSize: 12, color: "#888", marginBottom: 3, padding: "4px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>«{e}»</div>)}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <Button size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? "Свернуть" : "Детали"}</Button>
          <Button size="sm" onClick={onEdit}>Изменить</Button>
          <Button size="sm" variant="danger" onClick={onDelete}>✕</Button>
        </div>
      </div>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const [tab, setTab] = useState<Tab>("personas");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: Persona | Hook | Body | Angle }>({ open: false });
  const [assigning, setAssigning] = useState(false);

  const reload = useCallback(async () => {
    setPersonas(await personaStore.getAll());
    setHooks(await hookStore.getAll());
    setBodies(await bodyStore.getAll());
    setAngles(await angleStore.getAll());
  }, []);

  useEffect(() => {
    const load = async () => { await reload(); };
    load();
  }, [reload]);

  const handleSavePersona = async (data: Omit<Persona, "id" | "createdAt">) => {
    if (modal.editing) await personaStore.update(modal.editing.id, data);
    else await personaStore.save(data);
    setModal({ open: false });
    await reload();
  };

  const handleSaveParam = async (data: Omit<Hook | Body | Angle, "id" | "createdAt">) => {
    if (tab === "hooks") { if (modal.editing) await hookStore.update(modal.editing.id, data); else await hookStore.save(data as Omit<Hook, "id" | "createdAt">); }
    if (tab === "bodies") { if (modal.editing) await bodyStore.update(modal.editing.id, data); else await bodyStore.save(data as Omit<Body, "id" | "createdAt">); }
    if (tab === "angles") { if (modal.editing) await angleStore.update(modal.editing.id, data); else await angleStore.save(data as Omit<Angle, "id" | "createdAt">); }
    setModal({ open: false });
    await reload();
  };

  const assignCodes = async () => {
    setAssigning(true);
    try {
      await fetch("/api/naming/assign", { method: "POST" });
      await reload();
    } finally {
      setAssigning(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (tab === "personas") await personaStore.delete(id);
    if (tab === "hooks") await hookStore.delete(id);
    if (tab === "bodies") await bodyStore.delete(id);
    if (tab === "angles") await angleStore.delete(id);
    await reload();
  };

  const isEmpty = personas.length === 0 && hooks.length === 0 && bodies.length === 0 && angles.length === 0;
  const items = { personas, hooks, bodies, angles }[tab];
  const meta = TAB_META[tab];

  return (
    <div>
      <PageHeader
        title="Библиотека параметров"
        subtitle="Персоны, хуки, боди и энглы для конструктора"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={assignCodes} disabled={assigning}>{assigning ? "Назначаем..." : "🏷 Назначить коды"}</Button>
            <Button variant="primary" onClick={() => setModal({ open: true })}>+ Добавить {meta.label.toLowerCase().replace("ы", "у").replace("и", "")}</Button>
          </div>
        }
      />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: 4 }}>
        {(Object.entries(TAB_META) as [Tab, typeof TAB_META[Tab]][]).map(([key, m]) => {
          const count = { personas: personas.length, hooks: hooks.length, bodies: bodies.length, angles: angles.length }[key];
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)} style={{
              flex: 1, padding: "9px 12px", borderRadius: 8, border: active ? `1px solid ${m.color}25` : "1px solid transparent",
              background: active ? `${m.color}10` : "transparent", color: active ? m.color : "#555", fontSize: 12, fontWeight: active ? 700 : 400,
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              {m.icon} {m.label} <span style={{ fontSize: 10, opacity: 0.7 }}>({count})</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <SectionTitle color={meta.color} icon={meta.icon}>{meta.label}</SectionTitle>

      {items.length === 0 ? (
        <Empty icon={meta.icon} text={`Нет ${meta.label.toLowerCase()}. Добавьте первую.`} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {tab === "personas" && personas.map(p => (
            <PersonaCard key={p.id} p={p} onEdit={() => setModal({ open: true, editing: p })} onDelete={() => deleteItem(p.id)} />
          ))}
          {tab !== "personas" && (items as (Hook | Body | Angle)[]).map(item => (
            <ParamCard key={item.id} item={item} codeColor={meta.color} onEdit={() => setModal({ open: true, editing: item })} onDelete={() => deleteItem(item.id)} />
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? `Изменить` : `Новая ${meta.label.toLowerCase().slice(0, -1)}а`}>
        {tab === "personas" ? (
          <PersonaForm initial={modal.editing as Persona} onSave={handleSavePersona} onCancel={() => setModal({ open: false })} />
        ) : (
          <ParamForm type={tab as "hook" | "body" | "angle"} initial={modal.editing as Hook} onSave={handleSaveParam} onCancel={() => setModal({ open: false })} />
        )}
      </Modal>
    </div>
  );
}
