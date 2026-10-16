import type { ToolContext } from "@cursor/bdk/tools";
import {
  buildLedgerDocument,
  chooseLedger,
  LEDGER_DEPLOYMENT_PATH,
  LEDGER_REPO_RELATIVE,
  LEDGER_VERSION,
  ledgerWarning,
  LIVE_PREFIX,
  readDeploymentLedger,
  readRepoLedger,
  renderLedgerDocument,
  writeDeploymentLedger,
  writeRepoLedger,
  type DeploymentFiles,
  type LedgerDocument,
  type LedgerRead,
  type LedgerSource,
} from "./ledger-file.js";
import {
  applyNetworkUpdate,
  buildNetworkView,
  emptyEcosystemStore,
  isEcosystemStore,
  type RelationshipDraft,
} from "./network.js";

/**
 * Learning ledger for the FTSE growth explorer.
 *
 * Evidence comes from the public value_investor screen
 * (docs/data/latest.json). Judgement lives in kv for the running
 * session. A successful live record also writes ledger/ledger.json
 * and the deployment file ledger.json, and a fresh live session
 * loads that file back before choosing the next name.
 */

const UNIVERSE_URL =
  "https://raw.githubusercontent.com/jamiefuller320/value_investor/main/docs/data/latest.json";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const LESSONS_PER_PACKET = 12;
const HISTORY_CAP = 8;
const RECENT_CAP = 12;
const DEDUPE_MS = 2 * 60 * 1000;

export const TRAITS = [
  "low_pe",
  "high_pe",
  "high_yield",
  "low_yield",
  "high_roe",
  "low_roe",
  "high_leverage",
  "low_leverage",
  "fcf_positive",
  "fcf_negative",
  "fcf_cover_below_1",
  "fcf_cover_comfortable",
  "earnings_growing",
  "earnings_shrinking",
  "below_sma200",
  "above_sma200",
  "high_data_quality",
  "thin_data",
  "piotroski_strong",
  "piotroski_weak",
  "cyclical",
  "operating_company",
  "investment_vehicle",
  "family_cheapness",
  "family_quality",
  "family_garp",
  "family_risk",
  "family_dividend",
] as const;

export const SIGNALS = [
  "strong_buy",
  "buy",
  "hold",
  "avoid",
  "insufficient_data",
] as const;

export const VEHICLES = ["operating", "investment_vehicle"] as const;

export const STANCES = ["research_buy", "watch", "pass", "avoid"] as const;

export const LESSON_EFFECTS = [
  "upgrade_growth",
  "downgrade_growth",
  "raise_risk",
  "lower_conviction",
  "recheck_valuation",
  "method",
] as const;

export const LESSON_SCOPES = ["matching", "all_names", "this_name_only"] as const;

export const CONFIDENCE = ["tentative", "supported", "repeated"] as const;

type Trait = (typeof TRAITS)[number];
type Signal = (typeof SIGNALS)[number];
type Vehicle = (typeof VEHICLES)[number];
type Stance = (typeof STANCES)[number];
type LessonEffect = (typeof LESSON_EFFECTS)[number];
type LessonScope = (typeof LESSON_SCOPES)[number];
export type Confidence = (typeof CONFIDENCE)[number];

export type CompanyCard = {
  ticker: string;
  name: string;
  sector: string;
  vehicle: Vehicle;
  signal: string;
  compositeScore: number | null;
  dataQualityScore: number | null;
  timingSignal: string | null;
  rsi14: number | null;
  priceVsSma200Percent: number | null;
  weeksAtSignal: number | null;
  stabilityLabel: string | null;
  piotroski: number | null;
  modelsPassed: number | null;
  modelCount: number | null;
  passedFamilies: string[];
  failedModels: string[];
  keyMetrics: Record<string, string>;
  debtToEquityPercent: number | null;
  currentRatio: number | null;
  earningsGrowthPercent: number | null;
  dividendYieldPercent: number | null;
  lynchPeg: number | null;
  operatingCashflow: number | null;
  freeCashflow: number | null;
  freeCashflowPrev: number | null;
  fcfDividendCoverageNet: number | null;
  researchVerdict: string | null;
  researchRationale: string | null;
  summary: string;
  traits: string[];
  flags: string[];
};

export type UniverseSnapshot = {
  source: "live" | "fixture";
  sourceUrl: string;
  generatedAt: string | null;
  fetchedAt: string;
  stale: boolean;
  universeLabel: string;
  companies: CompanyCard[];
};

export type Assessment = {
  ticker: string;
  name: string;
  sector: string;
  vehicle: Vehicle;
  signal: string;
  traits: string[];
  revision: number;
  recordedAt: string;
  stance: Stance;
  conviction: number;
  growthThesis: string;
  growthDrivers: string[];
  growthConstraints: string[];
  horizonYears: number;
  revenueGrowthView: "accelerating" | "steady" | "decelerating" | "unclear";
  earningsQuality: "high" | "mixed" | "low" | "unclear";
  reinvestment: "high" | "moderate" | "low" | "unclear";
  valuationNote: string;
  expectedReturnBand: string;
  keyRisks: string[];
  whatWouldChangeMyMind: string[];
  openQuestions: string[];
  evidenceUsed: string[];
  lessonsApplied: string[];
  freeNotes: string;
  ecosystem: string | null;
};

type AssessmentFile = {
  current: Assessment;
  history: Assessment[];
};

export type Lesson = {
  id: string;
  createdAt: string;
  updatedAt: string;
  sourceTicker: string;
  title: string;
  statement: string;
  scope: LessonScope;
  effect: LessonEffect;
  evidence: string;
  confidence: Confidence;
  traitMatch: "any" | "all";
  appliesWhen: {
    sectors: string[];
    vehicles: Vehicle[];
    signals: string[];
    traits: string[];
  };
  applications: Array<{
    ticker: string;
    at: string;
    revision: number;
    changedStance: boolean;
  }>;
};

type Revisit = {
  ticker: string;
  lessonId: string;
  relationshipId?: string;
  reason: string;
  queuedAt: string;
};

type LedgerMeta = {
  assessedTickers: string[];
  stanceCounts: Record<string, number>;
  recent: Array<{
    ticker: string;
    name: string;
    stance: string;
    conviction: number;
    revision: number;
    recordedAt: string;
  }>;
};

type Profile = {
  sector: string;
  vehicle: string;
  signal: string;
  traits: string[];
};

export type LessonDraft = {
  title: string;
  statement: string;
  scope: LessonScope;
  effect: LessonEffect;
  evidence: string;
  confidence?: Confidence;
  traitMatch?: "any" | "all";
  appliesWhen?: {
    sectors?: string[];
    vehicles?: string[];
    signals?: string[];
    traits?: string[];
  };
};

export type AssessmentDraft = {
  ticker: string;
  stance: Stance;
  conviction: number;
  growthThesis: string;
  growthDrivers: string[];
  growthConstraints?: string[];
  horizonYears: number;
  revenueGrowthView: Assessment["revenueGrowthView"];
  earningsQuality: Assessment["earningsQuality"];
  reinvestment: Assessment["reinvestment"];
  valuationNote: string;
  expectedReturnBand: string;
  keyRisks: string[];
  whatWouldChangeMyMind: string[];
  openQuestions?: string[];
  evidenceUsed?: string[];
  lessonsApplied?: string[];
  relationshipsAcknowledged?: string[];
  freeNotes?: string;
  ecosystem?: string;
};

