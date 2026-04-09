"use client";
import { useEffect, useState } from "react";
import { personaStore, hookStore, bodyStore, angleStore, sessionStore, briefStore } from "@/lib/store";
import { supabase } from "@/lib/supabase";
import { Card, PageHeader, Stat, Badge } from "@/components/ui";
import Link from "next/link";

interface LiveStats {
  totalAds: number;
  winners: number;
  losers: number;
  totalSpend: number;
  lastSync: string | null;
}

export default function Dashboard() {
  const [lib, setLib] = useState({ personas: 0, hooks: 0, bodies: 0, angles: 0, sessions: 0, briefs: 0 });
  const [live, setLive] = useState<LiveStats | null>(null);

  useEffect(() => {
    const load = async () => {
      const [personas, hooks, bodies, angles, sessions, briefs] = await Promise.all([
        personaStore.getAll(), hookStore.getAll(), bodyStore.getAll(), angleStore.getAll(),
        sessionStore.getAll(), briefStore.getAll(),
      ]);
      setLib({ personas: personas.length, hooks: hooks.length, bodies: bodies.length, angles: angles.length, sessions: sessions.length, briefs: briefs.length });

      // Live Meta stats
      const { data: perf } = await supabase.from("creative_performance").select("auto_status, spend");
      const rows = perf ?? [];
      const { data: syncRow } = await supabase.from("meta_sync_log").select("synced_at").eq("status", "ok").order("synced_at", { ascending: false }).limit(1).single();
      setLive({
        totalAds: rows.length,
        winners: rows.filter(r => r.auto_status === "winner").length,
        losers: rows.filter(r => r.auto_status === "loser").length,
        totalSpend: rows.reduce((s, r) => s + (parseFloat(r.spend) || 0), 0),
        lastSync: syncRow?.synced_at ?? null,
      });
    };
    load();
  }, []);

  const STEPS = [
    { href: "/library", icon: "📚", label: "Библиотека", desc: "Персоны, хуки, боди, энглы", color: "#48B8D0" },
    { href: "/builder", icon: "⚡", label: "Конструктор", desc: "AI выбирает топ-3 параметров", color: "#E8AA42" },
    { href: "/scenarios", icon: "✍️", label: "Сценарии", desc: "Базовые сценарии параметров", color: "#C490D1" },
    { href: "/briefs", icon: "📋", label: "Брифы", desc: "Адаптированные брифы с AI", color: "#FF8B5A" },
    { href: "/panel", icon: "📡", label: "Панель", desc: "Живые метрики из Meta", color: "#6EC8A0" },
  ];

  return (
    <div>
      <PageHeader title="Creative System" subtitle="AI-powered процесс создания Meta Ads креативов" />

      {/* Live Meta stats */}
      {live && (
        <Card style={{ marginBottom: 16, background: live.winners > 0 ? "rgba(110,200,160,0.04)" : "rgba(255,255,255,0.02)", border: live.winners > 0 ? "1px solid rgba(110,200,160,0.15)" : "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 1 }}>
              📡 Meta Ads — живые данные
            </div>
            {live.lastSync && (
              <span style={{ fontSize: 10, color: "#444" }}>
                Синк: {new Date(live.lastSync).toLocaleString("ru")}
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            <Stat label="Активных объявлений" value={live.totalAds} />
            <Stat label="Виннеров" value={live.winners} color="#6EC8A0" />
            <Stat label="Лузеров" value={live.losers} color="#D96B6B" />
            <Stat label="Общий спенд" value={`€${live.totalSpend.toFixed(0)}`} color="#E8AA42" />
          </div>
          {live.totalAds === 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: "#444" }}>
              Нет данных из Meta. <Link href="/panel" style={{ color: "#E8AA42" }}>Запустить синхронизацию →</Link>
            </div>
          )}
        </Card>
      )}

      {/* Library stats */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
          Библиотека параметров
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 20 }}>
          <Stat label="Персоны" value={lib.personas} color="#48B8D0" />
          <Stat label="Хуки" value={lib.hooks} color="#C490D1" />
          <Stat label="Боди" value={lib.bodies} color="#6EC8A0" />
          <Stat label="Энглы" value={lib.angles} color="#FF8B5A" />
          <Stat label="Сессии" value={lib.sessions} />
          <Stat label="Брифы" value={lib.briefs} />
        </div>
      </Card>

      {/* Process steps */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
          Процесс создания креативов
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {STEPS.map((step, i) => (
            <Link key={step.href} href={step.href} style={{ textDecoration: "none", flex: 1 }}>
              <Card style={{ border: `1px solid ${step.color}20`, background: `${step.color}06`, cursor: "pointer", height: "100%" }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: step.color, marginBottom: 8, fontFamily: "monospace" }}>0{i + 1}</div>
                <div style={{ fontSize: 22, marginBottom: 10 }}>{step.icon}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#DDD", marginBottom: 4 }}>{step.label}</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5 }}>{step.desc}</div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Quick actions + Library health */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 14 }}>Быстрые действия</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { href: "/library", label: "+ Добавить параметры в библиотеку", color: "#48B8D0" },
              { href: "/builder", label: "⚡ Новая сессия конструктора", color: "#E8AA42" },
              { href: "/pbi", label: "📊 Загрузить данные PBI (лиды)", color: "#C490D1" },
              { href: "/panel", label: "📡 Открыть приборную панель", color: "#6EC8A0" },
              { href: "/admin", label: "⚙️ Настроить правила и скиллы", color: "#FF8B5A" },
            ].map(a => (
              <Link key={a.href} href={a.href} style={{ fontSize: 12, color: a.color, textDecoration: "none", padding: "8px 12px", borderRadius: 8, background: `${a.color}08`, border: `1px solid ${a.color}18`, display: "block" }}>
                {a.label}
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#888", marginBottom: 14 }}>Готовность библиотеки</div>
          {[
            { label: "Персоны", value: lib.personas, color: "#48B8D0", min: 3 },
            { label: "Хуки", value: lib.hooks, color: "#C490D1", min: 3 },
            { label: "Боди", value: lib.bodies, color: "#6EC8A0", min: 3 },
            { label: "Энглы", value: lib.angles, color: "#FF8B5A", min: 3 },
          ].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#777", width: 60 }}>{item.label}</div>
              <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, (item.value / item.min) * 100)}%`, background: item.color, borderRadius: 2 }} />
              </div>
              <Badge color={item.value >= item.min ? "#6EC8A0" : "#D96B6B"}>{item.value}</Badge>
            </div>
          ))}
          <div style={{ fontSize: 10, color: "#444", marginTop: 8 }}>Минимум 3 на параметр для запуска конструктора</div>
        </Card>
      </div>
    </div>
  );
}
