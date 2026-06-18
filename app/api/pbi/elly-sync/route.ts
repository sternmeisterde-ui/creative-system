import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { runAlertCheck } from "@/lib/alert-check";

// Plurio sync = MCP-SSE + LLM-обработка + опциональный polling.
// Hobby plan cap = 300s. При длинных запросах синкаем помесячно, чтобы укладываться.
export const maxDuration = 300;

const MCP_BASE   = "https://mcp-ryen.onrender.com";
const ELLY_BASE  = "https://agi.ellyanalytics.com";
const PLURIO_KEY = process.env.PLURIO_API_KEY!;
const PROJECT_ID = process.env.PLURIO_PROJECT_ID ?? "569543d3-d4ff-497d-873c-5de47c3385ee";

// ── SSE reader ────────────────────────────────────────────────────────────────

class SseReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buf = "";

  constructor(res: Response) {
    this.reader = res.body!.getReader();
  }

  async next(): Promise<{ type: string; data: string } | null> {
    let evt = { type: "message", data: "" };
    while (true) {
      const end = this.buf.indexOf("\n\n");
      if (end !== -1) {
        const block = this.buf.slice(0, end);
        this.buf = this.buf.slice(end + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) evt.type = line.slice(7).trim();
          else if (line.startsWith("data: ")) evt.data = line.slice(6).trim();
        }
        if (evt.data) return evt;
        evt = { type: "message", data: "" };
        continue;
      }
      const { done, value } = await this.reader.read();
      if (done) return null;
      this.buf += this.decoder.decode(value, { stream: true });
    }
  }

  close() { this.reader.cancel().catch(() => {}); }
}

// ── MCP helpers ───────────────────────────────────────────────────────────────

async function mcpConnect(): Promise<{ sse: SseReader; sessionUrl: string }> {
  const sseRes = await fetch(
    `${MCP_BASE}/sse?base_url=${ELLY_BASE}&api_key=${PLURIO_KEY}`,
    { headers: { Accept: "text/event-stream" } }
  );
  if (!sseRes.ok || !sseRes.body) throw new Error(`SSE connect failed: ${sseRes.status}`);

  const sse = new SseReader(sseRes);
  const endpointEvt = await sse.next();
  if (!endpointEvt || endpointEvt.type !== "endpoint") throw new Error("No endpoint event");
  const sessionUrl = `${MCP_BASE}${endpointEvt.data}`;

  await rpc(sessionUrl, 1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "sternmeister-sync", version: "1.0.0" },
  });
  await sse.next(); // consume initialize response
  await rpc(sessionUrl, 0, "notifications/initialized", {});

  return { sse, sessionUrl };
}

async function rpc(sessionUrl: string, id: number, method: string, params: unknown) {
  const res = await fetch(sessionUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!res.ok) throw new Error(`MCP POST ${method} → ${res.status}`);
}

// ── Collect SSE result for a single tool call (id: 2) ────────────────────────

async function collectToolResult(sse: SseReader, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const texts: string[] = [];

  while (Date.now() < deadline) {
    const evt = await sse.next();
    if (!evt) break;
    if (evt.type !== "message") continue;

    let msg: { id?: number; result?: { content?: { type: string; text: string }[] }; params?: unknown };
    try { msg = JSON.parse(evt.data); } catch { continue; }

    const content =
      msg.result?.content ??
      (msg.params as { content?: { type: string; text: string }[] } | undefined)?.content ?? [];
    for (const c of content) {
      if (c.type === "text" && c.text) texts.push(c.text);
    }

    if (msg.id === 2 && msg.result) return texts.join("\n");
  }

  return texts.join("\n");
}

// ── Parse Plurio table response ───────────────────────────────────────────────

interface EllyRow {
  date: string;          // конкретный день YYYY-MM-DD (дневная разбивка), "" если Plurio не отдал
  adId: string;
  adName: string;
  leads: number;
  qualLeads: number;
  spend: number;
  revenue: number;
}