type HostKv = ToolContext["host"]["kv"];

const TRAIT_SET = new Set<string>(TRAITS);
const SIGNAL_SET = new Set<string>(SIGNALS);
const VEHICLE_SET = new Set<string>(VEHICLES);
const CONFIDENCE_RANK: Record<Confidence, number> = {
  tentative: 0,
  supported: 1,
  repeated: 2,
};

const FIXTURE_GENERATED_AT = "2026-10-16T00:00:00Z";

type RawCompany = {
  ticker: string;
  name: string;
  sector: string;
  vehicle: Vehicle;
  signal: string;
  compositeScore: number | null;
  dataQualityScore: number | null;
  timingSignal: string | null;
  rsi14: number | null;
  priceVsSma200Pct: number | null;
  weeksAtSignal: number | null;
  stabilityLabel: string | null;
  piotroski: number | null;
  modelsPassed: number | null;
  modelCount: number | null;
  passedFamilies: string[];
  failedModels: string[];
  keyMetrics: Record<string, string>;
  debtToEquity: number | null;
  currentRatio: number | null;
  earningsGrowthPct: number | null;
  dividendYieldRaw: number | null;
  lynchPeg: number | null;
  operatingCashflow: number | null;
  freeCashflow: number | null;
  freeCashflowPrev: number | null;
  fcfDividendCoverageNet: number | null;
  cyclical: boolean;
  researchVerdict: string | null;
  researchRationale: string | null;
  summary: string;
};

const FIXTURE_RAW: RawCompany[] = [
  {
    ticker: "BYIT.L",
    name: "Bytes Technology Group plc",
    sector: "Technology",
    vehicle: "operating",
    signal: "buy",
    compositeScore: 0.6942,
    dataQualityScore: 1,
    timingSignal: "neutral",
    rsi14: 63.3,
    priceVsSma200Pct: 0.259,
    weeksAtSignal: 25,
    stabilityLabel: "persistent",
    piotroski: 6,
    modelsPassed: 7,
    modelCount: 22,
    passedFamilies: ["cheapness", "quality", "garp", "risk"],
    failedModels: [
      "Graham Defensive",
      "Graham Enterprising",
      "Graham Net-Net",
      "Schloss Low P/B",
      "Deep Value",
      "Earnings Yield",
      "FCF Yield",
      "Low P/E + High Yield",
    ],
    keyMetrics: {
      "P/E": "22.7",
      "P/B": "13.2",
      Yield: "2.2%",
      ROE: "57.2%",
      FCF: "55131000.0",
    },
    debtToEquity: 2.441,
    currentRatio: 1.054,
    earningsGrowthPct: -0.0606,
    dividendYieldRaw: 2.25,
    lynchPeg: null,
    operatingCashflow: 61044000,
    freeCashflow: 55131000,
    freeCashflowPrev: 64900000,
    fcfDividendCoverageNet: 1.134,
    cyclical: false,
    researchVerdict: "accumulate",
    researchRationale:
      "The H1 guidance upgrade still supports the buy screen, but cost and vendor concentration risks keep research conviction capped.",
    summary:
      "Hold on the value screen (7/22 models, composite 69%). P/E 22.7, yield 2.2%, ROE 57.2%. Price extended above the 200-day average.",
  },
  {
    ticker: "MEGP.L",
    name: "ME Group International plc",
    sector: "Industrials",
    vehicle: "operating",
    signal: "strong_buy",
    compositeScore: 0.8344,
    dataQualityScore: 1,
    timingSignal: "neutral",
    rsi14: 39.72,
    priceVsSma200Pct: -0.1236,
    weeksAtSignal: 25,
    stabilityLabel: "persistent",
    piotroski: 6,
    modelsPassed: 12,
    modelCount: 22,
    passedFamilies: ["cheapness", "quality", "garp", "risk"],
    failedModels: [
      "Graham Defensive",
      "Graham Net-Net",
      "Schloss Low P/B",
      "Deep Value",
      "FCF Yield",
      "Lynch PEG",
      "High Dividend Yield",
      "Dividend Growth",
    ],
    keyMetrics: {
      "P/E": "7.5",
      "P/B": "2.1",
      Yield: "7.7%",
      ROE: "28.2%",
      FCF: "25153000.0",
    },
    debtToEquity: 27.822,
    currentRatio: 1.542,
    earningsGrowthPct: 0.0446,
    dividendYieldRaw: 7.66,
    lynchPeg: 1.687,
    operatingCashflow: 90762000,
    freeCashflow: 25153000,
    freeCashflowPrev: 31256000,
    fcfDividendCoverageNet: 0.845,
    cyclical: true,
    researchVerdict: "accumulate",
    researchRationale:
      "Cheapness and laundry cash generation still look supported, but H1 softness, a guide cut, and sub-1x statutory FCF dividend cover weaken the strong-buy case.",
    summary:
      "Value screen strong buy (12/22, composite 83%). P/E 7.5, yield 7.7%, ROE 28.2%. Statutory FCF covers the dividend 0.85x. Price below the 200-day average.",
  },
  {
    ticker: "RIO.L",
    name: "Rio Tinto Group",
    sector: "Basic Materials",
    vehicle: "operating",
    signal: "buy",
    compositeScore: 0.637,
    dataQualityScore: 1,
    timingSignal: "neutral",
    rsi14: 46.48,
    priceVsSma200Pct: -0.0016,
    weeksAtSignal: 11,
    stabilityLabel: "persistent",
    piotroski: 5,
    modelsPassed: 8,
    modelCount: 22,
    passedFamilies: ["cheapness", "quality", "garp", "risk"],
    failedModels: [
      "Graham Defensive",
      "Graham Net-Net",
      "Schloss Low P/B",
      "Deep Value",
      "Earnings Yield",
      "FCF Yield",
      "Low P/E + High Yield",
      "Lynch PEG",
    ],
    keyMetrics: {
      "P/E": "13.0",
      "P/B": "2.4",
      Yield: "4.9%",
      ROE: "19.3%",
      FCF: "4497000000.0",
    },
    debtToEquity: 31.872,
    currentRatio: 1.445,
    earningsGrowthPct: -0.1377,
    dividendYieldRaw: 4.89,
    lynchPeg: null,
    operatingCashflow: 16832000000,
    freeCashflow: 4497000000,
    freeCashflowPrev: 5978000000,
    fcfDividendCoverageNet: 0.732,
    cyclical: false,
    researchVerdict: "accumulate",
    researchRationale:
      "Filing cheapness still supports phased accumulation, but statutory FCF dividend cover remains below 1x.",
    summary:
      "Value screen buy (8/22, composite 64%). P/E 13, yield 4.9%, ROE 19.3%. Earnings growth on the screen is negative. FCF covers the dividend 0.73x.",
  },
];

export function dataMode(ctx: ToolContext): "fixture" | "live" {
  if (ctx.session?.purpose === "eval") return "fixture";
  if (process.env.GROWTH_EXPLORER_FIXTURE === "1") return "fixture";
  return "live";
}

export function storePrefix(ctx: ToolContext, mode: "fixture" | "live"): string {
  if (ctx.session?.purpose === "eval") {
    return `fw:eval:${ctx.session.id || "unknown"}:`;
  }
  return mode === "fixture" ? "fw:fixture:" : "fw:";
}

function round(value: number | null, digits: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/[%£$,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function asStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim() !== "") out.push(item.trim());
    if (out.length >= cap) break;
  }
  return out;
}

