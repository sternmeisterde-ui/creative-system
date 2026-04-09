"use client";
import { useState, useRef } from "react";
import { Card, PageHeader, Button, SectionTitle } from "@/components/ui";

type Mode = "single" | "winner" | "loser";

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 13, color: "#CCC", lineHeight: 1.9 }}>
      {text.split("\n").map((line, i) => {
        if (line.startsWith("### ") || line.startsWith("## ")) {
          return <div key={i} style={{ fontWeight: 700, color: "#48B8D0", fontSize: 13, marginTop: 16, marginBottom: 4 }}>{line.replace(/^#+\s*/, "")}</div>;
        }
        if (/^\*\*.*\*\*$/.test(line.trim())) {
          return <div key={i} style={{ fontWeight: 700, color: "#E8AA42", marginTop: 12, marginBottom: 2 }}>{line.replace(/\*\*/g, "")}</div>;
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return <div key={i} style={{ paddingLeft: 16, color: "#BBB" }}>• {line.slice(2).replace(/\*\*(.*?)\*\*/g, "$1")}</div>;
        }
        if (line.trim() === "" || line.trim() === "---") return <div key={i} style={{ height: 8 }} />;
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return (
          <div key={i} style={{ color: "#CCC" }}>
            {parts.map((p, j) => j % 2 === 1 ? <strong key={j} style={{ color: "#EEE" }}>{p}</strong> : p)}
          </div>
        );
      })}
    </div>
  );
}