// Date из ответа Plurio → строгий YYYY-MM-DD (или "" если не распознан).
function parseDate(v: unknown): string {
  const m = String(v ?? "").match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function parseNum(v: unknown): number {
  if (typeof v === "number") return v;
  return parseFloat(String(v ?? "").replace(/[€\s\u00a0]/g, "").replace(",", ".")) || 0;
}

function parseViz(text: string): EllyRow[] | null {
  const m = text.match(/<!--\s*plurio_viz:\s*(\{[\s\S]*?\})\s*-->/);
  if (!m) return null;
  try {
    const viz = JSON.parse(m[1]);
    if (viz.type !== "Table" || !Array.isArray(viz.data)) return null;
    // Заголовки Plurio варьируются: "Revenue" vs "Revenue (€)", "Adv Spend (€)" и т.п.
    // Ищем по НОРМАЛИЗОВАННОМУ ключу (lower + только буквы/цифры), иначе суффикс
    // "(€)" ломал чтение (revenue молча падал в 0 — баг Google CRM-синка).
    const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
    return viz.data.map((r: Record<string, unknown>) => {
      const map: Record<string, unknown> = {};
      for (const k of Object.keys(r)) map[norm(k)] = r[k];
      const get = (...keys: string[]) => {
        for (const k of keys) { const v = map[norm(k)]; if (v !== undefined) return v; }
        return undefined;
      };
      return {
        date:      parseDate(get("Date")),
        adId:      String(get("AdId", "id") ?? ""),
        adName:    String(get("AdName", "name") ?? ""),
        leads:     parseNum(get("Leads")),
        qualLeads: parseNum(get("QL", "qualLeads", "qual_leads")),
        spend:     parseNum(get("Adv Spend", "spend")),
        revenue:   parseNum(get("Revenue")),
      };
    }).filter((r: EllyRow) => r.adName);
  } catch { return null; }
}

function parseMarkdownTable(text: string): EllyRow[] | null {
  const normalize = (h: string) => h.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
  const parseRow  = (line: string) =>
    line.split("|").map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);

  const lines = text.split("\n").map(l => l.trim()).filter(l => l.startsWith("|"));
  if (lines.length < 2) return null;

  const headers = parseRow(lines[0]).map(normalize);
  if (headers.length < 2) return null;

  const dataLines = lines.slice(1).filter(l => !/^\|[\s:-]+\|/.test(l));
  if (dataLines.length === 0) return null;

  const idx = {
    date:      headers.findIndex(h => h === "date" || h === "дата"),
    adId:      headers.findIndex(h => h === "adid" || h === "id"),
    adName:    headers.findIndex(h => h === "adname" || h === "name" || h === "название"),
    leads:     headers.findIndex(h => h === "leads" || h === "лиды"),
    qualLeads: headers.findIndex(h => h === "ql" || h.includes("qual") || h === "квал"),
    spend:     headers.findIndex(h => h === "advspend" || h === "spend" || h === "бюджет"),
    revenue:   headers.findIndex(h => h === "revenue" || h === "выручка"),
  };

  if (idx.adName === -1 && idx.adId === -1) return null;

  const rows: EllyRow[] = [];
  for (const line of dataLines) {
    const cols = parseRow(line);
    const adName = idx.adName >= 0 ? (cols[idx.adName] ?? "") : "";
    const adId   = idx.adId   >= 0 ? (cols[idx.adId]   ?? "") : "";
    if (!adName && !adId) continue;
    rows.push({
      date:      idx.date      >= 0 ? parseDate(cols[idx.date])    : "",
      adId,
      adName:    adName || adId,
      leads:     idx.leads     >= 0 ? parseNum(cols[idx.leads])     : 0,
      qualLeads: idx.qualLeads >= 0 ? parseNum(cols[idx.qualLeads]) : 0,
      spend:     idx.spend     >= 0 ? parseNum(cols[idx.spend])     : 0,
      revenue:   idx.revenue   >= 0 ? parseNum(cols[idx.revenue])   : 0,
    });
  }
  return rows.length > 0 ? rows : null;
}

