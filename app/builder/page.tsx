"use client";
import { useEffect, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { personaStore, hookStore, bodyStore, angleStore, sessionStore } from "@/lib/store";
import type { Persona, Hook, Body, Angle, Format, AdFlow, ConstructorSession } from "@/lib/types";
import { Card, PageHeader, Button, Badge, Empty, SectionTitle } from "@/components/ui";
import Link from "next/link";

const FORMATS: { value: Format; label: string }[] = [
  { value: "ugc", label: "UGC" },
  { value: "static", label: "Статика" },
  { value: "animation", label: "Анимация" },
  { value: "human", label: "Human" },
  { value: "mixed", label: "Mixed" },
];

function ParamSelector<T extends { id: string; name: string; color: string; code?: string | null }>({
  label, icon, items, selected, onToggle, maxSelect = 3, codeColor,
}: {
  label: string; icon: string; items: T[]; selected: string[]; onToggle: (id: string) => void; maxSelect?: number; codeColor?: string;
}) {
  return (
    <Card>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle icon={icon}>{label}</SectionTitle>
        <Badge color={selected.length === maxSelect ? "#6EC8A0" : "#555"}>{selected.length}/{maxSelect}</Badge>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: "#444", textAlign: "center", padding: "16px 0" }}>
          Нет элементов. <Link href="/library" style={{ color: "#E8AA42" }}>Добавьте в библиотеку →</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map(item => {
            const active = selected.includes(item.id);
            const disabled = !active && selected.length >= maxSelect;
            return (
              <div
                key={item.id}
                onClick={() => !disabled && onToggle(item.id)}
                style={{
                  padding: "10px 14px", borderRadius: 10, cursor: disabled ? "not-allowed" : "pointer",
                  border: active ? `1.5px solid ${item.color}40` : "1px solid rgba(255,255,255,0.06)",
                  background: active ? `${item.color}10` : "rgba(255,255,255,0.02)",
                  opacity: disabled ? 0.35 : 1, transition: "all 0.15s",
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: active ? item.color : "#333", flexShrink: 0 }} />
                {item.code && codeColor && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: codeColor, background: `${codeColor}18`, padding: "1px 6px", borderRadius: 4, fontFamily: "monospace", flexShrink: 0 }}>{item.code}</span>
                )}
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? "#EEE" : "#888", flex: 1 }}>{item.name}</span>
                {active && <span style={{ fontSize: 10, color: item.color, fontWeight: 700 }}>✓</span>}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ConstructorContent() {
  const searchParams = useSearchParams();
  const autoRecommend = searchParams.get("autoRecommend") === "1";
  const urlFlow = searchParams.get("flow") as AdFlow | null;
  const reason = searchParams.get("reason");
  const autoTriggered = useRef(false);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [sessions, setSessions] = useState<ConstructorSession[]>([]);

  const [selected, setSelected] = useState({ personas: [] as string[], hooks: [] as string[], bodies: [] as string[], angles: [] as string[] });
  const [format, setFormat] = useState<Format>("ugc");
  const [flow, setFlow] = useState<AdFlow>(urlFlow ?? "com");
  const [sessionName, setSessionName] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReasoning, setAiReasoning] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const [p, h, b, a, s] = await Promise.all([
        personaStore.getAll(), hookStore.getAll(), bodyStore.getAll(), angleStore.getAll(), sessionStore.getAll(),
      ]);
      setPersonas(p); setHooks(h); setBodies(b); setAngles(a);
      setSessions(s.slice().reverse());

      if (autoRecommend && !autoTriggered.current) {
        autoTriggered.current = true;
        const currentFlow = urlFlow ?? "com";
        setAiLoading(true);
        setAiReasoning(null);
        setAiError(null);
        try {
          const res = await fetch("/api/ai/recommend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ personas: p, hooks: h, bodies: b, angles: a, flow: currentFlow }),
          });
          const data = await res.json();
          if (data.error) { setAiError(data.error); return; }
          if (data.personas && data.hooks && data.bodies && data.angles) {
            setSelected({ personas: data.personas, hooks: data.hooks, bodies: data.bodies, angles: data.angles });
            if (data.reasoning) setAiReasoning(data.reasoning);
          }
        } catch (e) {
          setAiError(e instanceof Error ? e.message : String(e));
        } finally {
          setAiLoading(false);
        }
      }
    };
    load();
  }, []);

  const toggle = (type: keyof typeof selected) => (id: string) => {
    setSelected(prev => {
      const arr = prev[type];
      return { ...prev, [type]: arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id] };
    });
  };

  const total = selected.personas.length * selected.hooks.length * selected.bodies.length * selected.angles.length;

  const handleAiRecommend = async () => {
    setAiLoading(true);
    setAiReasoning(null);
    setAiError(null);
    try {
      const [allPersonas, allHooks, allBodies, allAngles] = await Promise.all([
        personaStore.getAll(), hookStore.getAll(), bodyStore.getAll(), angleStore.getAll(),
      ]);
      const res = await fetch("/api/ai/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personas: allPersonas, hooks: allHooks, bodies: allBodies, angles: allAngles, flow }),
      });
      const data = await res.json();
      if (data.error) { setAiError(data.error); return; }
      if (data.personas && data.hooks && data.bodies && data.angles) {
        setSelected({ personas: data.personas, hooks: data.hooks, bodies: data.bodies, angles: data.angles });
        if (data.reasoning) setAiReasoning(data.reasoning);
      }
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!sessionName.trim() || total === 0) return;
    const session = await sessionStore.save({
      name: sessionName,
      flow,
      selectedPersonas: selected.personas,
      selectedHooks: selected.hooks,
      selectedBodies: selected.bodies,
      selectedAngles: selected.angles,
      format,
      totalCombinations: total,
      status: "draft",
    });
    setSessions((await sessionStore.getAll()).slice().reverse());
    setSessionName("");
    alert(`Сессия "${session.name}" создана! Перейдите в Сценарии для написания базовых сценариев.`);
  };

  return (
    <div>
      <PageHeader
        title="Конструктор"
        subtitle="Выберите параметры для матрицы креативов"
        action={
          <Button variant="secondary" onClick={handleAiRecommend} disabled={aiLoading}>
            {aiLoading ? "⏳ Загрузка..." : "✨ AI рекомендует"}
          </Button>
        }
      />

      {/* Pack dying banner */}
      {reason === "pack_dying" && (
        <div style={{
          marginBottom: 16, padding: "14px 18px", borderRadius: 10,
          background: "rgba(217,107,107,0.08)", border: "1px solid rgba(217,107,107,0.3)",
          display: "flex", alignItems: "center", gap: 14,
        }}>
          <div style={{ fontSize: 22 }}>🔴</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#D96B6B", marginBottom: 2 }}>
              Пак умирает — время запустить новый производственный цикл
            </div>
            <div style={{ fontSize: 11, color: "#888" }}>
              AI уже составил рекомендацию на основе текущей аналитики. Проверьте и скорректируйте при необходимости.
            </div>
          </div>
          {aiLoading && (
            <div style={{ fontSize: 11, color: "#D96B6B", marginLeft: "auto", whiteSpace: "nowrap" }}>
              ⏳ AI анализирует...
            </div>
          )}
        </div>
      )}

      {/* Flow */}
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="🌐">Поток</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          {([["com", "Коммерческий (COM)", "#E8AA42"], ["gov", "Госники (GOV)", "#48B8D0"]] as const).map(([v, label, color]) => (
            <button key={v} onClick={() => setFlow(v)} style={{
              padding: "8px 20px", borderRadius: 8, fontFamily: "inherit", fontSize: 12, fontWeight: flow === v ? 700 : 400,
              cursor: "pointer", border: flow === v ? `1.5px solid ${color}40` : "1px solid rgba(255,255,255,0.06)",
              background: flow === v ? `${color}12` : "rgba(255,255,255,0.02)", color: flow === v ? color : "#666",
            }}>
              {label}
            </button>
          ))}
        </div>
      </Card>

      {/* Format */}
      <Card style={{ marginBottom: 16 }}>
        <SectionTitle icon="🎬">Формат</SectionTitle>
        <div style={{ display: "flex", gap: 8 }}>
          {FORMATS.map(f => (
            <button key={f.value} onClick={() => setFormat(f.value)} style={{
              padding: "8px 16px", borderRadius: 8, fontFamily: "inherit", fontSize: 12, fontWeight: format === f.value ? 700 : 400,
              cursor: "pointer", border: format === f.value ? "1.5px solid rgba(232,170,66,0.4)" : "1px solid rgba(255,255,255,0.06)",
              background: format === f.value ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)", color: format === f.value ? "#E8AA42" : "#666",
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </Card>

      {/* AI reasoning */}
      {aiReasoning && (
        <Card style={{ marginBottom: 16, background: "rgba(110,200,160,0.04)", border: "1px solid rgba(110,200,160,0.2)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ fontSize: 18, flexShrink: 0 }}>🧠</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#6EC8A0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                AI объясняет выбор
              </div>
              <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.7 }}>{aiReasoning}</div>
            </div>
            <button onClick={() => setAiReasoning(null)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
          </div>
        </Card>
      )}
      {aiError && (
        <Card style={{ marginBottom: 16, background: "rgba(217,107,107,0.04)", border: "1px solid rgba(217,107,107,0.2)" }}>
          <div style={{ fontSize: 12, color: "#D96B6B" }}>Ошибка рекомендации: {aiError}</div>
        </Card>
      )}

      {/* Parameter selectors */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <ParamSelector label="Персоны" icon="👤" items={personas} selected={selected.personas} onToggle={toggle("personas")} codeColor="#48B8D0" />
        <ParamSelector label="Хуки" icon="🎣" items={hooks} selected={selected.hooks} onToggle={toggle("hooks")} codeColor="#C490D1" />
        <ParamSelector label="Боди" icon="📝" items={bodies} selected={selected.bodies} onToggle={toggle("bodies")} codeColor="#6EC8A0" />
        <ParamSelector label="Энглы" icon="🎯" items={angles} selected={selected.angles} onToggle={toggle("angles")} codeColor="#FF8B5A" />
      </div>

      {/* Summary */}
      <Card style={{ background: total > 0 ? "rgba(232,170,66,0.04)" : undefined, border: total > 0 ? "1px solid rgba(232,170,66,0.15)" : undefined, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, color: total > 0 ? "#E8AA42" : "#333" }}>{total}</div>
            <div style={{ fontSize: 11, color: "#555" }}>комбинаций</div>
          </div>
          <div style={{ flex: 1, fontSize: 13, color: "#666" }}>
            {selected.personas.length}п × {selected.hooks.length}х × {selected.bodies.length}б × {selected.angles.length}э = {total} уникальных вариаций
            {total > 0 && <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>= {selected.personas.length + selected.hooks.length + selected.bodies.length + selected.angles.length} базовых сценариев → {total} адаптированных брифов</div>}
          </div>
          {total > 0 && (
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                value={sessionName}
                onChange={e => setSessionName(e.target.value)}
                placeholder="Название сессии..."
                style={{ width: 200 }}
              />
              <Button variant="primary" onClick={handleSave} disabled={!sessionName.trim()}>
                💾 Сохранить сессию
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Sessions history */}
      {sessions.length > 0 && (
        <div>
          <SectionTitle icon="📂">Сохранённые сессии</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sessions.map(s => (
              <Card key={s.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#DDD", marginBottom: 4 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#555" }}>
                      {s.selectedPersonas.length}п × {s.selectedHooks.length}х × {s.selectedBodies.length}б × {s.selectedAngles.length}э = {s.totalCombinations} комб.
                    </div>
                  </div>
                  <Badge color={s.status === "done" ? "#6EC8A0" : s.status === "generating" ? "#E8AA42" : "#555"}>
                    {s.status === "done" ? "Готово" : s.status === "generating" ? "Генерация..." : s.status === "scenarios" ? "Сценарии" : "Черновик"}
                  </Badge>
                  <Badge color={(s.flow ?? "com") === "com" ? "#E8AA42" : "#48B8D0"}>{(s.flow ?? "com").toUpperCase()}</Badge>
                  <Badge color="#555">{s.format.toUpperCase()}</Badge>
                  <Link href={`/scenarios?session=${s.id}`}>
                    <Button size="sm" variant="primary">Сценарии →</Button>
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {personas.length === 0 && hooks.length === 0 && (
        <Empty icon="📚" text="Библиотека пуста. Сначала добавьте параметры в библиотеку." />
      )}
    </div>
  );
}

export default function ConstructorPage() {
  return (
    <Suspense fallback={<div style={{ color: "#555", padding: 40 }}>Загрузка...</div>}>
      <ConstructorContent />
    </Suspense>
  );
}