function FileZone({ label, file, onFile, color }: { label: string; file: File | null; onFile: (f: File) => void; color: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const preview = file ? URL.createObjectURL(file) : null;
  const isVideo = file?.type.startsWith("video/");

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>{label}</div>
      <div
        onClick={() => ref.current?.click()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
        onDragOver={e => e.preventDefault()}
        style={{
          border: `2px dashed ${file ? color + "55" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 10, padding: file ? 8 : "28px 16px",
          textAlign: "center", cursor: "pointer", minHeight: 120,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: file ? `${color}08` : "rgba(255,255,255,0.01)",
        }}
      >
        {file && preview ? (
          isVideo
            ? <video src={preview} controls style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6 }} />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={preview} alt="" style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, objectFit: "contain" }} />
        ) : (
          <div>
            <div style={{ fontSize: 24, marginBottom: 6 }}>📎</div>
            <div style={{ fontSize: 11, color: "#555" }}>Перетащи или нажми</div>
          </div>
        )}
        <input ref={ref} type="file" accept="image/*,video/*" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>
      {file && <div style={{ fontSize: 10, color: "#555", marginTop: 4, textAlign: "center" }}>{file.name}</div>}
    </div>
  );
}

async function uploadFile(file: File): Promise<string> {
  // Step 1: get signed upload URL
  const presignRes = await fetch("/api/gemini/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, contentType: file.type }),
  });
  if (!presignRes.ok) throw new Error("Не удалось получить URL для загрузки");
  const { signedUrl, token, publicUrl } = await presignRes.json() as { signedUrl: string; token: string; publicUrl: string };

  // Step 2: upload directly to Supabase Storage
  const uploadRes = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type, "x-upsert": "true" },
    body: file,
  });
  if (!uploadRes.ok) throw new Error(`Ошибка загрузки файла: ${uploadRes.status}`);

  void token; // token included in signedUrl
  return publicUrl;
}

export default function AnalyzePage() {
  const [mode, setMode] = useState<Mode>("single");
  const [file, setFile] = useState<File | null>(null);
  const [winner, setWinner] = useState<File | null>(null);
  const [loser, setLoser] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<string | null>(null);
  const [recipeLoading, setRecipeLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  const reset = () => { setFile(null); setWinner(null); setLoser(null); setAnalysis(null); setError(null); setUploadStatus(null); };

  const loadRecipe = async () => {
    setRecipeLoading(true);
    setRecipe(null);
    try {
      const res = await fetch("/api/gemini/recipe", { method: "POST" });
      const data = await res.json();
      if (data.error) setError(data.error);
      else setRecipe(data.recipe);
    } catch {
      setError("Сетевая ошибка");
    } finally {
      setRecipeLoading(false);
    }
  };

  const canAnalyze = mode === "single" ? !!file : (!!winner && !!loser);

  const analyze = async (analysisMode: Mode) => {
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    setUploadStatus(null);

    try {
      let body: Record<string, string>;

      if (analysisMode === "single" && file) {
        setUploadStatus("Загружаем файл...");
        const fileUrl = await uploadFile(file);
        setUploadStatus("Анализируем...");
        body = { mode: analysisMode, fileUrl, fileName: file.name };
      } else if (winner && loser) {
        setUploadStatus("Загружаем виннера...");
        const winnerUrl = await uploadFile(winner);
        setUploadStatus("Загружаем лузера...");
        const loserUrl = await uploadFile(loser);
        setUploadStatus("Анализируем...");
        body = { mode: analysisMode, winnerUrl, loserUrl, winnerName: winner.name, loserName: loser.name };
      } else {
        return;
      }

      const res = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(290_000),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Ошибка");
      else setAnalysis(data.analysis);
    } catch (e) {
      const msg = e instanceof Error && e.name === "TimeoutError"
        ? "Превышено время ожидания — попробуйте файл поменьше"
        : e instanceof Error ? e.message : "Сетевая ошибка";
      setError(msg);
    } finally {
      setAnalyzing(false);
      setUploadStatus(null);
    }
  };

  const MODES: { id: Mode; label: string }[] = [
    { id: "single", label: "Одиночный анализ" },
    { id: "winner", label: "Анализ виннера" },
    { id: "loser", label: "Анализ лузера" },
  ];

  return (
    <div>
      <PageHeader
        title="Анализ креатива"
        subtitle="Одиночный разбор или сравнение виннера с лузером через Gemini"
      />

      {/* Recipe button */}
      <Card style={{ marginBottom: 20, background: "rgba(232,170,66,0.05)", border: "1px solid rgba(232,170,66,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#E8AA42", marginBottom: 4 }}>Как сделать виннера?</div>
            <div style={{ fontSize: 11, color: "#666" }}>Gemini синтезирует паттерны из всех накопленных анализов</div>
          </div>
          <Button onClick={loadRecipe} disabled={recipeLoading}
            style={{ background: "rgba(232,170,66,0.15)", borderColor: "rgba(232,170,66,0.3)", color: "#E8AA42", whiteSpace: "nowrap" }}>
            {recipeLoading ? "⏳ Генерируем..." : "✨ Получить рецепт"}
          </Button>
        </div>
        {recipe && (
          <div style={{ marginTop: 16, borderTop: "1px solid rgba(232,170,66,0.15)", paddingTop: 16 }}>
            <MarkdownBlock text={recipe} />
          </div>
        )}
      </Card>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {MODES.map(m => (
          <button key={m.id} onClick={() => { setMode(m.id); reset(); }} style={{
            padding: "8px 18px", borderRadius: 8, fontSize: 12, cursor: "pointer",
            fontWeight: mode === m.id ? 700 : 400, fontFamily: "inherit",
            border: mode === m.id ? "1px solid rgba(72,184,208,0.35)" : "1px solid rgba(255,255,255,0.07)",
            background: mode === m.id ? "rgba(72,184,208,0.12)" : "rgba(255,255,255,0.02)",
            color: mode === m.id ? "#48B8D0" : "#666",
          }}>
            {m.id === "winner" ? "🏆 " : m.id === "loser" ? "📉 " : "🔍 "}{m.label}
          </button>
        ))}
      </div>

      {/* Upload zone(s) */}
      <Card style={{ marginBottom: 20 }}>
        {mode === "single" ? (
          <FileZone label="Креатив" file={file} onFile={setFile} color="#48B8D0" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <FileZone label="Виннер" file={winner} onFile={setWinner} color="#6EC8A0" />
            <FileZone label="Лузер" file={loser} onFile={setLoser} color="#D96B6B" />
          </div>
        )}

        {canAnalyze && (
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {mode === "single" ? (
              <Button variant="primary" onClick={() => analyze("single")} disabled={analyzing}>
                {analyzing ? `⏳ ${uploadStatus ?? "Анализируем..."}` : "🔍 Анализировать"}
              </Button>
            ) : (
              <>
                <Button variant="primary" onClick={() => analyze("winner")} disabled={analyzing}
                  style={{ background: "rgba(110,200,160,0.15)", borderColor: "rgba(110,200,160,0.3)", color: "#6EC8A0" }}>
                  {analyzing ? `⏳ ${uploadStatus ?? "..."}` : "🏆 Почему виннер победил"}
                </Button>
                <Button variant="primary" onClick={() => analyze("loser")} disabled={analyzing}
                  style={{ background: "rgba(217,107,107,0.15)", borderColor: "rgba(217,107,107,0.3)", color: "#D96B6B" }}>
                  {analyzing ? `⏳ ${uploadStatus ?? "..."}` : "📉 Почему лузер провалился"}
                </Button>
              </>
            )}
            <Button onClick={reset} disabled={analyzing}>Очистить</Button>
          </div>
        )}
      </Card>

      {error && (
        <Card style={{ background: "rgba(217,107,107,0.06)", border: "1px solid rgba(217,107,107,0.2)", marginBottom: 20 }}>
          <div style={{ color: "#D96B6B", fontSize: 13 }}>Ошибка: {error}</div>
        </Card>
      )}

      {analysis && (
        <Card style={{ background: "rgba(72,184,208,0.04)", border: "1px solid rgba(72,184,208,0.15)" }}>
          <SectionTitle icon="🤖">Анализ Gemini</SectionTitle>
          <MarkdownBlock text={analysis} />
        </Card>
      )}
    </div>
  );
}
