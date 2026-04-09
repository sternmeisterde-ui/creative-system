import { NextRequest, NextResponse } from "next/server";

function extractSheetId(url: string): { id: string; gid?: string } | null {
  // https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=GID
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const gidMatch = url.match(/[#&?]gid=(\d+)/);
  return { id: match[1], gid: gidMatch?.[1] };
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse CSV properly handling quoted fields
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const vals = parseRow(line);
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
    });

  return { headers, rows };
}

// POST: fetch Google Sheets CSV and return headers + first 5 rows for preview
export async function POST(req: NextRequest) {
  const { url } = await req.json() as { url?: string };

  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const parsed = extractSheetId(url);
  if (!parsed) {
    return NextResponse.json({ error: "Не удалось распарсить ссылку на Google Sheets" }, { status: 400 });
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv${parsed.gid ? `&gid=${parsed.gid}` : ""}`;

  let csvText: string;
  try {
    const res = await fetch(csvUrl, { headers: { "Accept": "text/csv" } });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Не удалось загрузить таблицу (${res.status}). Убедись, что доступ открыт для всех.` },
        { status: 400 }
      );
    }
    csvText = await res.text();
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  const { headers, rows } = parseCsv(csvText);

  return NextResponse.json({
    ok: true,
    headers,
    preview: rows.slice(0, 5),
    total: rows.length,
    rows, // all rows for import
  });
}
