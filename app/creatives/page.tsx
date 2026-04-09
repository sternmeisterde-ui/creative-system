"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { PageHeader, Card, Badge, Empty } from "@/components/ui";

type Generation = {
  id: string;
  format: string;
  model: string;
  prompt: string;
  is_static: boolean;
  status: string;
  result_url: string | null;
  error_message: string | null;
  revision_note: string | null;
  created_at: string;
  scene_group_id: string | null;
  scene_index: number | null;
  audio_url: string | null;
  lipsynced_url: string | null;
  briefs?: {
    id: string;
    adapted_hook: string | null;
    adapted_body: string | null;
    adapted_angle: string | null;
    format: string;
    personas?: { name: string; code: string } | null;
    hooks?: { name: string; code: string } | null;
    bodies?: { name: string; code: string } | null;
    angles?: { name: string; code: string } | null;
  } | null;
};

type SceneGroup = {
  id: string;
  brief_id: string;
  format: string;
  model: string;
  scene_count: number;
  status: string;
  voiceover_done: boolean;
  final_url: string | null;
  error_message: string | null;
  creatomate_render_id: string | null;
  montage_notes: string | null;
  created_at: string;
};

const STATUS_COLOR: Record<string, string> = {
  done: "#6EC8A0",
  processing: "#48B8D0",
  queued: "#E8AA42",
  error: "#D96B6B",
};

const STATUS_LABEL: Record<string, string> = {
  done: "Готово",
  processing: "Генерируется",
  queued: "В очереди",
  error: "Ошибка",
};

const FORMAT_LABEL: Record<string, string> = {
  static: "Статика",
  ugc: "UGC",
  animation: "Анимация",
  human: "Human",
};

function CodeBadge({ code, color }: { code?: string; color: string }) {
  if (!code) return null;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, fontFamily: "monospace",
      color, background: `${color}18`, padding: "1px 6px",
      borderRadius: 4, border: `1px solid ${color}25`,
    }}>{code}</span>
  );
}

function RevisionBox({
  id, initial, briefId, personaName, model, existingPrompt,
}: {
  id: string;
  initial: string | null;
  briefId?: string;
  personaName?: string;
  model?: string;
  existingPrompt?: string;
}) {
  const [note, setNote] = useState(initial ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "regenerating" | "queued" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const saveAndRegenerate = async () => {
    if (!note.trim() || !briefId) return;
    setStatus("saving");
    setErrorMsg("");
    try {
      // 1. Save revision note
      await fetch("/api/creatives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, revisionNote: note }),
      });

      // 2. Trigger regeneration with revision note incorporated
      setStatus("regenerating");
      const res = await fetch("/api/creative-gen/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ briefId, personaName, modelSlug: model, revisionNote: note, existingPrompt }),
      });
      const data = await res.json();
      if (!data.ok) { setStatus("error"); setErrorMsg(data.error ?? "Ошибка"); return; }
      setStatus("queued");
    } catch (e) {
      setStatus("error");
      setErrorMsg(String(e));
    }
  };

  const isLoading = status === "saving" || status === "regenerating";

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
      <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
        Правки
      </div>
      <textarea
        value={note}
        onChange={e => { setNote(e.target.value); setStatus("idle"); }}
        placeholder="Напишите что нужно изменить: цвет, текст, стиль, замена модели..."
        rows={3}
        disabled={isLoading}
        style={{
          width: "100%", background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
          color: "#ccc", fontSize: 12, padding: "8px 10px", resize: "vertical",
          fontFamily: "inherit", outline: "none", boxSizing: "border-box",
          opacity: isLoading ? 0.5 : 1,
        }}
      />
      {status === "error" && (
        <div style={{ fontSize: 11, color: "#D96B6B", marginTop: 4 }}>✕ {errorMsg}</div>
      )}
      {status === "queued" && (
        <div style={{ fontSize: 11, color: "#48B8D0", marginTop: 4 }}>
          Перегенерация запущена — новый креатив появится автоматически
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button
          onClick={saveAndRegenerate}
          disabled={isLoading || !note.trim() || !briefId}
          style={{
            background: status === "queued" ? "rgba(72,184,208,0.12)" : "rgba(232,170,66,0.1)",
            border: `1px solid ${status === "queued" ? "rgba(72,184,208,0.3)" : "rgba(232,170,66,0.25)"}`,
            color: status === "queued" ? "#48B8D0" : "#E8AA42",
            borderRadius: 6, padding: "5px 14px", fontSize: 11,
            cursor: (isLoading || !note.trim() || !briefId) ? "default" : "pointer",
            fontFamily: "inherit", opacity: (isLoading || !note.trim() || !briefId) ? 0.5 : 1,
          }}
        >
          {status === "saving" ? "Сохраняю..."
            : status === "regenerating" ? "Запускаю перегенерацию..."
            : status === "queued" ? "✓ В работе"
            : "Отправить на перегенерацию"}
        </button>
      </div>
    </div>
  );
}

