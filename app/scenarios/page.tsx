"use client";
import { useEffect, useState, useCallback, useRef, Suspense, type RefObject } from "react";
import { useSearchParams } from "next/navigation";
import { personaStore, hookStore, bodyStore, angleStore, sessionStore, scenarioStore } from "@/lib/store";
import type { Persona, Hook, Body, Angle, ConstructorSession, Scenario } from "@/lib/types";
import { Card, PageHeader, Button, Badge, SectionTitle, Label, Empty } from "@/components/ui";
import Link from "next/link";

type ParamType = Scenario["paramType"];

interface ParamItem {
  id: string;
  name: string;
  color: string;
  description?: string;
  template?: string;
  examples?: string[];
  pains?: string[];
  triggers?: string[];
  pointA?: string;
  pointB?: string;
}

// ── Scenario Editor ────────────────────────────────────────────────────────────

interface ScenarioEditorHandle {
  generateAndSave: () => Promise<void>;
}

const TZ_SEPARATOR = "===ТЗ===";

const ScenarioEditor = ({ item, type, existing, onSave, sessionContext, format, editorRef }: {
  item: ParamItem;
  type: ParamType;
  existing?: Scenario;
  onSave: (content: string, tz: string) => void;
  sessionContext?: string;
  format?: string;
  editorRef?: RefObject<ScenarioEditorHandle | null>;
}) => {
  const [content, setContent] = useState(existing?.content || "");
  const [tz, setTz] = useState(existing?.tz || "");
  const [saved, setSaved] = useState(false);
  const [generating, setGenerating] = useState(false);

  const save = useCallback((text: string, tzVal: string) => {
    if (!text.trim()) return;
    onSave(text, tzVal);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [onSave]);

  const generate = useCallback(async (): Promise<{ content: string; tz: string }> => {
    setGenerating(true);
    setContent("");
    setTz("");
    let fullText = "";
    try {
      const res = await fetch("/api/ai/generate-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, item, sessionContext, format }),
      });
      if (!res.ok || !res.body) throw new Error("Request failed");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        const sepIdx = fullText.indexOf(TZ_SEPARATOR);
        if (sepIdx !== -1) {
          setContent(fullText.slice(0, sepIdx).trimEnd());
          setTz(fullText.slice(sepIdx + TZ_SEPARATOR.length).trimStart());
        } else {
          setContent(fullText);
        }
      }
    } catch {
      fullText = "Ошибка генерации.";
      setContent(fullText);
    } finally {
      setGenerating(false);
    }
    const sepIdx = fullText.indexOf(TZ_SEPARATOR);
    if (sepIdx !== -1) {
      return {
        content: fullText.slice(0, sepIdx).trimEnd(),
        tz: fullText.slice(sepIdx + TZ_SEPARATOR.length).trimStart(),
      };
    }
    return { content: fullText, tz: "" };
  }, [type, item, sessionContext, format]);

  // Expose generate+save for "Generate All"
  useEffect(() => {
    if (editorRef) {
      editorRef.current = {
        generateAndSave: async () => {
          const result = await generate();
          if (result.content && result.content !== "Ошибка генерации.") save(result.content, result.tz);
        },
      };
    }
  }, [editorRef, generate, save]);

  return (
    <Card style={{ border: `1px solid ${item.color}20`, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, marginTop: 4, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#DDD" }}>{item.name}</div>
          {item.description && <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{item.description}</div>}
          {item.template && (
            <div style={{ fontSize: 11, color: "#555", marginTop: 4, fontFamily: "monospace", background: "rgba(255,255,255,0.02)", padding: "6px 10px", borderRadius: 6 }}>
              Шаблон: {item.template}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {existing && <Badge color="#6EC8A0">✓ Есть</Badge>}
          <Button
            size="sm"
            onClick={() => generate().then(r => r.content && r.content !== "Ошибка генерации." && save(r.content, r.tz))}
            disabled={generating}
            style={{ background: "rgba(232,170,66,0.12)", border: "1px solid rgba(232,170,66,0.3)", color: generating ? "#666" : "#E8AA42" }}
          >
            {generating ? "⏳ Генерирую..." : "✨ Сгенерировать"}
          </Button>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Label>Сценарий *</Label>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder={`Напишите или сгенерируйте сценарий для «${item.name}»...`}
          style={{ minHeight: 120, opacity: generating ? 0.6 : 1 }}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <Label>ТЗ (техническое задание)</Label>
        <textarea
          value={tz}
          onChange={e => setTz(e.target.value)}
          placeholder={format && format !== "static"
            ? "Покадровое ТЗ: кастинг, локация, кадр, эмоция, свет... (генерируется автоматически)"
            : "ТЗ на дизайн: визуальный герой, фон, шрифт, цвета... (генерируется автоматически)"}
          style={{ minHeight: generating ? 120 : 70, opacity: generating ? 0.6 : 1, transition: "min-height 0.3s" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button variant={saved ? "ghost" : "primary"} onClick={() => save(content, tz)}>
          {saved ? "✓ Сохранено" : "Сохранить"}
        </Button>
      </div>
    </Card>
  );
};

// ── Main Content ───────────────────────────────────────────────────────────────

function ScenariosContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const [session, setSession] = useState<ConstructorSession | null>(null);
  const [sessions, setSessions] = useState<ConstructorSession[]>([]);
  const [selectedSession, setSelectedSession] = useState(sessionId || "");

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [bodies, setBodies] = useState<Body[]>([]);
  const [angles, setAngles] = useState<Angle[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);

  const [generatingAll, setGeneratingAll] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });

  // One ref per parameter item
  const editorRefs = useRef<Map<string, RefObject<ScenarioEditorHandle | null>>>(new Map());
  const getRef = (id: string) => {
    if (!editorRefs.current.has(id)) editorRefs.current.set(id, { current: null });
    return editorRefs.current.get(id)!;
  };

  const reload = useCallback(async () => {
    const allSessions = await sessionStore.getAll();
    setSessions(allSessions);
    setScenarios(await scenarioStore.getAll());
    if (selectedSession) {
      const s = allSessions.find(x => x.id === selectedSession);
      if (s) {
        setSession(s);
        setPersonas((await personaStore.getAll()).filter(p => s.selectedPersonas.includes(p.id)));
        setHooks((await hookStore.getAll()).filter(h => s.selectedHooks.includes(h.id)));
        setBodies((await bodyStore.getAll()).filter(b => s.selectedBodies.includes(b.id)));
        setAngles((await angleStore.getAll()).filter(a => s.selectedAngles.includes(a.id)));
      }
    }
  }, [selectedSession]);

  useEffect(() => {
    const load = async () => { await reload(); };
    load();
  }, [reload]);

  const handleSave = (type: ParamType, paramId: string) => async (content: string, tz: string) => {
    await scenarioStore.save({ paramType: type, paramId, content, tz });
    await reload();
  };

  const getScenario = (type: ParamType, id: string) =>
    scenarios.find(s => s.paramType === type && s.paramId === id);

  const allItems: { id: string; type: ParamType }[] = [
    ...personas.map(p => ({ id: p.id, type: "persona" as ParamType })),
    ...hooks.map(h => ({ id: h.id, type: "hook" as ParamType })),
    ...bodies.map(b => ({ id: b.id, type: "body" as ParamType })),
    ...angles.map(a => ({ id: a.id, type: "angle" as ParamType })),
  ];

  // Generate all missing scenarios sequentially
  const handleGenerateAll = async () => {
    const missing = allItems.filter(({ id, type }) => !getScenario(type, id));
    if (missing.length === 0) return;
    setGeneratingAll(true);
    setGenProgress({ done: 0, total: missing.length });
    for (let i = 0; i < missing.length; i++) {
      const ref = editorRefs.current.get(missing[i].id);
      if (ref?.current) {
        await ref.current.generateAndSave();
        await reload();
      }
      setGenProgress({ done: i + 1, total: missing.length });
    }
    setGeneratingAll(false);
  };

  const sessionContext = session ? [
    personas.length ? `Персоны: ${personas.map(p => p.name).join(", ")}` : "",
    hooks.length ? `Хуки: ${hooks.map(h => h.name).join(", ")}` : "",
    bodies.length ? `Боди: ${bodies.map(b => b.name).join(", ")}` : "",
    angles.length ? `Энглы: ${angles.map(a => a.name).join(", ")}` : "",
  ].filter(Boolean).join("\n") : undefined;

  const totalNeeded = allItems.length;
  const totalDone = allItems.filter(({ id, type }) => getScenario(type, id)).length;
  const missingCount = totalNeeded - totalDone;

  // ── Session list ─────────────────────────────────────────────────────────────

  if (!selectedSession) {
    return (
      <div>
        <PageHeader title="Сценарии" subtitle="Выберите сессию конструктора" />
        {sessions.length === 0 ? (
          <Empty icon="⚡" text={<>Нет сессий. <Link href="/builder" style={{ color: "#E8AA42" }}>Создайте в конструкторе →</Link></>} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sessions.map(s => (
              <Card key={s.id} style={{ cursor: "pointer" }} onClick={() => setSelectedSession(s.id)}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#DDD" }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: "#555" }}>{s.totalCombinations} комбинаций</div>
                  </div>
                  <Badge color={(s.flow ?? "com") === "com" ? "#E8AA42" : "#48B8D0"}>{(s.flow ?? "com").toUpperCase()}</Badge>
                  <Button size="sm" variant="primary">Открыть →</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Scenario view ─────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title="Сценарии"
        subtitle={session ? `${session.name} · ${(session.flow ?? "com").toUpperCase()}` : ""}
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge color={totalDone === totalNeeded ? "#6EC8A0" : "#E8AA42"}>
              {totalDone}/{totalNeeded} готово
            </Badge>
            {missingCount > 0 && (
              <Button
                onClick={handleGenerateAll}
                disabled={generatingAll}
                style={{ background: "rgba(232,170,66,0.12)", border: "1px solid rgba(232,170,66,0.3)", color: generatingAll ? "#666" : "#E8AA42" }}
              >
                {generatingAll
                  ? `⏳ ${genProgress.done}/${genProgress.total}...`
                  : `✨ Сгенерировать все (${missingCount})`}
              </Button>
            )}
            {totalDone === totalNeeded && (
              <Link href={`/briefs?session=${selectedSession}`}>
                <Button variant="primary">Генерировать брифы →</Button>
              </Link>
            )}
            <Button onClick={() => setSelectedSession("")}>← Сессии</Button>
          </div>
        }
      />

      <div style={{ marginBottom: 20, padding: "12px 16px", background: "rgba(232,170,66,0.04)", border: "1px solid rgba(232,170,66,0.12)", borderRadius: 10, fontSize: 12, color: "#888" }}>
        Напишите базовый сценарий для каждого параметра или нажмите <strong style={{ color: "#E8AA42" }}>✨ Сгенерировать все</strong> — AI напишет их последовательно. Потом можно отредактировать каждый вручную.
      </div>

      {personas.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionTitle icon="👤" color="#48B8D0">Персоны ({personas.length})</SectionTitle>
          {personas.map(p => <ScenarioEditor key={p.id} item={p} type="persona" existing={getScenario("persona", p.id)} onSave={handleSave("persona", p.id)} sessionContext={sessionContext} format={session?.format} editorRef={getRef(p.id)} />)}
        </div>
      )}
      {hooks.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionTitle icon="🎣" color="#C490D1">Хуки ({hooks.length})</SectionTitle>
          {hooks.map(h => <ScenarioEditor key={h.id} item={h} type="hook" existing={getScenario("hook", h.id)} onSave={handleSave("hook", h.id)} sessionContext={sessionContext} format={session?.format} editorRef={getRef(h.id)} />)}
        </div>
      )}
      {bodies.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionTitle icon="📝" color="#6EC8A0">Боди ({bodies.length})</SectionTitle>
          {bodies.map(b => <ScenarioEditor key={b.id} item={b} type="body" existing={getScenario("body", b.id)} onSave={handleSave("body", b.id)} sessionContext={sessionContext} format={session?.format} editorRef={getRef(b.id)} />)}
        </div>
      )}
      {angles.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionTitle icon="🎯" color="#FF8B5A">Энглы ({angles.length})</SectionTitle>
          {angles.map(a => <ScenarioEditor key={a.id} item={a} type="angle" existing={getScenario("angle", a.id)} onSave={handleSave("angle", a.id)} sessionContext={sessionContext} format={session?.format} editorRef={getRef(a.id)} />)}
        </div>
      )}
    </div>
  );
}

export default function ScenariosPage() {
  return (
    <Suspense fallback={<div style={{ color: "#555", padding: 40 }}>Загрузка...</div>}>
      <ScenariosContent />
    </Suspense>
  );
}
