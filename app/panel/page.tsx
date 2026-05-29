"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { CreativePerformance, AdFlow } from "@/lib/types";
import type { PackHealthResult } from "@/app/api/analytics/pack-health/route";
import type { EarlyStopResult } from "@/app/api/analytics/early-stop/route";
import { Card, PageHeader, Badge, Button, SectionTitle } from "@/components/ui";
import Link from "next/link";

interface ParamStat {
  code: string;
  paramType: "persona" | "hook" | "body" | "angle";
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  adCount: number;
}

interface ParamStats {
  personas: ParamStat[];
  hooks: ParamStat[];
  bodies: ParamStat[];
  angles: ParamStat[];
}

interface PbiStat {
  adName: string;
  leads: number;
  qualLeads: number;
  spend: number;
  revenue: number;
  cpl: number | null;
  cpql: number | null;
  cr: number | null;
}

interface Alert {
  id: string;
  adId: string;
  adName: string;
  flow: string;
  alertType: string;
  message: string;
  value: number | null;
  createdAt: string;
}

const TARGET_CPL = 20;
const TARGET_CPQL = 28;

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function StatusBadge({ row }: { row: CreativePerformance }) {
  const colors = { winner: "#6EC8A0", loser: "#D96B6B", testing: "#E8AA42", unknown: "#555" };
  const labels = { winner: "ВИННЕР", loser: "ЛУЗЕР", testing: "ТЕСТ", unknown: "—" };
  const s = row.autoStatus ?? "unknown";
  return <Badge color={colors[s as keyof typeof colors]}>{labels[s as keyof typeof labels]}</Badge>;
}

function MetricCell({ value, target, lower = true }: { value: number | null; target: number; lower?: boolean }) {
  if (value == null) return <span style={{ color: "#555" }}>—</span>;
  const good = lower ? value <= target : value >= target;
  const warn = lower ? value <= target * 1.3 : value >= target * 0.8;
  const color = good ? "#6EC8A0" : warn ? "#E8AA42" : "#D96B6B";
  return <span style={{ color, fontWeight: 700 }}>€{fmt(value)}</span>;
}