function ElapsedTimer({ createdAt }: { createdAt: string }) {
  const [elapsed, setElapsed] = useState(() => Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000));
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)), 1000);
    return () => clearInterval(t);
  }, [createdAt]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const isLong = elapsed > 180;
  return (
    <span style={{ fontSize: 10, color: isLong ? "#D96B6B" : "#555", fontVariantNumeric: "tabular-nums" }}>
      {m}:{String(s).padStart(2, "0")}
    </span>
  );
}

function CreativeCard({ gen, onForceError }: { gen: Generation; onForceError: (id: string) => void }) {
  const brief = gen.briefs;
  const isStatic = gen.is_static;
  const isProcessing = gen.status === "processing" || gen.status === "queued";

  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <Badge color={STATUS_COLOR[gen.status] ?? "#555"}>{STATUS_LABEL[gen.status] ?? gen.status}</Badge>
        <Badge color="#555">{FORMAT_LABEL[gen.format] ?? gen.format}</Badge>
        <span style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{gen.model}</span>
        {isProcessing && <ElapsedTimer createdAt={gen.created_at} />}
        {isProcessing && (
          <button
            onClick={() => onForceError(gen.id)}
            title="Отменить генерацию"
            style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 12, padding: "0 4px", marginLeft: 2 }}
          >✕</button>
        )}
        <span style={{ fontSize: 10, color: "#333", marginLeft: "auto" }}>
          {new Date(gen.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Codes */}
      {brief && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <CodeBadge code={brief.personas?.code} color="#48B8D0" />
          <CodeBadge code={brief.hooks?.code} color="#C490D1" />
          <CodeBadge code={brief.bodies?.code} color="#6EC8A0" />
          <CodeBadge code={brief.angles?.code} color="#FF8B5A" />
          {brief.personas?.name && (
            <span style={{ fontSize: 11, color: "#666" }}>{brief.personas.name}</span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Preview */}
        <div style={{ flexShrink: 0 }}>
          {gen.status === "done" && gen.result_url ? (
            isStatic ? (
              <a href={gen.result_url} target="_blank" rel="noreferrer">
                <img
                  src={gen.result_url}
                  alt="Creative"
                  style={{ width: 180, height: 225, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(110,200,160,0.2)", display: "block" }}
                />
              </a>
            ) : (
              <video
                src={gen.result_url}
                controls
                style={{ width: 180, borderRadius: 8, border: "1px solid rgba(72,184,208,0.2)", display: "block" }}
              />
            )
          ) : (
            <div style={{
              width: 180, height: 225, borderRadius: 8, background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center",
              justifyContent: "center", flexDirection: "column", gap: 8,
            }}>
              {gen.status === "processing" || gen.status === "queued" ? (
                <>
                  <div style={{ fontSize: 24 }}>⏳</div>
                  <div style={{ fontSize: 11, color: "#555", textAlign: "center" }}>
                    {gen.status === "queued" ? "В очереди" : "Генерируется..."}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 24 }}>✕</div>
                  <div style={{ fontSize: 10, color: "#D96B6B", textAlign: "center", padding: "0 8px" }}>
                    {gen.error_message ?? "Ошибка"}
                  </div>
                </>
              )}
            </div>
          )}

          {gen.status === "done" && gen.result_url && (
            <a
              href={`/api/creatives/download?id=${gen.id}`}
              style={{
                display: "block", marginTop: 6, textAlign: "center",
                fontSize: 11, color: "#555", textDecoration: "none",
              }}
            >
              ⬇ Скачать
            </a>
          )}
        </div>

        {/* Right side */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Prompt */}
          <div style={{ fontSize: 10, color: "#444", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Промпт</div>
          <div style={{
            fontSize: 11, color: "#666", lineHeight: 1.5,
            background: "rgba(255,255,255,0.02)", borderRadius: 6,
            padding: "8px 10px", marginBottom: 8,
            maxHeight: 80, overflow: "hidden",
          }}>
            {gen.prompt}
          </div>

          {/* Brief content */}
          {brief?.adapted_hook && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#C490D1", fontWeight: 700 }}>ХУК: </span>
              <span style={{ fontSize: 11, color: "#777" }}>{brief.adapted_hook}</span>
            </div>
          )}
          {brief?.adapted_body && (
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: "#6EC8A0", fontWeight: 700 }}>БОДИ: </span>
              <span style={{ fontSize: 11, color: "#777" }}>{brief.adapted_body}</span>
            </div>
          )}

          {/* Revision */}
          <RevisionBox
            id={gen.id}
            initial={gen.revision_note}
            briefId={gen.briefs?.id}
            personaName={gen.briefs?.personas?.name}
            model={gen.model}
            existingPrompt={gen.prompt}
          />
        </div>
      </div>
    </Card>
  );
}