function parseResponse(text: string): EllyRow[] | null {
  return parseViz(text) ?? parseMarkdownTable(text);
}

// ── TSV file fallback ─────────────────────────────────────────────────────────
// Когда выгрузка большая (>~150 строк), Plurio отдаёт presigned S3 URL на TSV
// вместо inline markdown. Распознаём URL и парсим файл по табам.

function extractTsvUrl(text: string): string | null {
  // sql-query-result-{id}.tsv с возможными дефисами/подчёркиваниями в id.
  // URL может быть URL-encoded (sometimes %3D вместо =), но https://... всегда прямой.
  const m = text.match(/https?:\/\/[^\s)"']*sql-query-result-[A-Za-z0-9_-]+\.tsv[^\s)"']*/);
  return m?.[0] ?? null;
}

function hasTsvMention(text: string): boolean {
  return /sql-query-result-[A-Za-z0-9_-]+\.tsv/.test(text);
}

// Если Plurio упомянул tsv-файл, но URL вне видимой части ответа —
// просим в том же чате выдать ПОЛНУЮ presigned URL.
async function askForTsvUrl(chatId: string): Promise<string | null> {
  const { sse, sessionUrl } = await mcpConnect();
  try {
    await rpc(sessionUrl, 2, "tools/call", {
      name: "ask_plurio",
      arguments: {
        project_id: PROJECT_ID,
        chat_id: chatId,
        question: "Покажи полный presigned URL на TSV-файл из предыдущего ответа. " +
                  "Формат: https://...sql-query-result-*.tsv?... — целиком, в одну строку, без обрезки.",
      },
    });
    const text = await collectToolResult(sse, 90_000);
    return extractTsvUrl(text);
  } finally {
    sse.close();
  }
}

function parseTsvText(text: string): EllyRow[] {
  const norm = (h: string) => h.toLowerCase().replace(/[^a-zа-я0-9]/gi, "");
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].split("\t").map(norm);
  const idx = {
    date:      headers.findIndex(h => h === "date" || h === "дата"),
    adId:      headers.findIndex(h => h === "adid" || h === "id"),
    adName:    headers.findIndex(h => h === "adname" || h === "name" || h === "название"),
    leads:     headers.findIndex(h => h === "leads" || h === "лиды"),
    qualLeads: headers.findIndex(h => h === "ql" || h.includes("qual") || h === "квал"),
    spend:     headers.findIndex(h => h === "advspend" || h === "spend" || h === "бюджет"),
    revenue:   headers.findIndex(h => h === "revenue" || h === "выручка"),
  };

  if (idx.adName === -1 && idx.adId === -1) return [];

  const rows: EllyRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const adName = idx.adName >= 0 ? (cols[idx.adName] ?? "").trim() : "";
    const adId   = idx.adId   >= 0 ? (cols[idx.adId]   ?? "").trim() : "";
    if (!adName && !adId) continue;
    rows.push({
      date:      idx.date      >= 0 ? parseDate(cols[idx.date])    : "",
      adId,
      adName:    adName || adId,
      leads:     idx.leads     >= 0 ? parseNum(cols[idx.leads])     : 0,
      qualLeads: idx.qualLeads >= 0 ? parseNum(cols[idx.qualLeads]) : 0,
      spend:     idx.spend     >= 0 ? parseNum(cols[idx.spend])     : 0,
      revenue:   idx.revenue   >= 0 ? parseNum(cols[idx.revenue])   : 0,
    });
  }
  return rows;
}

async function fetchTsv(url: string): Promise<EllyRow[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TSV fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseTsvText(text);
  if (rows.length === 0) {
    throw new Error(`TSV downloaded but parser got 0 rows (size=${text.length})`);
  }
  return rows;
}