export default function PanelPage() {
  const [rows, setRows] = useState<CreativePerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<AdFlow | "all">("all");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [paramStats, setParamStats] = useState<ParamStats | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pausing, setPausing] = useState<string | null>(null);
  const [pbiStats, setPbiStats] = useState<PbiStat[]>([]);
  const [pbiFilter, setPbiFilter] = useState<"all" | "with_leads">("with_leads");
  const [checkingAlerts, setCheckingAlerts] = useState(false);
  const [alertCheckPhase, setAlertCheckPhase] = useState<"sync" | "check" | null>(null);
  const [alertCheckResult, setAlertCheckResult] = useState<string | null>(null);
  const [packHealth, setPackHealth] = useState<PackHealthResult | null>(null);
  const [runningEarlyStop, setRunningEarlyStop] = useState(false);
  const [earlyStopResult, setEarlyStopResult] = useState<EarlyStopResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState<string | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncPhase, setSyncPhase] = useState<"meta" | "elly" | "done" | null>(null);

  const loadAlerts = async () => {
    const res = await fetch("/api/alerts/check?list=1");
    if (res.ok) {
      const d = await res.json();
      setAlerts((d.alerts ?? []).map((a: Record<string, unknown>) => ({
        id: a.id, adId: a.ad_id, adName: a.ad_name, flow: a.flow,
        alertType: a.alert_type, message: a.message, value: a.value, createdAt: a.created_at,
      })));
    }
  };

  const runAnalysis = async () => {
    setAnalyzing(true);
    setAnalysisText("");
    setAnalysisOpen(true);
    try {
      const res = await fetch("/api/ai/analyze-performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json() as { error?: string };
        setAnalysisText(`Ошибка: ${d.error ?? "нет ответа"}`);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnalysisText(text);
      }
    } catch {
      setAnalysisText("Сетевая ошибка");
    } finally {
      setAnalyzing(false);
    }
  };

  const pauseAd = async (adId: string, alertId: string) => {
    setPausing(adId);
    try {
      const res = await fetch("/api/meta/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId, alertId }),
      });
      if (res.ok) await loadAlerts();
    } finally {
      setPausing(null);
    }
  };

  const syncData = async () => {
    setSyncing(true);
    setSyncPhase("meta");
    try {
      await fetch("/api/meta/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      setSyncPhase("elly");
      // elly-sync + alert check are fired automatically by meta/sync chain, but we wait for elly explicitly
      const today = new Date();
      const dateFrom = new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);
      const dateTo = today.toISOString().slice(0, 10);
      await fetch("/api/pbi/elly-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateFrom, dateTo }) });
      setSyncPhase("done");
      await load();
      setTimeout(() => setSyncPhase(null), 2000);
    } finally {
      setSyncing(false);
    }
  };

  const runEarlyStop = async () => {
    setRunningEarlyStop(true);
    setEarlyStopResult(null);
    try {
      // Sync fresh Plurio data (last 7 days) before checking
      const today = new Date();
      const dateFrom = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
      const dateTo = today.toISOString().slice(0, 10);
      await fetch("/api/pbi/elly-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const res = await fetch("/api/analytics/early-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false }),
      });
      const data = await res.json() as EarlyStopResult;
      setEarlyStopResult(data);
      await loadAlerts();
    } finally {
      setRunningEarlyStop(false);
    }
  };

  const load = async () => {
    setLoading(true);
    let q = supabase.from("creative_performance").select("*");
    if (flow !== "all") q = q.eq("flow", flow);
    const { data } = await q.order("spend", { ascending: false });
    setRows((data ?? []).map((r: Record<string, unknown>) => ({
      adId:           r.ad_id,
      adName:         r.ad_name,
      flow:           r.flow,
      campaignId:     r.campaign_id,
      campaignName:   r.campaign_name,
      adsetId:        r.adset_id,
      adsetName:      r.adset_name,
      spend:          r.spend,
      impressions:    r.impressions,
      clicks:         r.clicks,
      frequency:      r.frequency,
      cpm:            r.cpm,
      ctr:            r.ctr,
      cpc:            r.cpc,
      leads:          r.leads,
      qualLeads:      r.qual_leads,
      revenue:        r.revenue,
      cpl:            r.cpl,
      cpql:           r.cpql,
      crLeadToQual:   r.cr_lead_to_qual,
      crClickToLead:  r.cr_click_to_lead,
      autoStatus:     r.auto_status,
      targetCpl:      r.target_cpl,
      targetCpql:     r.target_cpql,
      firstSeen:      r.first_seen,
      lastSeen:       r.last_seen,
    })) as CreativePerformance[]);

    // последняя синхронизация
    const { data: sync } = await supabase
      .from("meta_sync_log")
      .select("synced_at")
      .eq("status", "ok")
      .order("synced_at", { ascending: false })
      .limit(1)
      .single();
    setLastSync(sync?.synced_at ?? null);

    // параметровая аналитика
    const paramRes = await fetch("/api/analytics/params");
    if (paramRes.ok) {
      const paramData = await paramRes.json();
      if (paramData.stats) setParamStats(paramData.stats);
    }

    await loadAlerts();

    const pbiRes = await fetch("/api/pbi/stats");
    if (pbiRes.ok) {
      const pbiData = await pbiRes.json();
      setPbiStats(pbiData.rows ?? []);
    }

    const phRes = await fetch("/api/analytics/pack-health");
    if (phRes.ok) {
      const phData = await phRes.json() as PackHealthResult;
      setPackHealth(phData);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, [flow]);

  const winners = rows.filter(r => r.autoStatus === "winner");
  const fakeWinners = rows.filter(r => r.autoStatus === "fake_winner");
  const losers = rows.filter(r => r.autoStatus === "loser");
  const testing = rows.filter(r => r.autoStatus === "testing");

  return (
    <div>
      <PageHeader
        title="Приборная панель"
        subtitle="Живые метрики по активным креативам"
        action={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {lastSync && (
              <span style={{ fontSize: 11, color: "#555" }}>
                Синк: {new Date(lastSync).toLocaleString("ru")}
              </span>
            )}
            <Button
              onClick={runAnalysis}
              disabled={analyzing}
              style={{ background: "rgba(72,184,208,0.1)", border: "1px solid rgba(72,184,208,0.25)", color: analyzing ? "#666" : "#48B8D0" }}
            >
              {analyzing ? "⏳ Анализируем..." : analysisText ? "⚡ Обновить анализ" : "⚡ Запустить анализ"}
            </Button>
            <Button
              onClick={syncData}
              disabled={syncing}
              style={{ background: "rgba(99,179,99,0.1)", border: "1px solid rgba(99,179,99,0.25)", color: syncing ? "#666" : "#63B363" }}
            >
              {syncing
                ? syncPhase === "meta" ? "⏳ Синхр. Meta..." : syncPhase === "elly" ? "⏳ Синхр. Plurio..." : "✓ Готово"
                : "🔃 Синхронизировать данные"}
            </Button>
            <Button
              onClick={async () => {
                setCheckingAlerts(true);
                setAlertCheckResult(null);
                try {
                  // 1. Sync fresh Plurio data (last 7 days)
                  setAlertCheckPhase("sync");
                  const today = new Date();
                  const dateFrom = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
                  const dateTo = today.toISOString().slice(0, 10);
                  await fetch("/api/pbi/elly-sync", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ dateFrom, dateTo }),
                  });
                  // 2. Run loser check against fresh data
                  setAlertCheckPhase("check");
                  const res = await fetch("/api/alerts/check", { method: "POST" });
                  const d = await res.json() as { created?: number };
                  await loadAlerts();
                  setAlertCheckResult(d.created ? `+${d.created} новых` : "Всё чисто");
                } finally {
                  setCheckingAlerts(false);
                  setAlertCheckPhase(null);
                  setTimeout(() => setAlertCheckResult(null), 3000);
                }
              }}
              disabled={checkingAlerts}
            >
              {checkingAlerts
                ? alertCheckPhase === "sync" ? "⏳ Синхронизирую..." : "⏳ Проверяем..."
                : alertCheckResult ? `✓ ${alertCheckResult}` : "🚨 Проверить лузеров"}
            </Button>
            <Button
              onClick={runEarlyStop}
              disabled={runningEarlyStop}
              style={{
                background: "rgba(217,107,107,0.1)",
                border: "1px solid rgba(217,107,107,0.25)",
                color: runningEarlyStop ? "#666" : "#D96B6B",
              }}
            >
              {runningEarlyStop ? "⏳ Проверяем..." : earlyStopResult ? `🛑 Флагов: ${earlyStopResult.flagged}` : "🛑 Найти кандидатов"}
            </Button>
            <Button onClick={load} disabled={loading}>
              {loading ? "⏳ Загрузка..." : "🔄 Обновить"}
            </Button>
          </div>
        }
      />

      {/* Плановые метрики */}
      <Card style={{ marginBottom: 16, background: "rgba(232,170,66,0.04)", border: "1px solid rgba(232,170,66,0.15)" }}>
        <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#E8AA42", textTransform: "uppercase", letterSpacing: 1 }}>
            Плановые метрики
          </div>
          <div>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#E8AA42" }}>≤ €{TARGET_CPL}</span>
            <span style={{ fontSize: 11, color: "#777", marginLeft: 6 }}>CPL</span>
          </div>
          <div>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#E8AA42" }}>≤ €{TARGET_CPQL}</span>
            <span style={{ fontSize: 11, color: "#777", marginLeft: 6 }}>CPQL</span>
          </div>
          <div style={{ fontSize: 11, color: "#555" }}>
            Виннер = CPL ≤ {TARGET_CPL}€ + CPQL ≤ {TARGET_CPQL}€ + 8 000 показов
          </div>
        </div>
      </Card>

      {/* Жизнеспособность пака */}
      {packHealth && (
        <div style={{ marginBottom: 20 }}>
          {(() => {
            const s = packHealth.status;
            const cfg = {
              healthy: { color: "#6EC8A0", bg: "rgba(110,200,160,0.06)", border: "rgba(110,200,160,0.2)", icon: "✓", label: "Пак живёт" },
              warning: { color: "#E8AA42", bg: "rgba(232,170,66,0.06)", border: "rgba(232,170,66,0.2)", icon: "⚠", label: "Пак слабеет" },
              dying:   { color: "#D96B6B", bg: "rgba(217,107,107,0.06)", border: "rgba(217,107,107,0.2)", icon: "🔴", label: "Пак умирает" },
            }[s];
            return (
              <Card style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: packHealth.signals.length > 0 ? 16 : 0 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cfg.color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
                      {cfg.icon} Жизнеспособность пака
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: cfg.color }}>{cfg.label}</div>
                  </div>
                  <div style={{ flex: 1, fontSize: 12, color: "#666" }}>
                    {packHealth.activeAdCount} активных объявлений · {packHealth.signals.length} сигналов
                  </div>
                  {s === "dying" && (() => {
                    const dyingFlow = packHealth.signals.find(sig => sig.flow)?.flow ?? "com";
                    const href = `/builder?autoRecommend=1&flow=${dyingFlow}&reason=pack_dying`;
                    return (
                      <Link href={href} style={{
                        padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: "rgba(217,107,107,0.15)", border: "1px solid rgba(217,107,107,0.35)",
                        color: "#D96B6B", textDecoration: "none", whiteSpace: "nowrap",
                      }}>
                        Запустить новый цикл →
                      </Link>
                    );
                  })()}
                </div>
                {packHealth.signals.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {packHealth.signals.map((sig, i) => {
                      const isRed = sig.signalType === "cpl_red";
                      const sc = isRed ? "#D96B6B" : "#E8AA42";
                      return (
                        <div key={i} style={{
                          display: "flex", alignItems: "flex-start", gap: 10,
                          padding: "10px 14px", borderRadius: 8,
                          background: isRed ? "rgba(217,107,107,0.05)" : "rgba(232,170,66,0.05)",
                          border: `1px solid ${isRed ? "rgba(217,107,107,0.15)" : "rgba(232,170,66,0.15)"}`,
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc, flexShrink: 0, marginTop: 4 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: "#CCC", fontFamily: "monospace", marginBottom: 2 }}>
                              {sig.adName}
                              {sig.flow && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 400, color: sig.flow === "com" ? "#E8AA42" : "#48B8D0" }}>{sig.flow.toUpperCase()}</span>}
                            </div>
                            <div style={{ fontSize: 11, color: sc }}>{sig.message}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })()}
        </div>
      )}

      {/* Авто-стоп результат */}
      {earlyStopResult && (
        <div style={{ marginBottom: 20 }}>
          <Card style={{
            background: earlyStopResult.flagged > 0 ? "rgba(217,107,107,0.06)" : "rgba(110,200,160,0.04)",
            border: `1px solid ${earlyStopResult.flagged > 0 ? "rgba(217,107,107,0.2)" : "rgba(110,200,160,0.15)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: earlyStopResult.ads.length > 0 ? 14 : 0 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#D96B6B", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>
                  🛑 Ранняя остановка
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: earlyStopResult.flagged > 0 ? "#D96B6B" : "#6EC8A0" }}>
                  {earlyStopResult.flagged > 0
                    ? `${earlyStopResult.flagged} кандидатов на остановку`
                    : earlyStopResult.skipped > 0
                    ? `${earlyStopResult.skipped} уже отмечено ранее`
                    : "Нет кандидатов на остановку"}
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#555" }}>
                Порог: CPL &gt; €40 при 2000+ показах
              </div>
              <button onClick={() => setEarlyStopResult(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
            {earlyStopResult.ads.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {earlyStopResult.ads.map((ad, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "8px 12px", borderRadius: 8,
                    background: "rgba(217,107,107,0.05)",
                    border: "1px solid rgba(217,107,107,0.15)",
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#CCC", fontFamily: "monospace", flex: 1 }}>{ad.adName}</div>
                    <span style={{ fontSize: 11, color: "#D96B6B" }}>CPL €{ad.cpl.toFixed(1)}</span>
                    <span style={{ fontSize: 11, color: "#555" }}>{ad.impressions.toLocaleString()} показов</span>
                    {ad.flow && <Badge color={ad.flow === "com" ? "#E8AA42" : "#48B8D0"}>{ad.flow.toUpperCase()}</Badge>}
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#E8AA42" }}>⚠ Остановить вручную</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* AI Анализ */}
      {analysisOpen && (
        <div style={{ marginBottom: 20 }}>
          <Card style={{ background: "rgba(72,184,208,0.04)", border: "1px solid rgba(72,184,208,0.2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: analysisText ? 16 : 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#48B8D0", textTransform: "uppercase", letterSpacing: 1 }}>
                ⚡ AI Анализ{flow !== "all" ? ` · ${flow.toUpperCase()}` : ""}
              </div>
              {analyzing && <div style={{ fontSize: 11, color: "#555" }}>Генерируем...</div>}
              <div style={{ flex: 1 }} />
              <button onClick={() => setAnalysisOpen(false)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, padding: 0 }}>✕</button>
            </div>
            {analysisText && (
              <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.8 }}>
                {analysisText.split("\n").map((line, i) => {
                  if (line.startsWith("### ") || line.startsWith("## ")) {
                    return <div key={i} style={{ fontWeight: 700, color: "#48B8D0", fontSize: 13, marginTop: 18, marginBottom: 6 }}>{line.replace(/^#+\s*/, "")}</div>;
                  }
                  if (/^\*\*.*\*\*$/.test(line.trim())) {
                    return <div key={i} style={{ fontWeight: 700, color: "#E8AA42", marginTop: 10, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
                  }
                  if (line.startsWith("- ") || line.startsWith("• ")) {
                    return <div key={i} style={{ paddingLeft: 16, color: "#BBB" }}>• {line.slice(2).replace(/\*\*(.*?)\*\*/g, "$1")}</div>;
                  }
                  if (line.trim() === "" || line.trim() === "---") return <div key={i} style={{ height: 6 }} />;
                  const parts = line.split(/\*\*(.*?)\*\*/g);
                  return (
                    <div key={i} style={{ color: "#CCC" }}>
                      {parts.map((p, j) => j % 2 === 1 ? <strong key={j} style={{ color: "#EEE" }}>{p}</strong> : p)}
                    </div>
                  );
                })}
                {analyzing && <span style={{ display: "inline-block", width: 8, height: 14, background: "#48B8D0", marginLeft: 2, animation: "none", opacity: 0.7 }}>▋</span>}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Алерты */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle icon="🚨">Алерты ({alerts.length})</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map(a => (
              <Card key={a.id} style={{ background: "rgba(217,107,107,0.06)", border: "1px solid rgba(217,107,107,0.2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#DDD", fontFamily: "monospace", marginBottom: 4 }}>{a.adName}</div>
                    <div style={{ fontSize: 12, color: "#D96B6B" }}>{a.message}</div>
                  </div>
                  <Badge color={a.flow === "com" ? "#E8AA42" : "#48B8D0"}>{a.flow?.toUpperCase()}</Badge>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => pauseAd(a.adId, a.id)}
                    disabled={pausing === a.adId}
                  >
                    {pausing === a.adId ? "⏳" : "⏸ Остановить"}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Сводка */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Всего креативов", value: rows.length, color: "#DDD" },
          { label: "Виннеров", value: winners.length, color: "#6EC8A0" },
          { label: "Fake winners", value: fakeWinners.length, color: "#FF8B5A" },
          { label: "В тесте", value: testing.length, color: "#E8AA42" },
          { label: "Лузеров", value: losers.length, color: "#D96B6B" },
        ].map(s => (
          <Card key={s.label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{s.label}</div>
          </Card>
        ))}
      </div>

      {/* Фильтр потока */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {([["all", "Все"], ["com", "Коммерческий"], ["gov", "Госники"]] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFlow(v)} style={{
            padding: "7px 16px", borderRadius: 8, fontSize: 12,
            fontWeight: flow === v ? 700 : 400, cursor: "pointer",
            border: flow === v ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.06)",
            background: flow === v ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
            color: flow === v ? "#E8AA42" : "#666", fontFamily: "inherit",
          }}>
            {l}
          </button>
        ))}
      </div>

      {/* Нет данных */}
      {!loading && rows.length === 0 && (
        <Card>
          <div style={{ textAlign: "center", padding: "40px 0", color: "#555" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📡</div>
            <div style={{ fontSize: 14, marginBottom: 6 }}>Нет данных</div>
            <div style={{ fontSize: 12 }}>Подключите Meta API для автоматического сбора метрик</div>
          </div>
        </Card>
      )}

      {/* Таблица */}
      {rows.length > 0 && (
        <div>
          <SectionTitle icon="📊">Все креативы</SectionTitle>
          <Card style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Статус", "Объявление", "Поток", "Спенд", "Показы", "Клики", "CTR", "CPM", "Лиды", "CPL", "Квал.", "CPQL", "CR л→кв"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={row.adId ?? i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                    <td style={{ padding: "10px 14px" }}><StatusBadge row={row} /></td>
                    <td style={{ padding: "10px 14px", maxWidth: 200 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#DDD", fontFamily: "monospace" }}>{row.adName}</div>
                      {row.campaignName && <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{row.campaignName}</div>}
                    </td>
                    <td style={{ padding: "10px 14px" }}>
                      <Badge color={row.flow === "com" ? "#E8AA42" : "#48B8D0"}>{row.flow?.toUpperCase() ?? "—"}</Badge>
                    </td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>€{fmt(row.spend)}</td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{row.impressions?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{row.clicks?.toLocaleString() ?? "—"}</td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{fmt(row.ctr)}%</td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>€{fmt(row.cpm)}</td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{row.leads ?? "—"}</td>
                    <td style={{ padding: "10px 14px" }}><MetricCell value={row.cpl} target={TARGET_CPL} /></td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{row.qualLeads ?? "—"}</td>
                    <td style={{ padding: "10px 14px" }}><MetricCell value={row.cpql} target={TARGET_CPQL} /></td>
                    <td style={{ padding: "10px 14px", color: "#AAA" }}>{fmt(row.crLeadToQual)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* PBI Campaign Analytics */}
      {pbiStats.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <SectionTitle icon="📊">PBI Аналитика кампаний</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {([["with_leads", "С лидами"], ["all", "Все"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => setPbiFilter(v)} style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer",
                  fontWeight: pbiFilter === v ? 700 : 400, fontFamily: "inherit",
                  border: pbiFilter === v ? "1px solid rgba(72,184,208,0.3)" : "1px solid rgba(255,255,255,0.06)",
                  background: pbiFilter === v ? "rgba(72,184,208,0.1)" : "rgba(255,255,255,0.02)",
                  color: pbiFilter === v ? "#48B8D0" : "#666",
                }}>{l}</button>
              ))}
            </div>
          </div>
          <Card style={{ overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {["Кампания", "Лиды", "Квал.", "CR", "Спенд", "CPL", "CPQL", "Выручка"].map(h => (
                    <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pbiStats
                  .filter(r => pbiFilter === "all" || r.leads > 0)
                  .map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                      <td style={{ padding: "8px 14px", maxWidth: 280 }}>
                        <div style={{ fontSize: 11, color: "#CCC", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.adName}</div>
                      </td>
                      <td style={{ padding: "8px 14px", color: "#6EC8A0", fontWeight: 700 }}>{r.leads}</td>
                      <td style={{ padding: "8px 14px", color: "#C490D1", fontWeight: 700 }}>{r.qualLeads}</td>
                      <td style={{ padding: "8px 14px", color: "#AAA" }}>{r.cr != null ? `${fmt(r.cr, 1)}%` : "—"}</td>
                      <td style={{ padding: "8px 14px", color: "#AAA" }}>€{fmt(r.spend, 0)}</td>
                      <td style={{ padding: "8px 14px" }}><MetricCell value={r.cpl} target={TARGET_CPL} /></td>
                      <td style={{ padding: "8px 14px" }}><MetricCell value={r.cpql} target={TARGET_CPQL} /></td>
                      <td style={{ padding: "8px 14px", color: r.revenue > 0 ? "#6EC8A0" : "#555" }}>
                        {r.revenue > 0 ? `€${fmt(r.revenue, 0)}` : "—"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Parameter analytics */}
      {paramStats && (
        <div style={{ marginTop: 32 }}>
          <SectionTitle icon="🔬">Аналитика параметров</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {([
              ["personas", "Персоны", "#48B8D0"],
              ["hooks", "Хуки", "#C490D1"],
              ["bodies", "Боди", "#6EC8A0"],
              ["angles", "Энглы", "#FF8B5A"],
            ] as const).map(([key, label, color]) => {
              const items = paramStats[key];
              if (!items || items.length === 0) return null;
              const maxSpend = Math.max(...items.map(i => i.spend), 1);
              return (
                <Card key={key}>
                  <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>{label}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {items.slice(0, 6).map(item => (
                      <div key={item.code}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, padding: "1px 7px", borderRadius: 4, fontFamily: "monospace", minWidth: 36, textAlign: "center" }}>{item.code}</span>
                          <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${(item.spend / maxSpend) * 100}%`, background: color, borderRadius: 2 }} />
                          </div>
                          <span style={{ fontSize: 11, color: "#888", minWidth: 60, textAlign: "right" }}>€{item.spend.toFixed(0)}</span>
                          <span style={{ fontSize: 10, color: "#555", minWidth: 50, textAlign: "right" }}>{item.impressions.toLocaleString()}</span>
                          <span style={{ fontSize: 10, color: "#555", minWidth: 40, textAlign: "right" }}>{(item.ctr ?? 0).toFixed(2)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {items.length > 6 && <div style={{ fontSize: 10, color: "#444", marginTop: 8 }}>+ ещё {items.length - 6}</div>}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