function SceneGroupCard({ group, scenes, onReload }: { group: SceneGroup; scenes: Generation[]; onReload: () => void }) {
  const done    = scenes.filter(s => s.status === "done").length;
  const inProg  = scenes.filter(s => s.status === "processing" || s.status === "queued").length;
  const errored = scenes.filter(s => s.status === "error").length;
  const total   = scenes.length;
  const pct     = total > 0 ? Math.round(done / total * 100) : 0;

  const [stitching, setStitching]       = useState(false);
  const [stitchError, setStitchError]   = useState("");
  const [voicing, setVoicing]           = useState(false);
  const [voiceError, setVoiceError]     = useState("");
  const [lipsyncing, setLipsyncing]         = useState(false);
  const [lipsyncError, setLipsyncError]     = useState("");
  const [cancellingLipsync, setCancelling]  = useState(false);
  const [montageNotes, setMontageNotes]     = useState(group.montage_notes ?? "");
  const [notesSaved, setNotesSaved]         = useState(false);

  const saveMontageNotes = async (value: string) => {
    await fetch("/api/creative-gen/scene-group-status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: group.id, montageNotes: value }),
    });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  };
  const [voiceGender, setVoiceGender]   = useState<"female" | "male">("female");

  const VOICE_IDS = {
    female: "cgSgspJ2msm6clMCkdW9", // Jessica
    male:   "onwK4e9ZLuTAKqWW03F9", // Daniel
  };

  const stitch = async () => {
    setStitching(true); setStitchError("");
    try {
      const res = await fetch("/api/creative-gen/stitch-scenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneGroupId: group.id }),
      });
      const data = await res.json();
      if (!data.ok) setStitchError(data.error ?? "Ошибка");
    } catch (e) { setStitchError(String(e)); } finally { setStitching(false); }
  };

  const generateVoices = async () => {
    setVoicing(true); setVoiceError("");
    try {
      const res = await fetch("/api/creative-gen/generate-voices", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneGroupId: group.id, voiceId: VOICE_IDS[voiceGender] }),
      });
      const data = await res.json();
      if (!data.ok) setVoiceError(data.error ?? "Ошибка");
    } catch (e) { setVoiceError(String(e)); } finally { setVoicing(false); }
  };

  const cancelLipsync = async () => {
    setCancelling(true);
    try {
      await fetch("/api/creative-gen/cancel-lipsync", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneGroupId: group.id }),
      });
    } finally { setCancelling(false); }
  };

  const runLipsync = async () => {
    setLipsyncing(true); setLipsyncError("");
    try {
      const res = await fetch("/api/creative-gen/lipsync-scenes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneGroupId: group.id }),
      });
      const data = await res.json();
      if (!data.ok) setLipsyncError(data.error ?? "Ошибка");
    } catch (e) { setLipsyncError(String(e)); } finally { setLipsyncing(false); }
  };

  const audioReady  = scenes.filter(s => s.audio_url).length;
  const lipsyncDone = scenes.filter(s => s.lipsynced_url).length;

  const statusColor =
    group.status === "done"      ? "#6EC8A0" :
    group.status === "stitching" ? "#C490D1" :
    group.status === "lipsync"   ? "#FF8B5A" :
    group.status === "error"     ? "#D96B6B" : "#48B8D0";

  const statusLabel =
    group.status === "done"      ? "Готово" :
    group.status === "stitching" ? "Монтаж..." :
    group.status === "lipsync"   ? "Lipsync..." :
    group.status === "error"     ? "Ошибка" : "Генерируется";

  const canVoice   = group.status === "done" && done > 0 && (!group.voiceover_done || audioReady < done);
  const canLipsync = group.voiceover_done && audioReady > 0 && group.status === "done" && lipsyncDone < audioReady;
  const canStitch  = (group.status === "done" || group.status === "error") && !group.final_url && done > 0;

  return (
    <Card style={{ border: `1px solid ${statusColor}20` }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Badge color={statusColor}>{statusLabel}</Badge>
        <Badge color="#555">Серия · {total} сцен</Badge>
        <span style={{ fontSize: 10, color: "#444", fontFamily: "monospace" }}>{group.model}</span>
        <span style={{ fontSize: 10, color: "#333", marginLeft: "auto" }}>
          {new Date(group.created_at).toLocaleDateString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      {/* Final stitched video */}
      {group.final_url && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: "#6EC8A0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Смонтированное видео
          </div>
          <video
            src={group.final_url}
            controls
            style={{ width: "100%", maxWidth: 320, borderRadius: 8, border: "1px solid rgba(110,200,160,0.3)", display: "block" }}
          />
          <a
            href={group.final_url}
            target="_blank"
            rel="noreferrer"
            style={{ display: "inline-block", marginTop: 6, fontSize: 11, color: "#555", textDecoration: "none" }}
          >
            ⬇ Скачать финал
          </a>
        </div>
      )}

      {/* Progress bar while generating */}
      {group.status === "generating" && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#555", marginBottom: 4 }}>
            <span>{done}/{total} сцен · {inProg} в процессе · {errored} ошибок</span>
            <span>{pct}%</span>
          </div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2 }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#48B8D0", borderRadius: 2, transition: "width 0.5s" }} />
          </div>
        </div>
      )}

      {/* Lipsync progress with cancel */}
      {group.status === "lipsync" && (
        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#FF8B5A" }}>Lipsync в процессе...</span>
          <button onClick={cancelLipsync} disabled={cancellingLipsync} style={{
            background: "rgba(217,107,107,0.1)", border: "1px solid rgba(217,107,107,0.3)",
            color: "#D96B6B", borderRadius: 6, padding: "4px 10px", fontSize: 11,
            cursor: cancellingLipsync ? "default" : "pointer", fontFamily: "inherit",
          }}>
            {cancellingLipsync ? "Отменяю..." : "Отменить"}
          </button>
        </div>
      )}

      {/* Stitching progress */}
      {group.status === "stitching" && (
        <div style={{ marginBottom: 12, fontSize: 11, color: "#C490D1" }}>
          Creatomate монтирует видео...
        </div>
      )}

      {/* Scene grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
        {scenes.map(scene => (
          <div key={scene.id} style={{
            borderRadius: 8, background: "rgba(255,255,255,0.02)",
            border: `1px solid ${STATUS_COLOR[scene.status] ?? "#333"}25`,
            overflow: "hidden",
          }}>
            {scene.status === "done" && scene.result_url ? (
              <video src={scene.result_url} controls style={{ width: "100%", display: "block" }} />
            ) : (
              <div style={{ height: 100, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 4, padding: "0 8px" }}>
                <span style={{ fontSize: 11, color: STATUS_COLOR[scene.status] ?? "#555" }}>
                  {STATUS_LABEL[scene.status] ?? scene.status}
                </span>
                {(scene.status === "processing" || scene.status === "queued") && (
                  <ElapsedTimer createdAt={scene.created_at} />
                )}
                {scene.status === "error" && scene.error_message && (
                  <span style={{ fontSize: 9, color: "#666", textAlign: "center", lineHeight: 1.3, maxHeight: 48, overflow: "hidden" }}>
                    {scene.error_message.slice(0, 120)}
                  </span>
                )}
              </div>
            )}
            <div style={{ padding: "4px 8px", borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10, color: "#444" }}>
                Сцена {scene.scene_index ?? "?"}
                {scene.audio_url    && <span style={{ color: "#48B8D0", marginLeft: 4 }}>🎙</span>}
                {scene.lipsynced_url && <span style={{ color: "#FF8B5A", marginLeft: 2 }}>💋</span>}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {scene.status === "error" && (
                  <button
                    onClick={async () => {
                      await fetch("/api/creative-gen/retry-scene", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ genId: scene.id }),
                      });
                      onReload();
                    }}
                    title="Перегенерировать сцену"
                    style={{ fontSize: 12, background: "none", border: "none", cursor: "pointer", color: "#E8AA42", padding: 0 }}
                  >↺</button>
                )}
                {scene.status === "done" && scene.result_url && (
                  <a href={`/api/creatives/download?id=${scene.id}`}
                    style={{ fontSize: 10, color: "#555", textDecoration: "none" }}>⬇</a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {/* Montage notes — always visible for series */}
      <div style={{ marginTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
            ТЗ на монтаж
          </span>
          {notesSaved && (
            <span style={{ fontSize: 10, color: "#6EC8A0" }}>Сохранено</span>
          )}
        </div>
        <textarea
          value={montageNotes}
          onChange={e => setMontageNotes(e.target.value)}
          onBlur={e => saveMontageNotes(e.target.value)}
          placeholder="Субтитры жёлтые, акцент на 3-й сцене, переход fade, субтитры крупнее..."
          rows={3}
          style={{
            width: "100%", background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
            color: "#ccc", fontSize: 12, padding: "8px 10px", resize: "vertical",
            fontFamily: "inherit", outline: "none", boxSizing: "border-box",
          }}
        />
      </div>

      {(canVoice || canLipsync || canStitch) && (
        <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {canVoice && (
            <>
              <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
                {(["female", "male"] as const).map(g => (
                  <button key={g} onClick={() => setVoiceGender(g)} style={{
                    padding: "6px 12px", fontSize: 11, fontFamily: "inherit", cursor: "pointer",
                    background: voiceGender === g ? "rgba(72,184,208,0.2)" : "transparent",
                    color: voiceGender === g ? "#48B8D0" : "#555",
                    border: "none", borderRight: g === "female" ? "1px solid rgba(255,255,255,0.1)" : "none",
                  }}>
                    {g === "female" ? "♀ Женский" : "♂ Мужской"}
                  </button>
                ))}
              </div>
              <button onClick={generateVoices} disabled={voicing} style={{
                background: "rgba(72,184,208,0.1)", border: "1px solid rgba(72,184,208,0.3)",
                color: "#48B8D0", borderRadius: 8, padding: "7px 16px", fontSize: 12,
                cursor: voicing ? "default" : "pointer", fontFamily: "inherit", opacity: voicing ? 0.6 : 1,
              }}>
                {voicing ? "Генерируем войсовер..." : `Войсовер (${done} сцен)`}
              </button>
            </>
          )}
          {group.voiceover_done && (
            <span style={{ fontSize: 11, color: "#48B8D0" }}>
              Аудио: {audioReady}/{done}
            </span>
          )}
          {canLipsync && (
            <button onClick={runLipsync} disabled={lipsyncing} style={{
              background: "rgba(255,139,90,0.1)", border: "1px solid rgba(255,139,90,0.3)",
              color: "#FF8B5A", borderRadius: 8, padding: "7px 16px", fontSize: 12,
              cursor: lipsyncing ? "default" : "pointer", fontFamily: "inherit", opacity: lipsyncing ? 0.6 : 1,
            }}>
              {lipsyncing ? "Запускаем lipsync..." : `Lipsync (${audioReady} сцен)`}
            </button>
          )}
          {lipsyncDone > 0 && (
            <span style={{ fontSize: 11, color: "#FF8B5A" }}>
              Lipsync: {lipsyncDone}/{done}
            </span>
          )}
          {canStitch && (
            <button onClick={stitch} disabled={stitching} style={{
              background: "rgba(196,144,209,0.1)", border: "1px solid rgba(196,144,209,0.3)",
              color: "#C490D1", borderRadius: 8, padding: "7px 16px", fontSize: 12,
              cursor: stitching ? "default" : "pointer", fontFamily: "inherit", opacity: stitching ? 0.6 : 1,
            }}>
              {stitching ? "Отправляем в Creatomate..." : `Смонтировать ${lipsyncDone > 0 ? lipsyncDone : done} сцен`}
            </button>
          )}
        </div>
      )}
      {(voiceError || lipsyncError || stitchError) && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#D96B6B" }}>
          {voiceError || lipsyncError || stitchError}
        </div>
      )}

      {group.status === "error" && group.error_message && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#D96B6B" }}>{group.error_message}</div>
      )}
    </Card>
  );
}

