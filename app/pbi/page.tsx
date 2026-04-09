"use client";
import { useState } from "react";
import { Card, PageHeader, Button, SectionTitle, Label } from "@/components/ui";

interface ParsedRow {
  ad_name: string;
  leads: number;
  qual_leads: number;
  spend: number;
  revenue: number;
}

interface ColMap {
  ad_name: string;
  leads: string;
  qual_leads: string;
  spend: string;
  revenue: string;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const sep = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^["']|["']$/g, ""));
  const rows = lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.trim().replace(/^["']|["']$/g, ""));
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return { headers, rows };
}

function parseNum(v: string): number {
  if (!v) return 0;
  // Remove currency symbols, spaces, commas used as thousands separator
  return parseFloat(v.replace(/[€$\s]/g, "").replace(",", ".")) || 0;
}

// Try to auto-detect Elly columns
function autoDetect(headers: string[]): Partial<ColMap> {
  const map: Partial<ColMap> = {};
  for (const h of headers) {
    const l = h.toLowerCase();
    if (!map.ad_name && (l === "campaign" || l === "ad name" || l === "ad_name" || l === "название")) map.ad_name = h;
    if (!map.leads && (l === "leads" || l === "лиды")) map.leads = h;
    if (!map.qual_leads && (l === "ql" || l === "qual_leads" || l === "квал" || l.includes("qual"))) map.qual_leads = h;
    if (!map.spend && (l === "adv spend" || l === "spend" || l === "adv_spend" || l === "бюджет")) map.spend = h;
    if (!map.revenue && (l === "revenue" || l === "выручка" || l === "доход")) map.revenue = h;
  }
  return map;
}

export default function PbiPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [colMap, setColMap] = useState<ColMap>({ ad_name: "", leads: "", qual_leads: "", spend: "", revenue: "" });
  const [preview, setPreview] = useState<ParsedRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; uploaded?: number; synced?: number; error?: string } | null>(null);
  const [fileName, setFileName] = useState("");
  const [ellySyncing, setEllySyncing] = useState(false);

  const handleEllySync = async () => {
    setEllySyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/pbi/elly-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      setResult(data);
    } finally {
      setEllySyncing(false);
    }
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setPreview([]);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      setHeaders(h);
      setRawRows(r);
      const detected = autoDetect(h);
      setColMap({
        ad_name:    detected.ad_name    ?? h[0] ?? "",
        leads:      detected.leads      ?? "",
        qual_leads: detected.qual_leads ?? "",
        spend:      detected.spend      ?? "",
        revenue:    detected.revenue    ?? "",
      });
    };
    reader.readAsText(file, "UTF-8");
  };

  const buildRows = (): ParsedRow[] =>
    rawRows
      .map(r => ({
        ad_name:    (r[colMap.ad_name] ?? "").trim(),
        leads:      parseNum(r[colMap.leads] ?? ""),
        qual_leads: parseNum(r[colMap.qual_leads] ?? ""),
        spend:      parseNum(r[colMap.spend] ?? ""),
        revenue:    parseNum(r[colMap.revenue] ?? ""),
      }))
      .filter(r => r.ad_name && r.ad_name !== "Total" && r.ad_name !== "Facebook");

  const handleUpload = async () => {
    setUploading(true);
    setResult(null);
    try {
      const rows = buildRows();
      if (rows.length === 0) {
        setResult({ ok: false, error: "Нет строк для загрузки — проверь маппинг колонок" });
        return;
      }
      const res = await fetch("/api/pbi/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      setResult(data);
    } finally {
      setUploading(false);
    }
  };

  const mapField = (field: keyof ColMap) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setColMap(prev => ({ ...prev, [field]: e.target.value }));
    setPreview([]);
  };

  const validRows = rawRows.length > 0 ? buildRows() : [];

  return (
    <div>
      <PageHeader
        title="Загрузка PBI / Elly"
        subtitle="Синхронизация лидов из Elly для расчёта CPL, CPQL"
        action={
          <Button variant="primary" onClick={handleEllySync} disabled={ellySyncing}>
            {ellySyncing ? "⏳ Синхронизируем (~30 сек)..." : "🔄 Синк с Elly"}
          </Button>
        }
      />

      {/* Format hint */}
      <Card style={{ marginBottom: 20, background: "rgba(72,184,208,0.04)", border: "1px solid rgba(72,184,208,0.15)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#48B8D0", textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>
          Формат Elly
        </div>
        <div style={{ fontSize: 12, color: "#888", lineHeight: 1.7 }}>
          Экспортируй таблицу из Elly как CSV (с разделителем <b style={{ color: "#ccc" }}>Tab</b> или запятой).<br />
          Нужные колонки: <b style={{ color: "#E8AA42" }}>Campaign</b> (название объявления), <b style={{ color: "#6EC8A0" }}>Leads</b>, <b style={{ color: "#C490D1" }}>QL</b> (квал. лиды), Adv Spend.<br />
          <span style={{ color: "#555" }}>Строки "Total", "Facebook" пропускаются автоматически. ad_id не нужен — матчим по названию.</span>
        </div>
      </Card>

      {/* File upload */}
      <Card style={{ marginBottom: 20 }}>
        <SectionTitle icon="📂">Файл</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 18px",
            background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
            cursor: "pointer", fontSize: 12, color: "#AAA",
          }}>
            📎 Выбрать CSV
            <input type="file" accept=".csv,.txt,.tsv" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {fileName && (
            <span style={{ fontSize: 12, color: "#6EC8A0" }}>
              ✓ {fileName} — {rawRows.length} строк всего, {validRows.length} к загрузке
            </span>
          )}
        </div>
      </Card>

      {/* Column mapping */}
      {headers.length > 0 && (
        <Card style={{ marginBottom: 20 }}>
          <SectionTitle icon="🗺">Маппинг колонок</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {([
              ["ad_name",    "Название объявления *", true],
              ["leads",      "Лиды *",                true],
              ["qual_leads", "Квал. лиды (QL) *",     true],
              ["spend",      "Бюджет (опц.)",         false],
              ["revenue",    "Выручка (опц.)",        false],
            ] as [keyof ColMap, string, boolean][]).map(([field, label, required]) => (
              <div key={field}>
                <Label>{label}</Label>
                <select value={colMap[field]} onChange={mapField(field)}>
                  {!required && <option value="">— не используется —</option>}
                  {required && !colMap[field] && <option value="">— выбери колонку —</option>}
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Preview */}
          {validRows.length > 0 && (
            <div style={{ marginTop: 16, overflowX: "auto" }}>
              <div style={{ fontSize: 10, color: "#555", fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
                Предпросмотр первых 5 строк
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead>
                  <tr>
                    {["Название", "Leads", "QL", "Spend"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "4px 10px", color: "#555", fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 5).map((r, i) => (
                    <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "5px 10px", color: "#ccc", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ad_name}</td>
                      <td style={{ padding: "5px 10px", color: "#6EC8A0" }}>{r.leads}</td>
                      <td style={{ padding: "5px 10px", color: "#C490D1" }}>{r.qual_leads}</td>
                      <td style={{ padding: "5px 10px", color: "#E8AA42" }}>{r.spend ? `€${r.spend.toFixed(0)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={uploading || validRows.length === 0}
            >
              {uploading ? "⏳ Загружаем..." : `📤 Загрузить ${validRows.length} строк`}
            </Button>
          </div>
        </Card>
      )}

      {/* Result */}
      {result && (
        <Card style={{
          background: result.ok ? "rgba(110,200,160,0.06)" : "rgba(217,107,107,0.06)",
          border: `1px solid ${result.ok ? "rgba(110,200,160,0.25)" : "rgba(217,107,107,0.25)"}`,
        }}>
          {result.ok ? (
            <div>
              <div style={{ fontSize: 14, color: "#6EC8A0", fontWeight: 700, marginBottom: 8 }}>
                ✓ {result.synced ? `Синкнуто ${result.synced} объявлений из Elly` : `Загружено ${result.uploaded} кампаний`}
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>
                CPL и CPQL доступны в <b style={{ color: "#48B8D0" }}>Панели → PBI Аналитика</b>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 14, color: "#D96B6B" }}>Ошибка: {result.error}</div>
          )}
        </Card>
      )}
    </div>
  );
}