function clip(value: string | null, max: number): string | null {
  if (value == null) return null;
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function normaliseTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}

function familyTrait(family: string): Trait | null {
  const slug = family.trim().toLowerCase();
  const candidate = `family_${slug}`;
  return TRAIT_SET.has(candidate) ? (candidate as Trait) : null;
}

export function toCard(raw: RawCompany): CompanyCard {
  const earningsGrowthPercent = round(
    raw.earningsGrowthPct == null ? null : raw.earningsGrowthPct * 100,
    2,
  );
  const priceVsSma200Percent = round(
    raw.priceVsSma200Pct == null ? null : raw.priceVsSma200Pct * 100,
    2,
  );
  const dividendYieldPercent = round(raw.dividendYieldRaw, 2);
  const pe = asNumber(raw.keyMetrics["P/E"]);
  const roe = asNumber(raw.keyMetrics.ROE);
  const traits: string[] = [];
  const add = (trait: Trait | null) => {
    if (trait && !traits.includes(trait)) traits.push(trait);
  };

  if (pe != null && pe > 0 && pe < 12) add("low_pe");
  if (pe != null && pe > 25) add("high_pe");
  if (dividendYieldPercent != null && dividendYieldPercent >= 4) add("high_yield");
  if (dividendYieldPercent != null && dividendYieldPercent < 1.5) add("low_yield");
  if (roe != null && roe >= 15) add("high_roe");
  if (roe != null && roe >= 0 && roe < 8) add("low_roe");
  if (raw.debtToEquity != null && raw.debtToEquity > 100) add("high_leverage");
  if (raw.debtToEquity != null && raw.debtToEquity < 40) add("low_leverage");
  if (raw.freeCashflow != null && raw.freeCashflow > 0) add("fcf_positive");
  if (raw.freeCashflow != null && raw.freeCashflow < 0) add("fcf_negative");
  if (raw.fcfDividendCoverageNet != null && raw.fcfDividendCoverageNet < 1) {
    add("fcf_cover_below_1");
  }
  if (raw.fcfDividendCoverageNet != null && raw.fcfDividendCoverageNet >= 1.5) {
    add("fcf_cover_comfortable");
  }
  if (earningsGrowthPercent != null && earningsGrowthPercent > 5) add("earnings_growing");
  if (earningsGrowthPercent != null && earningsGrowthPercent < 0) add("earnings_shrinking");
  if (priceVsSma200Percent != null && priceVsSma200Percent < 0) add("below_sma200");
  if (priceVsSma200Percent != null && priceVsSma200Percent > 0) add("above_sma200");
  if (raw.dataQualityScore != null && raw.dataQualityScore >= 0.8) add("high_data_quality");
  if (raw.dataQualityScore != null && raw.dataQualityScore < 0.5) add("thin_data");
  if (raw.piotroski != null && raw.piotroski >= 7) add("piotroski_strong");
  if (raw.piotroski != null && raw.piotroski <= 3) add("piotroski_weak");
  if (raw.cyclical) add("cyclical");
  add(raw.vehicle === "investment_vehicle" ? "investment_vehicle" : "operating_company");
  for (const family of raw.passedFamilies) add(familyTrait(family));

  const flags: string[] = [];
  if (raw.vehicle === "investment_vehicle") {
    flags.push(
      "Investment vehicle: judge growth as NAV compounding, costs, and discount, not operating revenue.",
    );
  }
  flags.push(
    `Value-screen signal is ${raw.signal}. That is evidence from a separate value model, not your stance.`,
  );
  if (raw.fcfDividendCoverageNet != null && raw.fcfDividendCoverageNet < 1) {
    flags.push("Statutory free cash flow covers the dividend less than 1x.");
  }
  if (earningsGrowthPercent != null && earningsGrowthPercent < 0) {
    flags.push("Screen earnings growth is negative.");
  }
  if (priceVsSma200Percent != null && priceVsSma200Percent < 0) {
    flags.push("Price is below the 200-day average.");
  }
  if (raw.dataQualityScore != null && raw.dataQualityScore < 0.5) {
    flags.push("Data quality on the screen is thin. Treat missing figures as unknown.");
  }

  return {
    ticker: raw.ticker,
    name: raw.name,
    sector: raw.sector,
    vehicle: raw.vehicle,
    signal: raw.signal,
    compositeScore: round(raw.compositeScore, 4),
    dataQualityScore: round(raw.dataQualityScore, 4),
    timingSignal: raw.timingSignal,
    rsi14: round(raw.rsi14, 2),
    priceVsSma200Percent,
    weeksAtSignal: raw.weeksAtSignal,
    stabilityLabel: raw.stabilityLabel,
    piotroski: raw.piotroski,
    modelsPassed: raw.modelsPassed,
    modelCount: raw.modelCount,
    passedFamilies: raw.passedFamilies,
    failedModels: raw.failedModels.slice(0, 8),
    keyMetrics: raw.keyMetrics,
    debtToEquityPercent: round(raw.debtToEquity, 2),
    currentRatio: round(raw.currentRatio, 2),
    earningsGrowthPercent,
    dividendYieldPercent,
    lynchPeg: round(raw.lynchPeg, 2),
    operatingCashflow: round(raw.operatingCashflow, 0),
    freeCashflow: round(raw.freeCashflow, 0),
    freeCashflowPrev: round(raw.freeCashflowPrev, 0),
    fcfDividendCoverageNet: round(raw.fcfDividendCoverageNet, 2),
    researchVerdict: raw.researchVerdict,
    researchRationale: clip(raw.researchRationale, 400),
    summary: clip(raw.summary, 500) ?? "",
    traits,
    flags,
  };
}

function piotroskiScore(value: unknown): number | null {
  if (typeof value === "number") return asNumber(value);
  if (value && typeof value === "object" && "score" in value) {
    return asNumber((value as { score: unknown }).score);
  }
  return null;
}

function passedFamilies(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
  }
  return asStringList(value, 12);
}

