import { supabase } from "./supabase";

// ── Префиксы параметров ───────────────────────────────────────────────────────
export const CODE_PREFIX = {
  personas: "P",
  hooks:    "H",
  bodies:   "B",
  angles:   "A",
} as const;

export type ParamTable = keyof typeof CODE_PREFIX;

// ── Формат имени объявления ───────────────────────────────────────────────────
// P2-H1-B3-A5-UGC-COM
// P2-H1-B3-A5-UGC-GOV

export interface AdNameParts {
  personaCode:  string | null;  // P2
  hookCode:     string | null;  // H1
  bodyCode:     string | null;  // B3
  angleCode:    string | null;  // A5
  format:       string | null;  // UGC
  flow:         string | null;  // COM / GOV
}

export interface AdNameMapping {
  adName:      string;
  personaCode: string | null;
  hookCode:    string | null;
  bodyCode:    string | null;
  angleCode:   string | null;
  format:      string | null;
  flow:        string | null;
}

/**
 * Сначала пробует стандартный parseAdName, при отсутствии кодов — ищет в маппинге.
 */
export function parseAdNameWithMapping(
  adName: string,
  mapping: AdNameMapping[]
): AdNameParts {
  const parts = parseAdName(adName);
  if (parts.personaCode || parts.hookCode || parts.bodyCode || parts.angleCode) return parts;

  const key = adName.trim().toLowerCase();
  const mapped = mapping.find(m => m.adName.trim().toLowerCase() === key);
  if (!mapped) return parts;

  return {
    personaCode: mapped.personaCode,
    hookCode:    mapped.hookCode,
    bodyCode:    mapped.bodyCode,
    angleCode:   mapped.angleCode,
    format:      mapped.format ?? parts.format,
    flow:        mapped.flow ?? parts.flow,
  };
}

const FORMAT_VALUES = ["UGC", "STATIC", "ANIMATION", "HUMAN", "MIXED"];

/**
 * Разбирает имя объявления и извлекает коды параметров.
 * Поддерживает формат: P2-H1-B3-A5-UGC-COM
 */
export function parseAdName(adName: string): AdNameParts {
  const parts = adName.toUpperCase().split(/[-_\s]+/);

  let personaCode: string | null = null;
  let hookCode:    string | null = null;
  let bodyCode:    string | null = null;
  let angleCode:   string | null = null;
  let format:      string | null = null;
  let flow:        string | null = null;

  for (const part of parts) {
    if (/^P\d+$/i.test(part))    personaCode = part.toUpperCase();
    else if (/^H\d+$/i.test(part)) hookCode  = part.toUpperCase();
    else if (/^B\d+$/i.test(part)) bodyCode  = part.toUpperCase();
    else if (/^A\d+$/i.test(part)) angleCode = part.toUpperCase();
    else if (FORMAT_VALUES.includes(part)) format = part;
    else if (part === "COM" || part === "GOV") flow = part.toLowerCase();
  }

  return { personaCode, hookCode, bodyCode, angleCode, format, flow };
}

/**
 * Строит имя объявления из кодов параметров.
 * P2-H1-B3-A5-UGC-COM
 */
export function buildAdName(
  personaCode: string,
  hookCode: string,
  bodyCode: string,
  angleCode: string,
  format: string,
  flow: string
): string {
  return [
    personaCode.toUpperCase(),
    hookCode.toUpperCase(),
    bodyCode.toUpperCase(),
    angleCode.toUpperCase(),
    format.toUpperCase(),
    flow.toUpperCase(),
  ].join("-");
}

/**
 * Получает следующий свободный код для таблицы параметров.
 * Например: если есть P1, P2, P4 → вернёт P3 (первый пропуск) или P5 (следующий)
 */
export async function getNextCode(table: ParamTable): Promise<string> {
  const prefix = CODE_PREFIX[table];
  const { data } = await supabase
    .from(table)
    .select("code")
    .not("code", "is", null)
    .order("code");

  const existing = (data ?? [])
    .map(r => r.code as string)
    .filter(Boolean)
    .map(c => parseInt(c.replace(prefix, ""), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  // Найти первый пропуск или взять следующий после максимального
  let next = 1;
  for (const n of existing) {
    if (n === next) next++;
    else break;
  }

  return `${prefix}${next}`;
}

/**
 * Автоматически назначает коды всем параметрам без кода.
 * Вызывать один раз при миграции существующих данных.
 */
export async function assignMissingCodes(): Promise<Record<ParamTable, number>> {
  const counts: Record<ParamTable, number> = { personas: 0, hooks: 0, bodies: 0, angles: 0 };

  for (const table of Object.keys(CODE_PREFIX) as ParamTable[]) {
    const prefix = CODE_PREFIX[table];

    // Берём все без кода
    const { data } = await supabase
      .from(table)
      .select("id, code")
      .is("code", null)
      .order("created_at");

    if (!data || data.length === 0) continue;

    // Берём максимальный существующий номер
    const { data: existing } = await supabase
      .from(table)
      .select("code")
      .not("code", "is", null);

    const maxNum = (existing ?? [])
      .map(r => parseInt((r.code as string).replace(prefix, ""), 10))
      .filter(n => !isNaN(n))
      .reduce((max, n) => Math.max(max, n), 0);

    let counter = maxNum;
    for (const row of data) {
      counter++;
      const code = `${prefix}${counter}`;
      await supabase.from(table).update({ code }).eq("id", row.id);
      counts[table]++;
    }
  }

  return counts;
}

/**
 * Разбирает имя объявления и возвращает UUID параметров (через коды).
 */
export async function resolveAdName(adName: string): Promise<{
  personaId: string | null;
  hookId:    string | null;
  bodyId:    string | null;
  angleId:   string | null;
  format:    string | null;
  flow:      string | null;
}> {
  const parts = parseAdName(adName);

  const [personas, hooks, bodies, angles] = await Promise.all([
    parts.personaCode
      ? supabase.from("personas").select("id").eq("code", parts.personaCode).single()
      : Promise.resolve({ data: null }),
    parts.hookCode
      ? supabase.from("hooks").select("id").eq("code", parts.hookCode).single()
      : Promise.resolve({ data: null }),
    parts.bodyCode
      ? supabase.from("bodies").select("id").eq("code", parts.bodyCode).single()
      : Promise.resolve({ data: null }),
    parts.angleCode
      ? supabase.from("angles").select("id").eq("code", parts.angleCode).single()
      : Promise.resolve({ data: null }),
  ]);

  return {
    personaId: (personas.data as { id: string } | null)?.id ?? null,
    hookId:    (hooks.data as { id: string } | null)?.id ?? null,
    bodyId:    (bodies.data as { id: string } | null)?.id ?? null,
    angleId:   (angles.data as { id: string } | null)?.id ?? null,
    format:    parts.format?.toLowerCase() ?? null,
    flow:      parts.flow ?? null,
  };
}