export default function CreativesPage() {
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [sceneGroups, setSceneGroups] = useState<SceneGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "done" | "processing" | "error">("all");
  const [tab, setTab] = useState<"singles" | "series">("singles");
  const fetchingRef = useRef(false);

  const load = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      try {
        const res = await fetch("/api/creatives", { signal: ctrl.signal });
        const data = await res.json();
        if (data.ok) {
          setGenerations(data.generations);
          setSceneGroups(data.sceneGroups ?? []);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // timeout or network error — silently skip
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 12000);
    return () => clearInterval(interval);
  }, [load]);

  // Singles = generations NOT part of a scene group
  const singles = generations.filter(g => !g.scene_group_id);
  const filtered = filter === "all" ? singles : singles.filter(g => g.status === filter);
  const counts = {
    all: singles.length,
    done: singles.filter(g => g.status === "done").length,
    processing: singles.filter(g => g.status === "processing" || g.status === "queued").length,
    error: singles.filter(g => g.status === "error").length,
  };

  const filterTabs: { key: typeof filter; label: string; color: string }[] = [
    { key: "all", label: "Все", color: "#777" },
    { key: "done", label: "Готовые", color: "#6EC8A0" },
    { key: "processing", label: "В процессе", color: "#48B8D0" },
    { key: "error", label: "Ошибки", color: "#D96B6B" },
  ];

  const seriesInProgress = sceneGroups.filter(g => g.status === "generating").length;

  return (
    <div>
      <PageHeader
        title="Готовые крео"
        subtitle={`${counts.done} одиночных · ${sceneGroups.length} серий · ${seriesInProgress > 0 ? `${seriesInProgress} генерируется` : ""}`}
        action={
          <button onClick={load} style={{
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
            color: "#888", borderRadius: 8, padding: "7px 14px", fontSize: 12,
            cursor: "pointer", fontFamily: "inherit",
          }}>↻ Обновить</button>
        }
      />

      {/* Top-level tab: singles vs series */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: 4 }}>
        {([
          { key: "singles" as const, label: `Одиночные (${singles.length})`, color: "#E8AA42" },
          { key: "series"  as const, label: `Серии (${sceneGroups.length})`, color: "#48B8D0" },
        ]).map(t => {
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: "8px 12px", borderRadius: 8,
              border: active ? `1px solid ${t.color}30` : "1px solid transparent",
              background: active ? `${t.color}10` : "transparent",
              color: active ? t.color : "#555",
              fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
            }}>{t.label}</button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: "center", color: "#444", padding: 60 }}>Загрузка...</div>
      ) : tab === "series" ? (
        sceneGroups.length === 0 ? (
          <Empty icon="🎞" text="Нет серий. Одобрите бриф и нажмите Серия сцен." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {sceneGroups.map(group => (
              <SceneGroupCard
                key={group.id}
                group={group}
                scenes={generations
                  .filter(g => g.scene_group_id === group.id)
                  .sort((a, b) => (a.scene_index ?? 0) - (b.scene_index ?? 0))}
                onReload={load}
              />
            ))}
          </div>
        )
      ) : (
        <>
          {/* Filter tabs for singles */}
          <div style={{ display: "flex", gap: 4, marginBottom: 24, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: 4 }}>
            {filterTabs.map(t => {
              const active = filter === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setFilter(t.key)}
                  style={{
                    flex: 1, padding: "8px 12px", borderRadius: 8, border: active ? `1px solid ${t.color}30` : "1px solid transparent",
                    background: active ? `${t.color}10` : "transparent", color: active ? t.color : "#555",
                    fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {t.label} <span style={{ opacity: 0.7 }}>({counts[t.key]})</span>
                </button>
              );
            })}
          </div>

          {filtered.length === 0 ? (
            <Empty icon="🎬" text="Нет креативов. Одобрите бриф и запустите генерацию." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {filtered.map(gen => (
                <CreativeCard
                  key={gen.id}
                  gen={gen}
                  onForceError={async (id) => {
                    await fetch("/api/creatives/force-error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
                    await load();
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