function rawFromReport(report: Record<string, unknown>, vehicle: Vehicle): RawCompany | null {
  const ticker = asString(report.ticker);
  const name = asString(report.name);
  if (!ticker || !name) return null;
  const screening =
    report.screening_inputs && typeof report.screening_inputs === "object"
      ? (report.screening_inputs as Record<string, unknown>)
      : {};
  const cashflow =
    report.cashflow_metrics && typeof report.cashflow_metrics === "object"
      ? (report.cashflow_metrics as Record<string, unknown>)
      : {};
  const keyMetrics: Record<string, string> = {};
  if (report.key_metrics && typeof report.key_metrics === "object") {
    for (const [key, value] of Object.entries(report.key_metrics as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number") keyMetrics[key] = String(value);
    }
  }
  return {
    ticker: normaliseTicker(ticker),
    name,
    sector: asString(report.sector) ?? "Unknown",
    vehicle,
    signal: asString(report.signal) ?? "insufficient_data",
    compositeScore: asNumber(report.composite_score),
    dataQualityScore: asNumber(report.data_quality_score),
    timingSignal: asString(report.timing_signal),
    rsi14: asNumber(report.rsi_14),
    priceVsSma200Pct: asNumber(report.price_vs_sma200_pct),
    weeksAtSignal: asNumber(report.weeks_at_signal),
    stabilityLabel: asString(report.stability_label),
    piotroski: piotroskiScore(report.piotroski_f_score),
    modelsPassed: asNumber(report.models_passed),
    modelCount: asNumber(report.model_count),
    passedFamilies: passedFamilies(report.passed_families),
    failedModels: asStringList(report.failed_models, 8),
    keyMetrics,
    debtToEquity: asNumber(screening.debt_to_equity),
    currentRatio: asNumber(screening.current_ratio),
    earningsGrowthPct: asNumber(screening.earnings_growth_pct),
    dividendYieldRaw: asNumber(screening.dividend_yield_raw),
    lynchPeg: asNumber(screening.lynch_peg_model),
    operatingCashflow: asNumber(cashflow.operating_cashflow),
    freeCashflow: asNumber(cashflow.free_cashflow),
    freeCashflowPrev: asNumber(cashflow.free_cashflow_prev),
    fcfDividendCoverageNet: asNumber(cashflow.fcf_dividend_coverage_net),
    cyclical: report.cyclical_exposure_detected === true,
    researchVerdict: asString(report.research_verdict),
    researchRationale: asString(report.research_rationale),
    summary: asString(report.summary) ?? "",
  };
}

function cardsFromPayload(payload: unknown): {
  generatedAt: string | null;
  label: string;
  companies: CompanyCard[];
} | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const byTicker = new Map<string, CompanyCard>();
  const take = (value: unknown, vehicle: Vehicle) => {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const raw = rawFromReport(item as Record<string, unknown>, vehicle);
      if (!raw || byTicker.has(raw.ticker)) continue;
      byTicker.set(raw.ticker, toCard(raw));
    }
  };
  take(root.reports, "operating");
  take(root.trust_reports, "investment_vehicle");
  const companies = [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (companies.length === 0) return null;
  const meta = root.meta && typeof root.meta === "object" ? (root.meta as Record<string, unknown>) : {};
  return {
    generatedAt: asString(root.generated_at),
    label: asString(meta.universe_label) ?? "FTSE 350",
    companies,
  };
}

function fixtureSnapshot(nowIso: string): UniverseSnapshot {
  return {
    source: "fixture",
    sourceUrl: "fixture://ftse-growth-explorer",
    generatedAt: FIXTURE_GENERATED_AT,
    fetchedAt: nowIso,
    stale: false,
    universeLabel: "FTSE 350 fixture (3 names)",
    companies: FIXTURE_RAW.map(toCard),
  };
}

function isSnapshot(value: unknown): value is UniverseSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as UniverseSnapshot;
  return Array.isArray(snapshot.companies) && typeof snapshot.fetchedAt === "string";
}

export async function loadUniverse(
  ctx: ToolContext,
  prefix: string,
  mode: "fixture" | "live",
  refresh: boolean,
): Promise<UniverseSnapshot | { error: string; detail: string }> {
  if (mode === "fixture") return fixtureSnapshot(ctx.now().toISOString());
  const key = `${prefix}universe`;
  const cached = await ctx.host.kv.get(key);
  const fresh =
    isSnapshot(cached) &&
    cached.source === "live" &&
    ctx.now().getTime() - Date.parse(cached.fetchedAt) < CACHE_TTL_MS;
  if (!refresh && fresh && isSnapshot(cached)) return { ...cached, stale: false };

  try {
    const response = await fetch(UNIVERSE_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const parsed = cardsFromPayload(await response.json());
    if (!parsed) throw new Error("latest.json did not contain company reports");
    const snapshot: UniverseSnapshot = {
      source: "live",
      sourceUrl: UNIVERSE_URL,
      generatedAt: parsed.generatedAt,
      fetchedAt: ctx.now().toISOString(),
      stale: false,
      universeLabel: parsed.label,
      companies: parsed.companies,
    };
    await ctx.host.kv.put(key, snapshot);
    return snapshot;
  } catch (error) {
    if (isSnapshot(cached) && cached.source === "live") {
      return { ...cached, stale: true };
    }
    return {
      error: "universe_fetch_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function emptyMeta(): LedgerMeta {
  return { assessedTickers: [], stanceCounts: {}, recent: [] };
}

function isMeta(value: unknown): value is LedgerMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as LedgerMeta;
  return Array.isArray(meta.assessedTickers) && Array.isArray(meta.recent);
}

function isAssessment(value: unknown): value is Assessment {
  if (!value || typeof value !== "object") return false;
  const assessment = value as Assessment;
  return typeof assessment.ticker === "string" && typeof assessment.revision === "number";
}

function isAssessmentFile(value: unknown): value is AssessmentFile {
  if (!value || typeof value !== "object") return false;
  const file = value as AssessmentFile;
  return isAssessment(file.current) && Array.isArray(file.history);
}

function isLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const lesson = value as Lesson;
  return typeof lesson.id === "string" && typeof lesson.statement === "string";
}

function isRevisit(value: unknown): value is Revisit {
  if (!value || typeof value !== "object") return false;
  const revisit = value as Revisit;
  return typeof revisit.ticker === "string" && typeof revisit.lessonId === "string";
}

async function readMeta(kv: HostKv, prefix: string): Promise<LedgerMeta> {
  const value = await kv.get(`${prefix}meta`);
  return isMeta(value) ? value : emptyMeta();
}

async function readRevisits(kv: HostKv, prefix: string): Promise<Revisit[]> {
  const value = await kv.get(`${prefix}revisits`);
  if (!Array.isArray(value)) return [];
  return value.filter(isRevisit);
}

async function readLessonIds(kv: HostKv, prefix: string): Promise<string[]> {
  const value = await kv.get(`${prefix}lesson-ids`);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

async function readLessons(kv: HostKv, prefix: string): Promise<Lesson[]> {
  const ids = await readLessonIds(kv, prefix);
  const lessons: Lesson[] = [];
  for (const id of ids) {
    const value = await kv.get(`${prefix}lesson:${id}`);
    if (isLesson(value)) lessons.push(value);
  }
  return lessons;
}

async function readAssessment(kv: HostKv, prefix: string, ticker: string): Promise<AssessmentFile | null> {
  const value = await kv.get(`${prefix}assessment:${ticker}`);
  return isAssessmentFile(value) ? value : null;
}

async function readEcosystem(kv: HostKv, prefix: string) {
  const value = await kv.get(`${prefix}ecosystem`);
  return isEcosystemStore(value) ? value : emptyEcosystemStore();
}

async function trajectoryOf(kv: HostKv, prefix: string, ticker: string) {
  const file = await readAssessment(kv, prefix, ticker);
  if (!file) return null;
  const current = file.current;
  return {
    ticker: current.ticker,
    name: current.name,
    stance: current.stance,
    conviction: current.conviction,
    revenueGrowthView: current.revenueGrowthView,
    recordedAt: current.recordedAt,
    growthThesis: current.growthThesis,
    ecosystem: current.ecosystem ?? null,
  };
}

function profileFor(card: CompanyCard | undefined, assessment: Assessment | null): Profile | null {
  if (!card && !assessment) return null;
  const traits = new Set<string>([...(assessment?.traits ?? []), ...(card?.traits ?? [])]);
  return {
    sector: card?.sector ?? assessment?.sector ?? "",
    vehicle: card?.vehicle ?? assessment?.vehicle ?? "",
    signal: card?.signal ?? assessment?.signal ?? "",
    traits: [...traits],
  };
}

function lessonMatches(lesson: Lesson, profile: Profile, ticker: string): boolean {
  if (lesson.scope === "this_name_only") return lesson.sourceTicker === ticker;
  if (lesson.scope === "all_names") return true;
  const { sectors, vehicles, signals, traits } = lesson.appliesWhen;
  if (sectors.length === 0 && vehicles.length === 0 && signals.length === 0 && traits.length === 0) {
    return false;
  }
  if (sectors.length > 0 && !sectors.some((sector) => sector.toLowerCase() === profile.sector.toLowerCase())) {
    return false;
  }
  if (vehicles.length > 0 && !vehicles.includes(profile.vehicle as Vehicle)) return false;
  if (signals.length > 0 && !signals.includes(profile.signal)) return false;
  if (traits.length > 0) {
    const hits = traits.filter((trait) => profile.traits.includes(trait)).length;
    const matched = lesson.traitMatch === "all" ? hits === traits.length : hits > 0;
    if (!matched) return false;
  }
  return true;
}

export function selectLessons(
  lessons: Lesson[],
  profile: Profile,
  ticker: string,
  revisitLessonIds: string[],
): Lesson[] {
  const matching = lessons.filter((lesson) => lessonMatches(lesson, profile, ticker));
  const rank = (lesson: Lesson) => {
    if (revisitLessonIds.includes(lesson.id)) return 0;
    if (lesson.effect === "method") return 1;
    return 2;
  };
  return matching
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      return b.createdAt.localeCompare(a.createdAt);
    })
    .slice(0, LESSONS_PER_PACKET);
}

