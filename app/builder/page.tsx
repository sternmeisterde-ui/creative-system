"use client";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import type { Format, AdFlow, PackMetadata, PackSlot, PackSlotCategory } from "@/lib/types";
import { Card, PageHeader, Button, Badge, SectionTitle, Empty } from "@/components/ui";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<PackSlotCategory, { label: string; icon: string; color: string; pct: number; desc: string }> = {
  winner_family: { label: "Размножение виннеров (семьи)", icon: "🌱", color: "#6EC8A0", pct: 30, desc: "Берём винеров и меняем 1 параметр" },
  winner_mix:    { label: "Размножение виннеров (смеси)", icon: "🧬", color: "#6EC8A0", pct: 25, desc: "Свободные комбинации winning P/H/B/A" },
  discovery:     { label: "Discovery (новые комбинации)", icon: "🔍", color: "#48B8D0", pct: 25, desc: "Непротестированные комбинации с HELPS-кодами" },
  competitor:    { label: "Конкуренты",                    icon: "🟣", color: "#C490D1", pct: 20, desc: "Из одобренных концептов в /competitors" },
};

const CODE_COLOR: Record<string, string> = {
  persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A",
};

// ── Slot card ────────────────────────────────────────────────────────────────

function SlotCard({ slot, onRegenerate, regenerating }: {
  slot: PackSlot;
  onRegenerate: (slotId: number) => void;
  regenerating: boolean;
}) {
  const meta = CATEGORY_META[slot.category];
  return (
    <div style={{
      padding: 12, borderRadius: 10,
      border: `1px solid ${meta.color}30`,
      background: `${meta.color}08`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: "uppercase", letterSpacing: 0.5 }}>
          #{slot.slotId}
        </span>
        <button
          onClick={() => onRegenerate(slot.slotId)}
          disabled={regenerating}
          style={{
            fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: regenerating ? "wait" : "pointer",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
            color: regenerating ? "#666" : "#AAA", fontFamily: "inherit",
          }}
        >
          {regenerating ? "⏳" : "🔄 регенерить"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {(["persona", "hook", "body", "angle"] as const).map(t => {
          const code = slot.codes[t];
          if (!code) return null;
          return (
            <span key={t} style={{
              fontFamily: "monospace", fontSize: 11, fontWeight: 700,
              color: CODE_COLOR[t], background: `${CODE_COLOR[t]}18`,
              padding: "2px 6px", borderRadius: 4,
            }}>{code}</span>
          );
        })}
      </div>

      <div style={{ fontSize: 11, color: "#888", lineHeight: 1.5 }}>{slot.rationale}</div>

      {slot.basedOnAd && (
        <div style={{ fontSize: 10, color: "#555" }}>
          ← <span style={{ color: "#888", fontFamily: "monospace" }}>{slot.basedOnAd}</span>
          {slot.variedParam && <span> · меняем {slot.variedParam}</span>}
        </div>
      )}
      {slot.fromWinners && slot.fromWinners.length > 0 && (
        <div style={{ fontSize: 10, color: "#555" }}>← из винеров: {slot.fromWinners.join(", ")}</div>
      )}
      {slot.helpsCodes && slot.helpsCodes.length > 0 && (
        <div style={{ fontSize: 10, color: "#555" }}>HELPS: {slot.helpsCodes.join(", ")}</div>
      )}
      {slot.newCodesCreated && slot.newCodesCreated.length > 0 && (
        <div style={{ fontSize: 10, color: "#FF8B5A" }}>+ новые коды: {slot.newCodesCreated.join(", ")}</div>
      )}
    </div>
  );
}

// ── Group section ────────────────────────────────────────────────────────────

function GroupSection({ category, slots, onRegenerate, regenerating }: {
  category: PackSlotCategory;
  slots: PackSlot[];
  onRegenerate: (slotId: number) => void;
  regenerating: number | null;
}) {
  const meta = CATEGORY_META[category];
  if (slots.length === 0) return null;

  return (
    <Card style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <SectionTitle icon={meta.icon} color={meta.color}>{meta.label}</SectionTitle>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Badge color={meta.color}>{slots.length} шт · {meta.pct}%</Badge>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#555", marginBottom: 12 }}>{meta.desc}</div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
        {slots.map(s => (
          <SlotCard key={s.slotId} slot={s} onRegenerate={onRegenerate} regenerating={regenerating === s.slotId} />
        ))}
      </div>
    </Card>
  );
}

// ── History row ──────────────────────────────────────────────────────────────

interface HistoryRow {
  id: string;
  name: string;
  flow: AdFlow | null;
  format: Format;
  generated_at: string | null;
  pack_size: number;
  pack_metadata: PackMetadata | null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function BuilderContent() {
  const [flow, setFlow] = useState<AdFlow>("com");
  const [format, setFormat] = useState<Format>("ugc");
  const [packSize, setPackSize] = useState(20);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentPack, setCurrentPack] = useState<PackMetadata | null>(null);
  const [regenSlot, setRegenSlot] = useState<number | null>(null);

  const [history, setHistory] = useState<HistoryRow[]>([]);

  useEffect(() => {
    fetch("/api/pack/history").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.sessions) setHistory(d.sessions);
    }).catch(() => {});
  }, [currentSessionId]);

  const handleGenerate = async () => {
    setError(null);
    setGenerating(true);
    setCurrentPack(null);
    setCurrentSessionId(null);
    try {
      const res = await fetch("/api/pack/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flow, format, packSize }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setCurrentSessionId(data.sessionId);
        setCurrentPack(data.packMetadata);
      }
    } catch (e) {
      setError(`Ошибка сети: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerateSlot = async (slotId: number) => {
    if (!currentSessionId) return;
    setRegenSlot(slotId);
    try {
      const res = await fetch("/api/pack/regenerate-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId, slotId }),
      });
      const data = await res.json();
      if (res.ok && data.slot) {
        setCurrentPack(prev => prev ? { ...prev, slots: prev.slots.map(s => s.slotId === slotId ? data.slot : s) } : prev);
      } else {
        alert(data.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      alert(`Ошибка сети: ${(e as Error).message}`);
    } finally {
      setRegenSlot(null);
    }
  };

  const loadHistoryPack = (h: HistoryRow) => {
    if (!h.pack_metadata) return;
    setCurrentSessionId(h.id);
    setCurrentPack(h.pack_metadata);
  };

  const slotsByCategory = (cat: PackSlotCategory) =>
    currentPack?.slots.filter(s => s.category === cat) ?? [];

  return (
    <div>
      <PageHeader
        title="Конструктор"
        subtitle="Генератор пака на 20 креативов · 55% размножение + 25% discovery + 20% конкуренты"
      />

      {/* Controls */}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Поток</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["com", "gov"] as const).map(f => (
                <button key={f} onClick={() => setFlow(f)} style={{
                  padding: "8px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: flow === f ? 700 : 400,
                  border: flow === f ? "1.5px solid rgba(232,170,66,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: flow === f ? "rgba(232,170,66,0.1)" : "rgba(255,255,255,0.02)",
                  color: flow === f ? "#E8AA42" : "#666",
                }}>{f.toUpperCase()}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Формат</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["ugc", "static", "animation", "human", "mixed"] as const).map(fmt => (
                <button key={fmt} onClick={() => setFormat(fmt)} style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: format === fmt ? 700 : 400,
                  border: format === fmt ? "1.5px solid rgba(72,184,208,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: format === fmt ? "rgba(72,184,208,0.1)" : "rgba(255,255,255,0.02)",
                  color: format === fmt ? "#48B8D0" : "#666",
                }}>{fmt}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, color: "#555", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Размер пака</div>
            <div style={{ display: "flex", gap: 4 }}>
              {[5, 10, 20].map(n => (
                <button key={n} onClick={() => setPackSize(n)} style={{
                  padding: "8px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
                  fontWeight: packSize === n ? 700 : 400,
                  border: packSize === n ? "1.5px solid rgba(110,200,160,0.4)" : "1px solid rgba(255,255,255,0.06)",
                  background: packSize === n ? "rgba(110,200,160,0.1)" : "rgba(255,255,255,0.02)",
                  color: packSize === n ? "#6EC8A0" : "#666",
                }}>{n}</button>
              ))}
            </div>
          </div>

          <div style={{ marginLeft: "auto" }}>
            <Button onClick={handleGenerate} disabled={generating}>
              {generating ? "⏳ Генерация… (1-3 мин)" : `🚀 Сгенерировать пак (${packSize})`}
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <Card style={{ marginBottom: 16, borderColor: "rgba(217,107,107,0.3)" }}>
          <div style={{ fontSize: 12, color: "#D96B6B" }}>⚠️ {error}</div>
        </Card>
      )}

      {/* Current pack */}
      {currentPack && (
        <>
          {/* Summary */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#EEE" }}>{currentPack.slots.length}</div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Креативов</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#6EC8A0" }}>{currentPack.data_snapshot.winners}</div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Винеров в архиве</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#FF8B5A" }}>{currentPack.data_snapshot.fake_winners}</div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Fake winners</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#D96B6B" }}>{currentPack.data_snapshot.losers}</div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Лузеров</div>
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#C490D1" }}>{currentPack.data_snapshot.approved_competitors}</div>
                <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>Approved конкурентов</div>
              </div>
              {currentPack.cold_start && (
                <Badge color="#E8AA42">COLD START</Badge>
              )}
              <div style={{ marginLeft: "auto" }}>
                <Link href={`/briefs?session=${currentSessionId}`}>
                  <Button>→ Открыть в /briefs</Button>
                </Link>
              </div>
            </div>
          </Card>

          {/* Sections */}
          <GroupSection category="winner_family" slots={slotsByCategory("winner_family")} onRegenerate={handleRegenerateSlot} regenerating={regenSlot} />
          <GroupSection category="winner_mix"    slots={slotsByCategory("winner_mix")}    onRegenerate={handleRegenerateSlot} regenerating={regenSlot} />
          <GroupSection category="discovery"     slots={slotsByCategory("discovery")}     onRegenerate={handleRegenerateSlot} regenerating={regenSlot} />
          <GroupSection category="competitor"    slots={slotsByCategory("competitor")}    onRegenerate={handleRegenerateSlot} regenerating={regenSlot} />
        </>
      )}

      {/* History */}
      <Card style={{ marginTop: 24 }}>
        <SectionTitle icon="📜">История паков</SectionTitle>
        {history.length === 0 ? (
          <Empty icon="🌱" text="Паков ещё не было. Сгенерируй первый." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
            {history.map(h => (
              <div key={h.id} onClick={() => loadHistoryPack(h)} style={{
                padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                background: currentSessionId === h.id ? "rgba(232,170,66,0.08)" : "rgba(255,255,255,0.02)",
                border: currentSessionId === h.id ? "1px solid rgba(232,170,66,0.3)" : "1px solid rgba(255,255,255,0.04)",
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 12, color: "#DDD", fontWeight: 600 }}>{h.name}</span>
                <Badge color={(h.flow ?? "com") === "com" ? "#E8AA42" : "#48B8D0"}>{(h.flow ?? "com").toUpperCase()}</Badge>
                <Badge color="#888">{h.format}</Badge>
                <span style={{ fontSize: 11, color: "#666" }}>{h.pack_size} крео</span>
                {h.pack_metadata?.cold_start && <Badge color="#E8AA42">cold start</Badge>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#444" }}>
                  {h.generated_at ? new Date(h.generated_at).toLocaleString("ru-RU") : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function BuilderPage() {
  return (
    <Suspense fallback={<div style={{ padding: 60, color: "#444", textAlign: "center" }}>Загружаем…</div>}>
      <BuilderContent />
    </Suspense>
  );
}
