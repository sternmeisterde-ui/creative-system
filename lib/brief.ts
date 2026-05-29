/**
 * Доступ к бизнес-контексту из brief.config.ts.
 *
 * Все обращения к brief идут через этот модуль — не импортируй brief.config.ts
 * напрямую из роутов/компонентов, чтобы в будущем мы могли подменить источник
 * (TS-файл → база/API) одним местом.
 */

import { brief, type BriefConfig } from "@/brief.config";

export type { BriefConfig };
export { brief };

export function getBusiness() {
  return brief.business;
}

export function getAiContext(): string {
  return brief.ai_context;
}

export function getFlows() {
  return brief.flows;
}

export function getFlow(code: string) {
  return brief.flows.find(f => f.code === code.toLowerCase());
}

export function getMetaAccountIdForFlow(code: string): string | undefined {
  const flow = getFlow(code);
  if (!flow) return undefined;
  return process.env[flow.meta_account_env];
}

/** Меta аккаунты в виде { flow_code: ad_account_id } — для meta sync. */
export function getMetaAccountsMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of brief.flows) {
    const id = process.env[f.meta_account_env];
    if (id) map[f.code] = id;
  }
  return map;
}

export function getCreativeMatrix() {
  return brief.creative_matrix;
}

export function getParamByKey(key: string) {
  return brief.creative_matrix.params.find(p => p.key === key);
}

export function getParamByLetter(letter: string) {
  return brief.creative_matrix.params.find(p => p.letter === letter.toUpperCase());
}

export function getBrandVoice() {
  return brief.brand_voice;
}

/**
 * Краткая текстовая выжимка для AI: цели KPI + стиль + контекст.
 * cpl/cpql/min_imp принимаются параметрами — они в БД (app_settings), не в brief.
 */
export function getAiSystemPreamble(targets: { cpl: number; cpql: number; minImpressions: number }): string {
  const v = brief.brand_voice;
  const lines = [
    `Ты — аналитик Meta Ads для ${brief.business.name}.`,
    brief.ai_context,
    `Цели: CPL ≤ €${targets.cpl}, CPQL ≤ €${targets.cpql}, порог значимости ${targets.minImpressions} показов.`,
    `Голос бренда: ${v.tone}.`,
  ];
  if (v.style_notes) lines.push(`Стиль: ${v.style_notes}`);
  if (v.forbidden_words?.length) lines.push(`Запрещённые слова: ${v.forbidden_words.join(", ")}.`);
  return lines.join("\n\n");
}
