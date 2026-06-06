export type Format = "ugc" | "static" | "animation" | "human" | "mixed";
export type WinnerStatus = "winner" | "fake_winner" | "loser" | "unknown" | "testing";
export type RiskSignal = "low_qual_cr" | "short_lifespan" | "low_roas_30d";
export type Source = "internal" | "competitor";
export type AdFlow = "com" | "gov";
export type BriefStatus = "pending" | "approved" | "needs_revision";
export type AlertType =
  | "cpl_spike"
  | "ctr_drop"
  | "pack_dying"
  | "winner_found"
  | "loser_detected"
  | "early_stop"
  | "dead_zero_leads"
  | "fake_winner_detected";
export type ConceptStatus = "pending" | "approved" | "rejected";

export interface Persona {
  id: string;
  code?: string;          // P1, P2, P3 ...
  flow?: AdFlow;
  name: string;
  short: string;
  description: string;
  pointA: string;
  pointB: string;
  pains: string[];
  triggers: string[];
  age?: string;
  gender?: string;
  color: string;
  createdAt: string;
}

export interface Hook {
  id: string;
  code?: string;          // H1, H2, H3 ...
  flow?: AdFlow;
  name: string;
  template: string;
  description: string;
  examples: string[];
  color: string;
  createdAt: string;
}

export interface Body {
  id: string;
  code?: string;          // B1, B2, B3 ...
  flow?: AdFlow;
  name: string;
  template: string;
  description: string;
  examples: string[];
  color: string;
  createdAt: string;
}

export interface Angle {
  id: string;
  code?: string;          // A1, A2, A3 ...
  flow?: AdFlow;
  name: string;
  template: string;
  description: string;
  examples: string[];
  color: string;
  createdAt: string;
}

export interface Creative {
  id: string;
  source: Source;
  flow?: AdFlow;
  personaId: string;
  hookId: string;
  bodyId: string;
  angleId: string;
  format: Format;
  status: WinnerStatus;
  metaAdId?: string;
  metaAdName?: string;
  description?: string;
  notes?: string;
  competitorName?: string;
  rawText?: string;
  createdAt: string;
}

export interface Scenario {
  id: string;
  paramType: "persona" | "hook" | "body" | "angle";
  paramId: string;
  content: string;
  tz: string;
  createdAt: string;
}

export interface Brief {
  id: string;
  sessionId: string;
  personaId: string;
  hookId: string;
  bodyId: string;
  angleId: string;
  format: Format;
  adaptedHook: string;
  adaptedBody: string;
  adaptedAngle: string;
  fullBrief: string;
  status: BriefStatus;
  revisionNote?: string;
  batchIndex?: number;
  createdAt: string;
}

export interface ConstructorSession {
  id: string;
  name: string;
  flow?: AdFlow;
  selectedPersonas: string[];
  selectedHooks: string[];
  selectedBodies: string[];
  selectedAngles: string[];
  format: Format;
  totalCombinations: number;
  status: "draft" | "scenarios" | "generating" | "done";
  createdAt: string;
  packMetadata?: PackMetadata;
  packSize?: number;
  generatedAt?: string;
}

// ── Pack Generator (auto-builder) ────────────────────────────────────────────

export type PackSlotCategory = "winner_family" | "winner_mix" | "discovery" | "competitor";

export interface PackSlot {
  slotId: number;
  category: PackSlotCategory;
  codes: {
    persona: string | null;  // P-code
    hook:    string | null;  // H-code
    body:    string | null;  // B-code
    angle:   string | null;  // A-code
  };
  rationale: string;             // короткое объяснение «почему эта комбинация»
  // category-specific поля:
  basedOnAd?: string;            // winner_family: имя оригинального винера
  variedParam?: "persona" | "hook" | "body" | "angle";  // winner_family
  fromWinners?: string[];        // winner_mix: список ad_name винеров-доноров
  helpsCodes?: string[];         // discovery: HELPS-коды по бивариату
  sourceConceptId?: string;      // competitor: uuid из competitor_concepts
  newCodesCreated?: string[];    // competitor: какие коды AI создал в /library
}

