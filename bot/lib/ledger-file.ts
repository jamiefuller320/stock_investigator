import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEcosystemStore, type EcosystemStore } from "./network.js";

/**
 * Durable copy of the learning ledger.
 *
 * The host key-value store is wiped with a session state root. This file is
 * the copy that survives that, and that a person can read. The FTSE universe
 * cache is not included.
 */

export const LEDGER_VERSION = 1;
export const LIVE_PREFIX = "fw:";
export const LEDGER_REPO_RELATIVE = "ledger/ledger.json";
export const LEDGER_DEPLOYMENT_PATH = "ledger.json";

const LEDGER_DESCRIPTION =
  "FTSE Growth Explorer learning ledger. Assessments, lessons, supply relationships, ecosystem membership, and revisits. The FTSE universe cache is not included.";

export type LedgerDocument = {
  version: typeof LEDGER_VERSION;
  description: string;
  updatedAt: string;
  progress: {
    assessed: number;
    lessons: number;
    relationships: number;
    ecosystems: number;
    openRevisits: number;
  };
  meta: {
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
  assessments: Record<string, { current: unknown; history: unknown[] }>;
  lessons: unknown[];
  ecosystem: EcosystemStore;
  revisits: unknown[];
};

export type DeploymentFiles = {
  read(path: string, options?: { scope?: { kind: "deployment" } }): Promise<string | undefined>;
  write(path: string, data: string, options?: { scope?: { kind: "deployment" } }): Promise<void>;
};

export type LedgerRead =
  | { ok: true; document: LedgerDocument }
  | { ok: false; missing: true }
  | { ok: false; missing: false; error: string };

export type LedgerSource = "repo" | "deployment";

const DEPLOYMENT_SCOPE = { scope: { kind: "deployment" as const } };

export function repoLedgerPath(): string {
  return fileURLToPath(new URL(`../../${LEDGER_REPO_RELATIVE}`, import.meta.url));
}

export function renderLedgerDocument(document: LedgerDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseLedgerDocument(text: string): LedgerDocument | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const document = value as LedgerDocument;
  if (document.version !== LEDGER_VERSION) return null;
  if (typeof document.updatedAt !== "string" || document.updatedAt.trim() === "") return null;
  if (!isMeta(document.meta)) return null;
  if (!isAssessments(document.assessments)) return null;
  if (!Array.isArray(document.lessons) || !document.lessons.every(isLesson)) return null;
  if (!isEcosystemStore(document.ecosystem)) return null;
  if (!Array.isArray(document.revisits) || !document.revisits.every(isRevisit)) return null;
  return {
    version: LEDGER_VERSION,
    description: typeof document.description === "string" ? document.description : LEDGER_DESCRIPTION,
    updatedAt: document.updatedAt,
    progress: progressFor(document),
    meta: document.meta,
    assessments: document.assessments,
    lessons: document.lessons,
    ecosystem: document.ecosystem,
    revisits: document.revisits,
  };
}

export function buildLedgerDocument(input: {
  updatedAt: string;
  meta: LedgerDocument["meta"];
  assessments: LedgerDocument["assessments"];
  lessons: unknown[];
  ecosystem: EcosystemStore;
  revisits: unknown[];
}): LedgerDocument {
  const document: LedgerDocument = {
    version: LEDGER_VERSION,
    description: LEDGER_DESCRIPTION,
    updatedAt: input.updatedAt,
    progress: {
      assessed: 0,
      lessons: 0,
      relationships: 0,
      ecosystems: 0,
      openRevisits: 0,
    },
    meta: input.meta,
    assessments: input.assessments,
    lessons: input.lessons,
    ecosystem: input.ecosystem,
    revisits: input.revisits,
  };
  document.progress = progressFor(document);
  return document;
}

export async function readRepoLedger(): Promise<LedgerRead> {
  try {
    const text = await readFile(repoLedgerPath(), "utf8");
    const document = parseLedgerDocument(text);
    if (!document) return { ok: false, missing: false, error: `${LEDGER_REPO_RELATIVE} is not a version ${LEDGER_VERSION} ledger.` };
    return { ok: true, document };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { ok: false, missing: true };
    return { ok: false, missing: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function readDeploymentLedger(files: DeploymentFiles | undefined): Promise<LedgerRead> {
  if (!files) return { ok: false, missing: true };
  try {
    const text = await files.read(LEDGER_DEPLOYMENT_PATH, DEPLOYMENT_SCOPE);
    if (text == null || text === "") return { ok: false, missing: true };
    const document = parseLedgerDocument(text);
    if (!document) {
      return { ok: false, missing: false, error: `deployment ${LEDGER_DEPLOYMENT_PATH} is not a version ${LEDGER_VERSION} ledger.` };
    }
    return { ok: true, document };
  } catch (error) {
    return { ok: false, missing: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function writeRepoLedger(text: string): Promise<void> {
  const path = repoLedgerPath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, path);
}

export async function writeDeploymentLedger(files: DeploymentFiles | undefined, text: string): Promise<void> {
  if (!files) throw new Error("Host files are not available on this host.");
  await files.write(LEDGER_DEPLOYMENT_PATH, text, DEPLOYMENT_SCOPE);
}

export function chooseLedger(
  repo: LedgerRead,
  deployment: LedgerRead,
): { document: LedgerDocument; source: LedgerSource } | null {
  if (repo.ok && deployment.ok) {
    return deployment.document.updatedAt > repo.document.updatedAt
      ? { document: deployment.document, source: "deployment" }
      : { document: repo.document, source: "repo" };
  }
  if (repo.ok) return { document: repo.document, source: "repo" };
  if (deployment.ok) return { document: deployment.document, source: "deployment" };
  return null;
}

export function ledgerWarning(repo: LedgerRead, deployment: LedgerRead): string | undefined {
  const parts: string[] = [];
  if (!repo.ok && !repo.missing) parts.push(repo.error);
  if (!deployment.ok && !deployment.missing) parts.push(deployment.error);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function progressFor(document: Pick<LedgerDocument, "meta" | "lessons" | "ecosystem" | "revisits">): LedgerDocument["progress"] {
  return {
    assessed: document.meta.assessedTickers.length,
    lessons: document.lessons.length,
    relationships: document.ecosystem.links.length,
    ecosystems: new Set(document.ecosystem.members.map((member) => member.ecosystem)).size,
    openRevisits: document.revisits.length,
  };
}

function isMeta(value: unknown): value is LedgerDocument["meta"] {
  if (!value || typeof value !== "object") return false;
  const meta = value as LedgerDocument["meta"];
  return Array.isArray(meta.assessedTickers) && meta.assessedTickers.every((item) => typeof item === "string") && Array.isArray(meta.recent);
}

function isAssessments(value: unknown): value is LedgerDocument["assessments"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((file) => {
    if (!file || typeof file !== "object") return false;
    const assessment = file as { current?: { ticker?: unknown; revision?: unknown }; history?: unknown };
    return (
      typeof assessment.current?.ticker === "string" &&
      typeof assessment.current.revision === "number" &&
      Array.isArray(assessment.history)
    );
  });
}

function isLesson(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const lesson = value as { id?: unknown; statement?: unknown };
  return typeof lesson.id === "string" && typeof lesson.statement === "string";
}

function isRevisit(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const revisit = value as { ticker?: unknown; lessonId?: unknown };
  return typeof revisit.ticker === "string" && typeof revisit.lessonId === "string";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
