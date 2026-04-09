"use client";
import { useEffect, useState, useCallback } from "react";
import { ruleStore } from "@/lib/store";
import type { Rule } from "@/lib/types";
import { Card, PageHeader, Button, Badge, Modal, Label, Empty, SectionTitle } from "@/components/ui";

const CATEGORIES: { value: Rule["category"]; label: string; color: string }[] = [
  { value: "general", label: "Общие", color: "#E8AA42" },
  { value: "adaptation", label: "Адаптация", color: "#48B8D0" },
  { value: "persona", label: "Персона", color: "#D96B6B" },
  { value: "hook", label: "Хук", color: "#C490D1" },
  { value: "body", label: "Боди", color: "#6EC8A0" },
  { value: "angle", label: "Энгл", color: "#FF8B5A" },
];

function RuleForm({ initial, onSave, onCancel }: {
  initial?: Partial<Rule>;
  onSave: (data: Omit<Rule, "id" | "createdAt">) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: initial?.title || "",
    content: initial?.content || "",
    category: (initial?.category || "general") as Rule["category"],
    active: initial?.active !== false,
  });

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div><Label>Название правила *</Label><input value={form.title} onChange={f("title")} placeholder="Например: Адаптация пола под персону" /></div>
      <div><Label>Категория</Label>
        <select value={form.category} onChange={f("category")}>
          {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <Label>Текст правила *</Label>
        <textarea value={form.content} onChange={f("content")} placeholder="Напишите правило для AI-агента..." style={{ minHeight: 120 }} />
        <div style={{ fontSize: 11, color: "#444", marginTop: 4 }}>Это правило автоматически добавляется в промпт AI при генерации брифов</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <input type="checkbox" id="active" checked={form.active} onChange={e => setForm(p => ({ ...p, active: e.target.checked }))} style={{ width: "auto" }} />
        <label htmlFor="active" style={{ fontSize: 12, color: "#AAA", cursor: "pointer" }}>Правило активно</label>
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="primary" onClick={() => { if (!form.title || !form.content) return; onSave(form); }}>Сохранить</Button>
      </div>
    </div>
  );
}

const DEFAULT_RULES: Omit<Rule, "id" | "createdAt">[] = [
  { title: "Адаптация пола и возраста", category: "adaptation", active: true, content: "Всегда адаптируй пол и возраст персонажа в хуке и боди под данную персону. Если персона — мужчина, убери женские формулировки и замени на мужские. Если женщина — наоборот. Сохраняй смысл и направление сценария." },
  { title: "Профессиональный контекст в хуке", category: "hook", active: true, content: "Хук должен отражать профессиональный или жизненный контекст персоны. Если персона работает на складе, хук должен упоминать физический труд или похожую ситуацию, а не офисную работу." },
  { title: "Связность всех параметров", category: "adaptation", active: true, content: "Все параметры (хук, боди, энгл) должны быть связаны единой историей и персоной. Не допускай противоречий между параметрами. Тон и контекст должны быть одинаковыми во всём брифе." },
  { title: "Первое лицо для UGC", category: "adaptation", active: true, content: "Для формата UGC все сценарии должны быть написаны от первого лица (я, мне, у меня). Для других форматов можно использовать второе или третье лицо." },
  { title: "Конкретные цифры и факты", category: "general", active: true, content: "Всегда используй конкретные цифры из контекста (зарплата, срок обучения, количество выпускников). Не используй расплывчатые формулировки типа 'хорошая зарплата' — замени на конкретные €3200/мес или аналогичное." },
];

export default function AdminPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [modal, setModal] = useState<{ open: boolean; editing?: Rule }>({ open: false });

  const reload = useCallback(async () => {
    setRules(await ruleStore.getAll());
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const handleSave = async (data: Omit<Rule, "id" | "createdAt">) => {
    if (modal.editing) await ruleStore.update(modal.editing.id, data);
    else await ruleStore.save(data);
    setModal({ open: false });
    reload();
  };

  const toggleActive = async (id: string, active: boolean) => {
    await ruleStore.update(id, { active });
    reload();
  };

  const loadDefaults = async () => {
    await Promise.all(DEFAULT_RULES.map(r => ruleStore.save(r)));
    reload();
  };

  const activeCount = rules.filter(r => r.active).length;

  return (
    <div>
      <PageHeader
        title="Правила & Скиллы"
        subtitle="Управляйте правилами, которые AI использует при генерации брифов"
        action={
          <div style={{ display: "flex", gap: 8 }}>
            {rules.length === 0 && <Button onClick={loadDefaults}>📥 Загрузить базовые правила</Button>}
            <Button variant="primary" onClick={() => setModal({ open: true })}>+ Новое правило</Button>
          </div>
        }
      />

      <Card style={{ marginBottom: 20, display: "flex", gap: 24, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#E8AA42" }}>{rules.length}</div>
          <div style={{ fontSize: 11, color: "#555" }}>Всего правил</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#6EC8A0" }}>{activeCount}</div>
          <div style={{ fontSize: 11, color: "#555" }}>Активных</div>
        </div>
        <div style={{ fontSize: 12, color: "#666", flex: 1 }}>
          Активные правила автоматически добавляются в системный промпт AI при генерации брифов.
        </div>
      </Card>

      {CATEGORIES.map(cat => {
        const catRules = rules.filter(r => r.category === cat.value);
        if (catRules.length === 0) return null;
        return (
          <div key={cat.value} style={{ marginBottom: 20 }}>
            <SectionTitle color={cat.color}>{cat.label}</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {catRules.map(rule => (
                <Card key={rule.id} style={{ border: `1px solid ${rule.active ? cat.color + "18" : "rgba(255,255,255,0.04)"}`, opacity: rule.active ? 1 : 0.5 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: rule.active ? "#DDD" : "#666" }}>{rule.title}</span>
                        <Badge color={cat.color}>{cat.label}</Badge>
                        {!rule.active && <Badge color="#555">Отключено</Badge>}
                      </div>
                      <div style={{ fontSize: 12, color: "#777", lineHeight: 1.6 }}>{rule.content}</div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <Button size="sm" variant={rule.active ? "secondary" : "primary"} onClick={() => toggleActive(rule.id, !rule.active)}>
                        {rule.active ? "Откл." : "Вкл."}
                      </Button>
                      <Button size="sm" onClick={() => setModal({ open: true, editing: rule })}>Изменить</Button>
                      <Button size="sm" variant="danger" onClick={async () => { await ruleStore.delete(rule.id); reload(); }}>✕</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        );
      })}

      {rules.length === 0 && (
        <Empty icon="⚙️" text="Нет правил. Загрузите базовые или добавьте своё." />
      )}

      <Modal open={modal.open} onClose={() => setModal({ open: false })} title={modal.editing ? "Изменить правило" : "Новое правило"}>
        <RuleForm initial={modal.editing} onSave={handleSave} onCancel={() => setModal({ open: false })} />
      </Modal>
    </div>
  );
}