function extractChatId(text: string): string | null {
  const m = text.match(/\*\*Chat ID:\*\*\s+`([^`]+)`/);
  return m?.[1] ?? null;
}

// ── Poll get_chat_messages until result arrives ───────────────────────────────

async function pollChatMessages(chatId: string, pollDeadline: number): Promise<EllyRow[]> {
  while (Date.now() < pollDeadline) {
    await new Promise(r => setTimeout(r, 30_000));

    const { sse, sessionUrl } = await mcpConnect();
    await rpc(sessionUrl, 2, "tools/call", {
      name: "get_chat_messages",
      arguments: { project_id: PROJECT_ID, chat_id: chatId, role: "assistant", limit: 1 },
    });

    const text = await collectToolResult(sse, 30_000);
    sse.close();

    if (!text || text.includes("No messages found")) continue;

    // Большая выгрузка → ссылка на TSV
    const tsvUrl = extractTsvUrl(text);
    if (tsvUrl) return await fetchTsv(tsvUrl);

    // TSV упомянут, но URL не виден — попросим явно
    if (hasTsvMention(text)) {
      const url = await askForTsvUrl(chatId);
      if (url) return await fetchTsv(url);
    }

    const rows = parseResponse(text);
    if (rows && rows.length > 0) return rows;
  }

  throw new Error("Timeout polling Plurio result");
}

// ── Main sync ─────────────────────────────────────────────────────────────────

async function syncElly(dateFrom: string, dateTo: string, source: "meta" | "google" = "meta"): Promise<EllyRow[]> {
  if (!PLURIO_KEY) throw new Error("PLURIO_API_KEY не задан");

  const { sse, sessionUrl } = await mcpConnect();

  // LIFETIME-агрегат (НЕ дневная разбивка). Plurio даёт корректный итог; дневная
  // разбивка для quiz-адов раздувала лиды ~7x. Для Meta — на уровне AdId; для
  // Google (PMax) AdId=NULL, поэтому агрегат на уровне КАМПАНИИ (CampaignName
  // совпадает с ad_name в meta_ads, по нему вид и джойнит).
  const tail =
    `Включи ВСЕ строки, у которых Leads > 0 (без top-N ограничения, без обрезки). ` +
    `Верни ОДНУ markdown-таблицу со всеми строками. Если строк слишком много для inline — отдай TSV-файл, ` +
    `но обязательно укажи ПОЛНУЮ presigned URL в формате https://...sql-query-result-*.tsv?... в тексте ответа. ` +
    `Без преамбулы.`;
  const question = source === "google"
    ? `Дай СУММАРНЫЕ (агрегат за весь период ${dateFrom} — ${dateTo}, БЕЗ разбивки по дням) показатели ` +
      `по КАМПАНИЯМ из Google Ads, разбивка по CampaignName (group by CampaignName). ОДНА строка на КАЖДУЮ кампанию. ` +
      `Колонки строго: AdId (= CampaignId), AdName (= CampaignName), сумма Leads, сумма QL, сумма Adv Spend, сумма Revenue. ` +
      `ОБЯЗАТЕЛЬНО включи столбец Revenue — это когортная выручка (следует за лидом), она РАЗБИВАЕТСЯ по кампаниям; ` +
      `не возвращай Revenue=0, если у кампании есть оплаты. Включи ВСЕ кампании, где Leads > 0 ИЛИ Revenue > 0. ` +
      `Фильтр: AttributionType = 'Leads Last Ad Click', SourceGroupName = 'Google Ads'. ` + tail
    : `Дай СУММАРНЫЕ (агрегат за весь период ${dateFrom} — ${dateTo}, БЕЗ разбивки по дням) показатели ` +
      `по объявлениям (ad level) из Facebook and Instagram. ОДНА строка на КАЖДЫЙ AdId — суммы за весь период, не по дням. ` +
      `Колонки строго: AdId, AdName, сумма Leads, сумма QL, сумма Adv Spend, сумма Revenue. ` +
      `Фильтр: AttributionType = 'Leads Last Ad Click', SourceGroupName = 'Facebook and Instagram'. ` + tail;

  await rpc(sessionUrl, 2, "tools/call", {
    name: "ask_plurio",
    arguments: { project_id: PROJECT_ID, question },
  });

  // Hobby plan cap = 300s, оставляем headroom.
  // Phase 1 (SSE): 120s. Phase 2 (poll): +120s. Всего ~245s, +setup ~250-260s.
  const text = await collectToolResult(sse, 120_000);
  sse.close();

  // Check if Plurio is still processing (SSE timeout → "still running" message)
  if (text.includes("still running") || text.includes("Chat ID:")) {
    const chatId = extractChatId(text);
    if (!chatId) throw new Error(`Still running but no chat_id found. Tail: ${text.slice(-300)}`);
    return pollChatMessages(chatId, Date.now() + 120_000);
  }

  // Большая выгрузка → ссылка на TSV (Plurio так делает когда строк >~150)
  const tsvUrl = extractTsvUrl(text);
  if (tsvUrl) return await fetchTsv(tsvUrl);

  // Plurio упомянул TSV-файл, но URL в видимой части ответа нет —
  // делаем follow-up в тот же chat и просим полный URL.
  if (hasTsvMention(text)) {
    const chatId = extractChatId(text);
    if (chatId) {
      const url = await askForTsvUrl(chatId);
      if (url) return await fetchTsv(url);
    }
  }

  const rows = parseResponse(text);
  if (!rows || rows.length === 0) {
    throw new Error(`PARSE_FAIL:hasViz=${text.includes("plurio_viz")},hasPipe=${text.includes("|")},hasTsv=${/sql-query-result/.test(text)},len=${text.length},tail=${text.slice(-400)}`);
  }
  return rows;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Опциональная интеграция: если PLURIO_API_KEY не задан, эндпоинт возвращает
  // 503, чтобы UI/cron мог это спокойно перехватить.
  if (!process.env.PLURIO_API_KEY) {
    return NextResponse.json(
      { error: "Plurio/Elly integration not configured (PLURIO_API_KEY missing). Это опциональная интеграция." },
      { status: 503 }
    );
  }

  // LIFETIME-режим: по умолчанию тянем агрегат за ВСЁ время (с запасом от 2024-01-01),
  // одна строка на ad_id. dateTo = сегодня. Можно переопределить телом запроса.
  const body = await req.json().catch(() => ({})) as { dateFrom?: string; dateTo?: string; source?: "meta" | "google" };
  const source = body.source === "google" ? "google" : "meta";
  const prefix = source === "google" ? "google:" : "elly:";
  const today = new Date();
  const dateTo   = body.dateTo   ?? today.toISOString().slice(0, 10);
  const dateFrom = body.dateFrom ?? "2024-01-01";

  let rows: EllyRow[];
  try {
    rows = await syncElly(dateFrom, dateTo, source);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const supabase = createServiceClient();

  // Полная замена: lifetime-агрегат — это снимок «итог на момент синка», одна строка
  // на ключ. Чистим строки своего неймспейса (elly:% для Meta, google:% для Google —
  // не пересекаются) и пишем свежий снимок (дата = dateTo), чтобы во view был ровно
  // один ряд на ключ и sum(leads) по имени = корректный lifetime.
  await supabase
    .from("pbi_metrics")
    .delete()
    .like("ad_id", `${prefix}%`);

  const payload = rows.map(r => ({
    ad_id:      `${prefix}${r.adId || r.adName.trim()}`,
    ad_name:    r.adName.trim(),
    date:       dateTo,
    leads:      Math.round(r.leads),
    qual_leads: Math.round(r.qualLeads),
    spend:      r.spend,
    revenue:    r.revenue,
  }));

  const { error } = await supabase
    .from("pbi_metrics")
    .upsert(payload, { onConflict: "ad_id,date" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("pbi_sync_log").insert({ rows_count: payload.length });

  // Run alert check after fresh Plurio data is saved
  runAlertCheck().catch(() => {});

  return NextResponse.json({ ok: true, synced: payload.length, dateFrom, dateTo });
}

// Cron ходит GET'ом — прокидываем канал через ?source=google (по умолчанию meta).
export async function GET(req: NextRequest) {
  const source = new URL(req.url).searchParams.get("source") === "google" ? "google" : "meta";
  return POST(new NextRequest("http://localhost/api/pbi/elly-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  }));
}