function lessonSummary(lesson: Lesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    statement: lesson.statement,
    scope: lesson.scope,
    effect: lesson.effect,
    confidence: lesson.confidence,
    traitMatch: lesson.traitMatch ?? "any",
    sourceTicker: lesson.sourceTicker,
    appliesWhen: lesson.appliesWhen,
    evidence: lesson.evidence,
  };
}

function findCard(snapshot: UniverseSnapshot, ticker: string): CompanyCard | undefined {
  return snapshot.companies.find((company) => company.ticker === ticker);
}

function sectorsOf(snapshot: UniverseSnapshot): string[] {
  return [...new Set(snapshot.companies.map((company) => company.sector))].sort();
}

type LedgerTouch = {
  active: boolean;
  hydrated: boolean;
  source: LedgerSource | null;
  updatedAt: string | null;
  warning?: string;
};

type PermanentLedgerStatus =
  | { active: false; saved: false }
  | {
      active: true;
      saved: boolean;
      version: typeof LEDGER_VERSION;
      updatedAt: string;
      file: string | null;
      deploymentFile: string | null;
      reason?: string;
      repoError?: string;
      deploymentError?: string;
    };

function deploymentFiles(ctx: ToolContext): DeploymentFiles | undefined {
  return ctx.host.files;
}

async function applyLedgerDocument(kv: HostKv, prefix: string, document: LedgerDocument): Promise<void> {
  const json = (value: unknown) => value as Parameters<HostKv["put"]>[1];
  await kv.put(`${prefix}meta`, document.meta);
  await kv.put(`${prefix}revisits`, json(document.revisits));
  await kv.put(`${prefix}ecosystem`, document.ecosystem);
  const ids: string[] = [];
  for (const lesson of document.lessons) {
    if (!lesson || typeof lesson !== "object") continue;
    const id = (lesson as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    ids.push(id);
    await kv.put(`${prefix}lesson:${id}`, json(lesson));
  }
  await kv.put(`${prefix}lesson-ids`, ids);
  for (const [ticker, file] of Object.entries(document.assessments)) {
    await kv.put(`${prefix}assessment:${ticker}`, json(file));
  }
}

async function mirrorPermanentLedger(
  ctx: ToolContext,
  chosen: { document: LedgerDocument; source: LedgerSource },
  repo: LedgerRead,
  deployment: LedgerRead,
): Promise<string | undefined> {
  const text = renderLedgerDocument(chosen.document);
  const warnings: string[] = [];
  const deploymentBehind =
    !deployment.ok || (deployment.ok && deployment.document.updatedAt < chosen.document.updatedAt);
  if (deploymentBehind) {
    try {
      await writeDeploymentLedger(deploymentFiles(ctx), text);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!repo.ok && repo.missing) {
    try {
      await writeRepoLedger(text);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return warnings.length > 0 ? warnings.join(" ") : undefined;
}

async function ensureLiveLedger(ctx: ToolContext, prefix: string): Promise<LedgerTouch> {
  if (prefix !== LIVE_PREFIX) return { active: false, hydrated: false, source: null, updatedAt: null };
  const repo = await readRepoLedger();
  const deployment = await readDeploymentLedger(deploymentFiles(ctx));
  const chosen = chooseLedger(repo, deployment);
  const warning = ledgerWarning(repo, deployment);
  const meta = await readMeta(ctx.host.kv, prefix);
  if (meta.assessedTickers.length > 0 || !chosen) {
    return {
      active: true,
      hydrated: false,
      source: null,
      updatedAt: chosen?.document.updatedAt ?? null,
      ...(warning ? { warning } : {}),
    };
  }
  await applyLedgerDocument(ctx.host.kv, prefix, chosen.document);
  const mirrorWarning = await mirrorPermanentLedger(ctx, chosen, repo, deployment);
  const combined = [warning, mirrorWarning].filter((item): item is string => Boolean(item)).join(" ");
  return {
    active: true,
    hydrated: true,
    source: chosen.source,
    updatedAt: chosen.document.updatedAt,
    ...(combined ? { warning: combined } : {}),
  };
}

async function persistLiveLedger(ctx: ToolContext, prefix: string, updatedAt: string): Promise<PermanentLedgerStatus> {
  if (prefix !== LIVE_PREFIX) return { active: false, saved: false };
  const meta = await readMeta(ctx.host.kv, prefix);
  const assessments: LedgerDocument["assessments"] = {};
  for (const ticker of [...meta.assessedTickers].sort()) {
    const file = await readAssessment(ctx.host.kv, prefix, ticker);
    if (file) assessments[ticker] = { current: file.current, history: file.history };
  }
  const document = buildLedgerDocument({
    updatedAt,
    meta,
    assessments,
    lessons: await readLessons(ctx.host.kv, prefix),
    ecosystem: await readEcosystem(ctx.host.kv, prefix),
    revisits: await readRevisits(ctx.host.kv, prefix),
  });
  const text = renderLedgerDocument(document);
  let file: string | null = null;
  let deploymentFile: string | null = null;
  let repoError: string | undefined;
  let deploymentError: string | undefined;
  try {
    await writeRepoLedger(text);
    file = LEDGER_REPO_RELATIVE;
  } catch (error) {
    repoError = error instanceof Error ? error.message : String(error);
  }
  try {
    await writeDeploymentLedger(deploymentFiles(ctx), text);
    deploymentFile = LEDGER_DEPLOYMENT_PATH;
  } catch (error) {
    deploymentError = error instanceof Error ? error.message : String(error);
  }
  return {
    active: true,
    saved: file != null || deploymentFile != null,
    version: LEDGER_VERSION,
    updatedAt,
    file,
    deploymentFile,
    ...(repoError ? { repoError } : {}),
    ...(deploymentError ? { deploymentError } : {}),
  };
}

function resumedLedger(touch: LedgerTouch): {
  permanentLedger?: {
    resumedFrom: LedgerSource | null;
    file: string;
    deploymentFile: string;
    updatedAt: string | null;
  };
  ledgerWarning?: string;
} {
  if (!touch.active) return {};
  return {
    ...(touch.hydrated
      ? {
          permanentLedger: {
            resumedFrom: touch.source,
            file: LEDGER_REPO_RELATIVE,
            deploymentFile: LEDGER_DEPLOYMENT_PATH,
            updatedAt: touch.updatedAt,
          },
        }
      : {}),
    ...(touch.warning ? { ledgerWarning: touch.warning } : {}),
  };
}

export async function buildWorkItem(
  ctx: ToolContext,
  options: { ticker?: string; refreshUniverse?: boolean },
) {
  const mode = dataMode(ctx);
  const prefix = storePrefix(ctx, mode);
  const ledgerTouch = await ensureLiveLedger(ctx, prefix);
  const snapshot = await loadUniverse(ctx, prefix, mode, options.refreshUniverse === true);
  if ("error" in snapshot) return { ok: false as const, ...snapshot, ...resumedLedger(ledgerTouch) };

  const meta = await readMeta(ctx.host.kv, prefix);
  const revisits = await readRevisits(ctx.host.kv, prefix);
  const lessons = await readLessons(ctx.host.kv, prefix);
  const assessed = new Set(meta.assessedTickers);
  const operating = snapshot.companies.filter((company) => company.vehicle === "operating").length;
  const progress = {
    universeLabel: snapshot.universeLabel,
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    stale: snapshot.stale,
    total: snapshot.companies.length,
    operating,
    investmentVehicles: snapshot.companies.length - operating,
    assessed: assessed.size,
    remainingNew: snapshot.companies.filter((company) => !assessed.has(company.ticker)).length,
    openRevisits: revisits.length,
    lessons: lessons.length,
  };

  const requested = options.ticker ? normaliseTicker(options.ticker) : null;
  let chosen: CompanyCard | undefined;
  let kind: "new" | "revisit" | "refresh" | "done" = "done";
  let reason = "Every constituent has an assessment and the revisit queue is empty.";

  if (requested) {
    chosen = findCard(snapshot, requested);
    if (!chosen) {
      return {
        ok: false as const,
        error: "unknown_ticker",
        detail: `${requested} is not in the current ${snapshot.universeLabel} extract.`,
        progress,
        ...resumedLedger(ledgerTouch),
      };
    }
    const pending = revisits.filter((revisit) => revisit.ticker === chosen!.ticker);
    if (pending.length > 0) {
      kind = "revisit";
      reason = pending.map((revisit) => revisit.reason).join(" ");
    } else if (assessed.has(chosen.ticker)) {
      kind = "refresh";
      reason = "Requested name already has an assessment. Record a new revision only if the evidence changed your view.";
    } else {
      kind = "new";
      reason = "Requested name has not been assessed yet.";
    }
  } else {
    const nextRevisit = revisits[0];
    if (nextRevisit) {
      chosen = findCard(snapshot, nextRevisit.ticker);
      if (!chosen) {
        const remaining = revisits.filter((revisit) => revisit.ticker !== nextRevisit.ticker);
        await ctx.host.kv.put(`${prefix}revisits`, remaining);
        return buildWorkItem(ctx, options);
      }
      kind = "revisit";
      reason = nextRevisit.reason;
    } else {
      chosen = snapshot.companies.find((company) => !assessed.has(company.ticker));
      if (chosen) {
        kind = "new";
        reason = "Next unassessed constituent in ticker order. Revisits, when present, jump this queue.";
      }
    }
  }

  if (!chosen || kind === "done") {
    return { ok: true as const, kind: "done" as const, progress, sectors: sectorsOf(snapshot), ...resumedLedger(ledgerTouch) };
  }

  const file = await readAssessment(ctx.host.kv, prefix, chosen.ticker);
  const pendingIds = revisits
    .filter((revisit) => revisit.ticker === chosen!.ticker && revisit.lessonId !== "")
    .map((revisit) => revisit.lessonId);
  const profile = profileFor(chosen, file?.current ?? null);
  const packet = profile ? selectLessons(lessons, profile, chosen.ticker, pendingIds) : [];
  const ecosystem = await readEcosystem(ctx.host.kv, prefix);
  const network = await buildNetworkView(ecosystem, chosen.ticker, (id) => trajectoryOf(ctx.host.kv, prefix, id));

  return {
    ok: true as const,
    kind,
    reason,
    progress,
    dataVintage: {
      source: snapshot.source,
      sourceUrl: snapshot.sourceUrl,
      generatedAt: snapshot.generatedAt,
      stale: snapshot.stale,
    },
    company: chosen,
    priorAssessment: file?.current ?? null,
    lessonsToApply: packet.map(lessonSummary),
    requiredLessonIds: packet.map((lesson) => lesson.id),
    network,
    sectors: sectorsOf(snapshot),
    ...resumedLedger(ledgerTouch),
  };
}

function canonicalList(values: string[] | undefined, allowed: Set<string>, label: string): string[] | { error: string; detail: string } {
  const out: string[] = [];
  for (const value of values ?? []) {
    const match = [...allowed].find((item) => item.toLowerCase() === value.trim().toLowerCase());
    if (!match) {
      return {
        error: `unknown_${label}`,
        detail: `"${value}" is not a known ${label}. Allowed: ${[...allowed].join(", ")}`,
      };
    }
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

function canonicalSectors(values: string[] | undefined, sectors: string[]): string[] | { error: string; detail: string } {
  const out: string[] = [];
  for (const value of values ?? []) {
    const match = sectors.find((sector) => sector.toLowerCase() === value.trim().toLowerCase());
    if (!match) {
      return {
        error: "unknown_sector",
        detail: `"${value}" is not a sector in the current universe. Allowed: ${sectors.join(", ")}`,
      };
    }
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

function newLessonId(now: Date): string {
  const stamp = now.getTime().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `L-${stamp}-${noise}`;
}

export async function recordLearning(
  ctx: ToolContext,
  draft: AssessmentDraft,
  lessonDrafts: LessonDraft[],
  confidenceUpdates: Array<{ id: string; confidence: Confidence }>,
  relationshipDrafts: RelationshipDraft[] = [],
) {
  const mode = dataMode(ctx);
  const prefix = storePrefix(ctx, mode);
  await ensureLiveLedger(ctx, prefix);
  const snapshot = await loadUniverse(ctx, prefix, mode, false);
  if ("error" in snapshot) return { ok: false as const, ...snapshot };

  const ticker = normaliseTicker(draft.ticker);
  const card = findCard(snapshot, ticker);
  if (!card) {
    return {
      ok: false as const,
      error: "unknown_ticker",
      detail: `${ticker} is not in the current ${snapshot.universeLabel} extract.`,
    };
  }

  const lessons = await readLessons(ctx.host.kv, prefix);
  const revisits = await readRevisits(ctx.host.kv, prefix);
  const existing = await readAssessment(ctx.host.kv, prefix, ticker);
  const now = ctx.now();
  const nowIso = now.toISOString();

  if (
    relationshipDrafts.length === 0 &&
    !draft.ecosystem &&
    existing &&
    existing.current.growthThesis === draft.growthThesis &&
    existing.current.stance === draft.stance &&
    now.getTime() - Date.parse(existing.current.recordedAt) < DEDUPE_MS
  ) {
    return {
      ok: true as const,
      deduped: true,
      ticker,
      revision: existing.current.revision,
      detail: "An identical thesis and stance was recorded moments ago. Nothing new was written.",
      permanentLedger:
        prefix === LIVE_PREFIX
          ? {
              active: true as const,
              saved: false as const,
              version: LEDGER_VERSION,
              updatedAt: existing.current.recordedAt,
              file: LEDGER_REPO_RELATIVE,
              deploymentFile: LEDGER_DEPLOYMENT_PATH,
              reason: "deduped",
            }
          : { active: false as const, saved: false as const },
    };
  }

  const pendingIds = revisits
    .filter((revisit) => revisit.ticker === ticker && revisit.lessonId !== "")
    .map((revisit) => revisit.lessonId);
  const profile = profileFor(card, existing?.current ?? null);
  const required = profile ? selectLessons(lessons, profile, ticker, pendingIds) : [];
  const applied = [...new Set((draft.lessonsApplied ?? []).map((id) => id.trim()).filter(Boolean))];
  const missing = required.map((lesson) => lesson.id).filter((id) => !applied.includes(id));
  if (missing.length > 0) {
    return {
      ok: false as const,
      error: "lessons_not_applied",
      detail: "Cite every lesson in lessonsToApply. Citing means you accounted for it, including when it did not change the stance.",
      missing,
      lessonsToApply: required.map(lessonSummary),
    };
  }
  const unknownApplied = applied.filter((id) => !lessons.some((lesson) => lesson.id === id));
  const ecosystemStore = await readEcosystem(ctx.host.kv, prefix);
  const network = await buildNetworkView(ecosystemStore, ticker, (id) => trajectoryOf(ctx.host.kv, prefix, id));
  const acknowledged = [...new Set((draft.relationshipsAcknowledged ?? []).map((id) => id.trim()).filter(Boolean))];
  const missingRelationships = network.requiredRelationshipIds.filter((id) => !acknowledged.includes(id));
  if (missingRelationships.length > 0) {
    return {
      ok: false as const,
      error: "relationships_not_acknowledged",
      detail:
        "Cite every relationship in network.direct. Citing means you used it, including when the prime trajectory did not change your stance.",
      missing: missingRelationships,
      network,
    };
  }
  const metaBefore = await readMeta(ctx.host.kv, prefix);
  const networkUpdate = applyNetworkUpdate({
    store: ecosystemStore,
    directory: snapshot.companies.map((company) => ({ ticker: company.ticker, name: company.name })),
    drafts: relationshipDrafts,
    recordedFrom: ticker,
    recordedFromName: card.name,
    ecosystem: draft.ecosystem,
    now,
    trajectoryChanged:
      existing != null &&
      (existing.current.revenueGrowthView !== draft.revenueGrowthView || existing.current.stance !== draft.stance),
    assessed: new Set(metaBefore.assessedTickers),
  });
  if (!networkUpdate.ok) return { ok: false as const, error: networkUpdate.error, detail: networkUpdate.detail };

  const sectors = sectorsOf(snapshot);
  const prepared: Lesson[] = [];
  for (const lessonDraft of lessonDrafts) {
    const title = lessonDraft.title.trim();
    const duplicate = lessons.find(
      (lesson) =>
        lesson.sourceTicker === ticker && lesson.title.trim().toLowerCase() === title.toLowerCase(),
    );
    if (duplicate) {
      prepared.push(duplicate);
      continue;
    }
    let appliesWhen = { sectors: [] as string[], vehicles: [] as Vehicle[], signals: [] as string[], traits: [] as string[] };
    if (lessonDraft.scope === "matching") {
      const sectorResult = canonicalSectors(lessonDraft.appliesWhen?.sectors, sectors);
      if ("error" in sectorResult) return { ok: false as const, ...sectorResult };
      const vehicleResult = canonicalList(lessonDraft.appliesWhen?.vehicles, VEHICLE_SET, "vehicle");
      if ("error" in vehicleResult) return { ok: false as const, ...vehicleResult };
      const signalResult = canonicalList(lessonDraft.appliesWhen?.signals, SIGNAL_SET, "signal");
      if ("error" in signalResult) return { ok: false as const, ...signalResult };
      const traitResult = canonicalList(lessonDraft.appliesWhen?.traits, TRAIT_SET, "trait");
      if ("error" in traitResult) return { ok: false as const, ...traitResult };
      appliesWhen = {
        sectors: sectorResult,
        vehicles: vehicleResult as Vehicle[],
        signals: signalResult,
        traits: traitResult,
      };
      if (
        appliesWhen.sectors.length +
          appliesWhen.vehicles.length +
          appliesWhen.signals.length +
          appliesWhen.traits.length ===
        0
      ) {
        return {
          ok: false as const,
          error: "lesson_has_no_scope",
          detail: `Lesson "${title}" uses scope matching but appliesWhen is empty, so it cannot be reused. Add a sector, vehicle, signal, or trait, or use all_names / this_name_only.`,
        };
      }
    }
    prepared.push({
      id: newLessonId(now),
      createdAt: nowIso,
      updatedAt: nowIso,
      sourceTicker: ticker,
      title,
      statement: lessonDraft.statement.trim(),
      scope: lessonDraft.scope,
      effect: lessonDraft.effect,
      evidence: lessonDraft.evidence.trim(),
      confidence: lessonDraft.confidence ?? "tentative",
      traitMatch: lessonDraft.traitMatch ?? "any",
      appliesWhen,
      applications: [],
    });
  }

  const assessment: Assessment = {
    ticker,
    name: card.name,
    sector: card.sector,
    vehicle: card.vehicle,
    signal: card.signal,
    traits: card.traits,
    revision: (existing?.current.revision ?? 0) + 1,
    recordedAt: nowIso,
    stance: draft.stance,
    conviction: draft.conviction,
    growthThesis: draft.growthThesis.trim(),
    growthDrivers: draft.growthDrivers,
    growthConstraints: draft.growthConstraints ?? [],
    horizonYears: draft.horizonYears,
    revenueGrowthView: draft.revenueGrowthView,
    earningsQuality: draft.earningsQuality,
    reinvestment: draft.reinvestment,
    valuationNote: draft.valuationNote.trim(),
    expectedReturnBand: draft.expectedReturnBand.trim(),
    keyRisks: draft.keyRisks,
    whatWouldChangeMyMind: draft.whatWouldChangeMyMind,
    openQuestions: draft.openQuestions ?? [],
    evidenceUsed: draft.evidenceUsed ?? [],
    lessonsApplied: applied.filter((id) => lessons.some((lesson) => lesson.id === id)),
    freeNotes: (draft.freeNotes ?? "").trim(),
    ecosystem:
      draft.ecosystem !== undefined ? draft.ecosystem.trim() || null : (existing?.current.ecosystem ?? null),
  };

  const history = existing ? [...existing.history, existing.current].slice(-HISTORY_CAP) : [];
  await ctx.host.kv.put(`${prefix}assessment:${ticker}`, { current: assessment, history });

  const meta = await readMeta(ctx.host.kv, prefix);
  if (!meta.assessedTickers.includes(ticker)) meta.assessedTickers.push(ticker);
  meta.assessedTickers.sort();
  if (existing) {
    const previous = existing.current.stance;
    meta.stanceCounts[previous] = Math.max(0, (meta.stanceCounts[previous] ?? 1) - 1);
  }
  meta.stanceCounts[assessment.stance] = (meta.stanceCounts[assessment.stance] ?? 0) + 1;
  meta.recent = [
    {
      ticker,
      name: card.name,
      stance: assessment.stance,
      conviction: assessment.conviction,
      revision: assessment.revision,
      recordedAt: nowIso,
    },
    ...meta.recent.filter((item) => item.ticker !== ticker),
  ].slice(0, RECENT_CAP);
  await ctx.host.kv.put(`${prefix}meta`, meta);

  const priorStance = existing?.current.stance ?? null;
  const changedStance = priorStance != null && priorStance !== assessment.stance;
  for (const lesson of lessons) {
    if (!applied.includes(lesson.id)) continue;
    const applications = [
      ...lesson.applications,
      { ticker, at: nowIso, revision: assessment.revision, changedStance },
    ].slice(-30);
    await ctx.host.kv.put(`${prefix}lesson:${lesson.id}`, {
      ...lesson,
      applications,
      updatedAt: nowIso,
    });
  }

  const created: Array<{ id: string; title: string; revisitsQueued: number }> = [];
  const queued: Revisit[] = [...revisits];
  const assessedProfiles = new Map<string, Profile>();
  for (const assessedTicker of meta.assessedTickers) {
    if (assessedTicker === ticker) continue;
    const file = await readAssessment(ctx.host.kv, prefix, assessedTicker);
    const assessedCard = findCard(snapshot, assessedTicker);
    const assessedProfile = profileFor(assessedCard, file?.current ?? null);
    if (assessedProfile) assessedProfiles.set(assessedTicker, assessedProfile);
  }

  let ids = await readLessonIds(ctx.host.kv, prefix);
  for (const lesson of prepared) {
    const already = lessons.some((item) => item.id === lesson.id);
    if (already) {
      created.push({ id: lesson.id, title: lesson.title, revisitsQueued: 0 });
      continue;
    }
    let revisitsQueued = 0;
    if (lesson.scope !== "this_name_only") {
      for (const [assessedTicker, assessedProfile] of assessedProfiles) {
        if (!lessonMatches(lesson, assessedProfile, assessedTicker)) continue;
        const open = queued.some((revisit) => revisit.ticker === assessedTicker && revisit.lessonId === lesson.id);
        if (open) continue;
        queued.push({
          ticker: assessedTicker,
          lessonId: lesson.id,
          reason: `Lesson ${lesson.id} (${lesson.title}) was learned on ${ticker} and matches this name.`,
          queuedAt: nowIso,
        });
        revisitsQueued += 1;
      }
    }
    await ctx.host.kv.put(`${prefix}lesson:${lesson.id}`, lesson);
    ids = [...ids, lesson.id];
    created.push({ id: lesson.id, title: lesson.title, revisitsQueued });
  }
  await ctx.host.kv.put(`${prefix}lesson-ids`, ids);

  for (const item of networkUpdate.queues) {
    const open = queued.some(
      (revisit) => revisit.ticker === item.ticker && revisit.relationshipId === item.relationshipId,
    );
    if (open) continue;
    queued.push({
      ticker: item.ticker,
      lessonId: "",
      relationshipId: item.relationshipId,
      reason: item.reason,
      queuedAt: nowIso,
    });
  }
  await ctx.host.kv.put(`${prefix}ecosystem`, networkUpdate.store);

  const warnings: string[] = [];
  for (const update of confidenceUpdates) {
    const stored = await ctx.host.kv.get(`${prefix}lesson:${update.id}`);
    if (!isLesson(stored)) {
      warnings.push(`Confidence update skipped unknown lesson ${update.id}.`);
      continue;
    }
    if (CONFIDENCE_RANK[update.confidence] > CONFIDENCE_RANK[stored.confidence]) {
      await ctx.host.kv.put(`${prefix}lesson:${stored.id}`, {
        ...stored,
        confidence: update.confidence,
        updatedAt: nowIso,
      });
    }
  }

  const closed = new Set(applied);
  const ackedRelationships = new Set(acknowledged);
  const remaining = queued.filter((revisit) => {
    if (revisit.ticker !== ticker) return true;
    if (revisit.relationshipId) return !ackedRelationships.has(revisit.relationshipId);
    if (revisit.lessonId) return !closed.has(revisit.lessonId);
    return true;
  });
  await ctx.host.kv.put(`${prefix}revisits`, remaining);
  const permanentLedger = await persistLiveLedger(ctx, prefix, nowIso);

  return {
    ok: true as const,
    deduped: false,
    ticker,
    name: card.name,
    revision: assessment.revision,
    stance: assessment.stance,
    conviction: assessment.conviction,
    lessonsCreated: created,
    lessonsApplied: assessment.lessonsApplied,
    unknownLessonIds: unknownApplied,
    warnings,
    relationships: networkUpdate.updates,
    revisitsQueued:
      created.reduce((sum, lesson) => sum + lesson.revisitsQueued, 0) + networkUpdate.queues.length,
    openRevisits: remaining.length,
    assessed: meta.assessedTickers.length,
    total: snapshot.companies.length,
    permanentLedger,
  };
}

export async function learningStatus(ctx: ToolContext, limits: { lessons: number; revisits: number }) {
  const mode = dataMode(ctx);
  const prefix = storePrefix(ctx, mode);
  const ledgerTouch = await ensureLiveLedger(ctx, prefix);
  const snapshot = await loadUniverse(ctx, prefix, mode, false);
  if ("error" in snapshot) return { ok: false as const, ...snapshot, ...resumedLedger(ledgerTouch) };
  const meta = await readMeta(ctx.host.kv, prefix);
  const revisits = await readRevisits(ctx.host.kv, prefix);
  const lessons = await readLessons(ctx.host.kv, prefix);
  const ecosystem = await readEcosystem(ctx.host.kv, prefix);
  const assessed = new Set(meta.assessedTickers);
  const nextNew = snapshot.companies.find((company) => !assessed.has(company.ticker)) ?? null;
  return {
    ok: true as const,
    universe: {
      label: snapshot.universeLabel,
      source: snapshot.source,
      sourceUrl: snapshot.sourceUrl,
      generatedAt: snapshot.generatedAt,
      fetchedAt: snapshot.fetchedAt,
      stale: snapshot.stale,
      total: snapshot.companies.length,
    },
    progress: {
      assessed: assessed.size,
      remainingNew: snapshot.companies.length - assessed.size,
      openRevisits: revisits.length,
      lessons: lessons.length,
      relationships: ecosystem.links.length,
      nextNewTicker: nextNew?.ticker ?? null,
      nextQueue: revisits[0]?.ticker ?? nextNew?.ticker ?? null,
    },
    stanceCounts: meta.stanceCounts,
    recentAssessments: meta.recent,
    openRevisits: revisits.slice(0, limits.revisits),
    lessons: lessons.slice(-limits.lessons).reverse().map(lessonSummary),
    network: {
      links: ecosystem.links.length,
      ecosystems: [...new Set(ecosystem.members.map((member) => member.ecosystem))].slice(0, 12),
    },
    permanentLedger: ledgerTouch.active
      ? {
          active: true as const,
          file: LEDGER_REPO_RELATIVE,
          deploymentFile: LEDGER_DEPLOYMENT_PATH,
          updatedAt: ledgerTouch.updatedAt,
          hydrated: ledgerTouch.hydrated,
          ...(ledgerTouch.source ? { resumedFrom: ledgerTouch.source } : {}),
          ...(ledgerTouch.warning ? { warning: ledgerTouch.warning } : {}),
        }
      : { active: false as const },
  };
}