export interface PackMetadata {
  slots: PackSlot[];
  distribution: Record<PackSlotCategory, number>;
  cold_start: boolean;
  format: Format;
  flow: AdFlow;
  data_snapshot: {
    winners: number;
    fake_winners: number;
    losers: number;
    approved_competitors: number;
  };
}

export interface Rule {
  id: string;
  title: string;
  content: string;
  category: "adaptation" | "hook" | "body" | "angle" | "persona" | "general";
  active: boolean;
  createdAt: string;
}

// ── Meta API ──────────────────────────────────────────────────────────────────

export interface MetaAd {
  id: string;
  adId: string;
  adName: string;
  adsetId?: string;
  adsetName?: string;
  campaignId?: string;
  campaignName?: string;
  flow?: AdFlow;
  accountId?: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  frequency: number;
  cpm: number;
  ctr: number;
  cpc: number;
  createdAt: string;
}

// ── PBI ───────────────────────────────────────────────────────────────────────

export interface PbiMetric {
  id: string;
  adId: string;
  adName?: string;
  date: string;
  leads: number;
  qualLeads: number;
  revenue: number;
  transactions: number;
  createdAt: string;
}

// ── Creative Performance (view) ───────────────────────────────────────────────

export interface CreativePerformance {
  adId: string;
  adName: string;
  flow?: AdFlow;
  campaignId?: string;
  campaignName?: string;
  adsetId?: string;
  adsetName?: string;
  // Meta метрики
  spend: number;
  impressions: number;
  clicks: number;
  frequency: number;
  cpm: number;
  ctr: number;
  cpc: number;
  // PBI метрики
  leads: number;
  qualLeads: number;
  revenue: number;
  transactions: number;
  // Расчётные
  cpl: number | null;
  cpql: number | null;
  crLeadToQual: number | null;
  crQualToTxn: number | null;
  crClickToLead: number | null;
  roas: number | null;
  // Авто-статус
  autoStatus: WinnerStatus;
  riskSignals: RiskSignal[];
  // Плановые
  targetCpl: number;
  targetCpql: number;
  // Даты и жизненный цикл
  firstSeen: string;
  lastSeen: string;
  lifespanDays: number;
  ageDays: number;
  isActive: boolean;
}

// ── Alerts ────────────────────────────────────────────────────────────────────

export interface CreativeAlert {
  id: string;
  adId?: string;
  adName?: string;
  flow?: AdFlow;
  alertType: AlertType;
  message: string;
  value?: number;
  threshold?: number;
  dismissed: boolean;
  createdAt: string;
}

// ── Competitor Concepts ───────────────────────────────────────────────────────

export interface CompetitorConcept {
  id: string;
  source: string;
  conceptType?: string;
  title: string;
  description?: string;
  rawData?: Record<string, unknown>;
  status: ConceptStatus;
  approvedBy?: string;
  approvedAt?: string;
  createdParamId?: string;
  createdParamType?: string;
  createdAt: string;
}

// ── Analysis Report (единый отчёт по массиву, /report) ─────────────────────────

export interface ReportKpi {
  packHealth: "healthy" | "warning" | "dying" | "unknown";
  winners: number;
  fakeWinners: number;
  losers: number;
  testing: number;
  blendedCpl: number | null;
  blendedCpql: number | null;
  totalSpend: number;
  activeAds: number;
}

export interface ReportSignal {        // HELPS / HURTS параметр
  code: string;
  paramType: string;
  label: string;
  ratio: number | null;
}

export interface ReportFamily {        // семья: 3 кода фикс, 1 варьируется
  varyingParam: string;
  shared: string;                      // напр. "P1 H2 B3"
  bestCpl: number | null;
  worstCpl: number | null;
  spread: number | null;
}

export interface ReportCombo {
  codes: string;                       // напр. "P1 + H2"
  winners: number;
  cpl: number | null;
  spend: number;
}

export interface ReportCompetitor {
  title: string;
  type?: string;
  hook?: string;
}

export interface ReportVisual {
  helps: ReportSignal[];
  hurts: ReportSignal[];
  families: ReportFamily[];
  combos: ReportCombo[];
  competitors: ReportCompetitor[];
}

export interface AnalysisReport {
  id: string;
  createdAt: string;
  flow: string;                        // com | gov | all
  kpi: ReportKpi;
  visual: ReportVisual;
  narrative: string;
}
