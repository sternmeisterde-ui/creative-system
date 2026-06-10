"use client";
import { useState } from "react";
import Link from "next/link";
import { Card, Button, Badge, SectionTitle } from "@/components/ui";

// Оркестратор «Прогнать цикл»: последовательно гонит этапы пайплайна (клиентский,
// с живым прогрессом). Стоп перед генерацией пака — отчёт нужно глазами принять.
//   1 синк данных (Meta+Elly) → 2 маппинг → 3 ассеты → 4 Gemini-разбор → 5 отчёт.

type Status = "idle" | "run" | "done" | "error";
interface Stage { key: string; label: string; status: Status; detail?: string }

const STAGES: Stage[] = [
  { key: "sync",   label: "1. Синхронизация Meta + Elly", status: "idle" },
  { key: "map",    label: "2. Маппинг кодов",             status: "idle" },
  { key: "assets", label: "3. Ассеты креативов (Meta)",   status: "idle" },
  { key: "gemini", label: "4. Gemini-разбор крео",        status: "idle" },
  { key: "report", label: "5. Отчёт + проверка",          status: "idle" },
];

const SC: Record<Status, string> = { idle: "#555", run: "#48B8D0", done: "#6EC8A0", error: "#D96B6B" };
const ST: Record<Status, string> = { idle: "ждёт", run: "идёт…", done: "готово", error: "ошибка" };

async function post(url: string, body: unknown = {}) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.error) throw new Error(d?.error ?? `HTTP ${r.status}`);
  return d;
}

export default function CycleRunner() {
  const [stages, setStages] = useState<Stage[]>(STAGES);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  const set = (key: string, status: Status, detail?: string) =>
    setStages(prev => prev.map(s => s.key === key ? { ...s, status, detail: detail ?? s.detail } : s));

  const run = async () => {
    setRunning(true); setDone(false);
    setStages(STAGES.map(s => ({ ...s, status: "idle", detail: undefined })));
    try {
      // 1. Данные
      set("sync", "run", "Meta…");
      await post("/api/meta/sync");
      set("sync", "run", "Elly…");
      await post("/api/pbi/elly-sync");
      set("sync", "done");

      // 2. Маппинг
      set("map", "run");
      await post("/api/naming/assign");
      set("map", "done");

      // 3. Ассеты
      set("assets", "run");
      const a = await post("/api/meta/creatives");
      const ads = (a.results ?? []).reduce((n: number, r: { ads?: number }) => n + (r.ads ?? 0), 0);
      set("assets", "done", `${ads} крео`);

      // 4. Gemini-разбор (чанками до конца)
      set("gemini", "run", "запуск…");
      let total = 0;
      for (let i = 0; i < 80; i++) {
        const g = await post("/api/gemini/batch", { limit: 4 });
        total += g.processed ?? 0;
        set("gemini", "run", `разобрано ${total}, осталось ${g.remaining}`);
        if (!g.remaining || g.remaining === 0) break;
        if (!g.processed) break; // нечего обрабатывать
      }
      set("gemini", "done", `разобрано ${total}`);

      // 5. Отчёт
      set("report", "run");
      const rep = await post("/api/analytics/report", { flow: "all" });
      const overall = rep?.report?.verifications?.overall ?? "—";
      set("report", "done", `проверка: ${overall}`);
      setDone(true);
    } catch (e) {
      setStages(prev => prev.map(s => s.status === "run" ? { ...s, status: "error", detail: e instanceof Error ? e.message : String(e) } : s));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <SectionTitle icon="🔄" color="#48B8D0">Прогнать цикл</SectionTitle>
        <Button variant="primary" onClick={run} disabled={running}>
          {running ? "⏳ Идёт…" : "▶ Прогнать цикл"}
        </Button>
      </div>
      <p style={{ fontSize: 12, color: "#666", marginTop: -4, marginBottom: 12 }}>
        Данные → маппинг → ассеты → Gemini-разбор → отчёт. Останавливается перед генерацией пака — отчёт нужно принять глазами.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stages.map(s => (
          <div key={s.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: s.status === "idle" ? "#777" : "#DDD" }}>{s.label}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {s.detail && <span style={{ fontSize: 11, color: "#888" }}>{s.detail}</span>}
              <Badge color={SC[s.status]}>{ST[s.status]}</Badge>
            </span>
          </div>
        ))}
      </div>
      {done && (
        <div style={{ marginTop: 12, fontSize: 13, color: "#6EC8A0" }}>
          ✅ Цикл завершён. <Link href="/report" style={{ color: "#48B8D0" }}>Открыть отчёт →</Link> Если проверка ok/warning — можно идти в генерацию пака.
        </div>
      )}
    </Card>
  );
}
