import type { Confidence } from "./framework.js";

/**
 * Supply and ecosystem graph. A link learned while investigating one
 * constituent is attached to the counterparty's later investigation,
 * including the prime contractor's trajectory as a demand proxy.
 */

export const RELATIONSHIP_ROLES = [
  "supplies_to",
  "buys_from",
  "competes_with",
  "same_programme",
] as const;

export const TRAJECTORY_VIEWS = ["expanding", "steady", "contracting", "unclear"] as const;

export const PROVENANCE = ["general_knowledge", "company_card", "prior_investigation"] as const;

export type RelationshipRole = (typeof RELATIONSHIP_ROLES)[number];
export type TrajectoryView = (typeof TRAJECTORY_VIEWS)[number];
export type Provenance = (typeof PROVENANCE)[number];

export type Relationship = {
  id: string;
  subjectTicker: string;
  subjectName: string;
  role: RelationshipRole;
  counterpartyTicker: string | null;
  counterpartyName: string;
  ecosystem: string;
  programme: string | null;
  rationale: string;
  provenance: Provenance;
  confidence: Confidence;
  counterpartyTrajectory: TrajectoryView | null;
  trajectoryNote: string | null;
  recordedFrom: string;
  createdAt: string;
  updatedAt: string;
};

export type RelationshipDraft = {
  subjectTicker?: string;
  role: RelationshipRole;
  counterpartyTicker?: string;
  counterpartyName: string;
  ecosystem: string;
  programme?: string;
  rationale: string;
  provenance: Provenance;
  confidence?: Confidence;
  counterpartyTrajectory?: TrajectoryView;
  trajectoryNote?: string;
};

export type EcosystemStore = {
  links: Relationship[];
  members: Array<{ ecosystem: string; ticker: string; name: string }>;
};

export type DirectoryEntry = { ticker: string; name: string };

export type TrajectorySnapshot = {
  ticker: string;
  name: string;
  stance: string;
  conviction: number;
  revenueGrowthView: string;
  recordedAt: string;
  growthThesis: string;
  ecosystem: string | null;
};

type ResolvedParty = { ticker: string | null; name: string };

const CONFIDENCE_RANK: Record<Confidence, number> = {
  tentative: 0,
  supported: 1,
  repeated: 2,
};

export function emptyEcosystemStore(): EcosystemStore {
  return { links: [], members: [] };
}

export function isEcosystemStore(value: unknown): value is EcosystemStore {
  if (!value || typeof value !== "object") return false;
  const store = value as EcosystemStore;
  return Array.isArray(store.links) && Array.isArray(store.members);
}

function ecosystemKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function partyKey(party: ResolvedParty): string {
  return party.ticker ?? ecosystemKey(party.name);
}

function newRelationshipId(now: Date): string {
  const stamp = now.getTime().toString(36);
  const noise = Math.random().toString(36).slice(2, 8);
  return `N-${stamp}-${noise}`;
}

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

export function resolveParty(
  directory: DirectoryEntry[],
  ticker: string | undefined,
  name: string | undefined,
  label: string,
): ResolvedParty | { error: string; detail: string } {
  const requestedTicker = ticker?.trim().toUpperCase();
  if (requestedTicker) {
    const card = directory.find((entry) => entry.ticker === requestedTicker);
    if (!card) {
      return {
        error: "unknown_ticker",
        detail: `${requestedTicker} is not in the FTSE 350 extract. For a counterparty outside the universe, omit the ticker and keep the name.`,
      };
    }
    return { ticker: card.ticker, name: card.name };
  }
  const requestedName = name?.trim() ?? "";
  if (requestedName === "") {
    return { error: "missing_counterparty", detail: `${label} needs a ticker or a name.` };
  }
  const asTicker = directory.find((entry) => entry.ticker === requestedName.toUpperCase());
  if (asTicker) return { ticker: asTicker.ticker, name: asTicker.name };
  const byName = directory.filter((entry) => entry.name.toLowerCase() === requestedName.toLowerCase());
  if (byName.length === 1) return { ticker: byName[0].ticker, name: byName[0].name };
  return { ticker: null, name: requestedName };
}

function addMember(store: EcosystemStore, ecosystem: string, ticker: string, name: string) {
  const key = ecosystemKey(ecosystem);
  const label = ecosystem.trim().replace(/\s+/g, " ");
  const existing = store.members.find(
    (member) => member.ticker === ticker && ecosystemKey(member.ecosystem) === key,
  );
  if (existing) {
    existing.name = name;
    return;
  }
  store.members.push({ ecosystem: label, ticker, name });
}

export type RelationshipUpdate = {
  id: string;
  created: boolean;
  subjectTicker: string;
  counterpartyTicker: string | null;
  counterpartyName: string;
  role: RelationshipRole;
  revisitsQueued: number;
};

export function applyNetworkUpdate(input: {
  store: EcosystemStore;
  directory: DirectoryEntry[];
  drafts: RelationshipDraft[];
  recordedFrom: string;
  recordedFromName: string;
  ecosystem?: string;
  now: Date;
  trajectoryChanged: boolean;
  assessed: Set<string>;
}): { ok: true; store: EcosystemStore; updates: RelationshipUpdate[]; queues: Array<{ ticker: string; relationshipId: string; reason: string }> } | { ok: false; error: string; detail: string } {
  const store: EcosystemStore = {
    links: input.store.links.map((link) => ({ ...link })),
    members: input.store.members.map((member) => ({ ...member })),
  };
  const nowIso = input.now.toISOString();
  const updates: RelationshipUpdate[] = [];
  const queues: Array<{ ticker: string; relationshipId: string; reason: string }> = [];
  const seenQueue = new Set<string>();
  const queue = (ticker: string, relationshipId: string, reason: string) => {
    if (ticker === input.recordedFrom || !input.assessed.has(ticker)) return false;
    const key = `${ticker}:${relationshipId}`;
    if (seenQueue.has(key)) return false;
    seenQueue.add(key);
    queues.push({ ticker, relationshipId, reason });
    return true;
  };

  if (input.ecosystem && input.ecosystem.trim() !== "") {
    addMember(store, input.ecosystem, input.recordedFrom, input.recordedFromName);
  }

  for (const draft of input.drafts) {
    const subject = resolveParty(input.directory, draft.subjectTicker ?? input.recordedFrom, undefined, "Subject");
    if ("error" in subject || !subject.ticker) {
      return {
        ok: false,
        error: "error" in subject ? subject.error : "unknown_ticker",
        detail: "error" in subject ? subject.detail : "A relationship subject must be inside the FTSE 350 extract.",
      };
    }
    const counterparty = resolveParty(
      input.directory,
      draft.counterpartyTicker,
      draft.counterpartyName,
      "Counterparty",
    );
    if ("error" in counterparty) return { ok: false, error: counterparty.error, detail: counterparty.detail };
    if (counterparty.ticker === subject.ticker) {
      return {
        ok: false,
        error: "self_link",
        detail: `${subject.ticker} cannot be both sides of a relationship.`,
      };
    }
    const ecosystem = draft.ecosystem.trim().replace(/\s+/g, " ");
    const key = `${subject.ticker}|${draft.role}|${partyKey(counterparty)}`;
    const existing = store.links.find(
      (link) => `${link.subjectTicker}|${link.role}|${link.counterpartyTicker ?? ecosystemKey(link.counterpartyName)}` === key,
    );
    const trajectory = draft.counterpartyTrajectory ?? existing?.counterpartyTrajectory ?? null;
    const note = draft.trajectoryNote?.trim() || existing?.trajectoryNote || null;
    const externalTrajectoryChanged =
      counterparty.ticker == null &&
      existing != null &&
      (existing.counterpartyTrajectory !== trajectory || (existing.trajectoryNote ?? null) !== note);

    let link: Relationship;
    let created = false;
    if (existing) {
      const confidence = draft.confidence ?? existing.confidence;
      existing.ecosystem = ecosystem;
      existing.programme = draft.programme?.trim() || existing.programme;
      existing.rationale = draft.rationale.trim();
      existing.provenance = draft.provenance === "prior_investigation" ? draft.provenance : existing.provenance;
      existing.confidence =
        CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[existing.confidence] ? confidence : existing.confidence;
      existing.counterpartyTrajectory = trajectory;
      existing.trajectoryNote = note;
      existing.updatedAt = nowIso;
      link = existing;
    } else {
      created = true;
      link = {
        id: newRelationshipId(input.now),
        subjectTicker: subject.ticker,
        subjectName: subject.name,
        role: draft.role,
        counterpartyTicker: counterparty.ticker,
        counterpartyName: counterparty.name,
        ecosystem,
        programme: draft.programme?.trim() || null,
        rationale: draft.rationale.trim(),
        provenance: draft.provenance,
        confidence: draft.confidence ?? "tentative",
        counterpartyTrajectory: trajectory,
        trajectoryNote: note,
        recordedFrom: input.recordedFrom,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      store.links.push(link);
    }
    addMember(store, ecosystem, subject.ticker, subject.name);
    if (counterparty.ticker) addMember(store, ecosystem, counterparty.ticker, counterparty.name);

    let revisitsQueued = 0;
    if (created && link.subjectTicker !== input.recordedFrom) {
      if (
        queue(
          link.subjectTicker,
          link.id,
          `Relationship ${link.id}: ${link.subjectName} ${link.role.replaceAll("_", " ")} ${link.counterpartyName} was mapped while investigating ${input.recordedFrom}.`,
        )
      ) {
        revisitsQueued += 1;
      }
    }
    if (externalTrajectoryChanged && link.role === "supplies_to") {
      for (const other of store.links) {
        if (other.role !== "supplies_to") continue;
        if ((other.counterpartyTicker ?? ecosystemKey(other.counterpartyName)) !== partyKey(counterparty)) continue;
        if (
          queue(
            other.subjectTicker,
            other.id,
            `External prime ${counterparty.name} trajectory changed while investigating ${input.recordedFrom}. Reuse that proxy instead of rebuilding it.`,
          )
        ) {
          revisitsQueued += 1;
        }
      }
    }
    updates.push({
      id: link.id,
      created,
      subjectTicker: link.subjectTicker,
      counterpartyTicker: link.counterpartyTicker,
      counterpartyName: link.counterpartyName,
      role: link.role,
      revisitsQueued,
    });
  }

  if (input.trajectoryChanged) {
    for (const link of store.links) {
      if (link.role !== "supplies_to" || link.counterpartyTicker !== input.recordedFrom) continue;
      if (
        queue(
          link.subjectTicker,
          link.id,
          `Prime ${input.recordedFromName} (${input.recordedFrom}) changed trajectory. That is the demand proxy for contracts awarded to ${link.subjectTicker}.`,
        )
      ) {
        const update = updates.find((item) => item.id === link.id);
        if (update) update.revisitsQueued += 1;
      }
    }
  }

  return { ok: true, store, updates, queues };
}

export type NetworkLinkView = {
  id: string;
  role: RelationshipRole;
  subjectTicker: string;
  subjectName: string;
  counterpartyTicker: string | null;
  counterpartyName: string;
  ecosystem: string;
  programme: string | null;
  rationale: string;
  provenance: Provenance;
  confidence: Confidence;
  recordedFrom: string;
  demandProxy: boolean;
  trajectory: {
    source: "ledger_assessment" | "recorded_note" | "unknown";
    view: string | null;
    note: string | null;
    stance: string | null;
    conviction: number | null;
    asOf: string | null;
    thesis: string | null;
  };
};

export type NetworkView = {
  direct: NetworkLinkView[];
  peers: Array<{
    ticker: string;
    name: string;
    ecosystem: string;
    stance: string | null;
    revenueGrowthView: string | null;
  }>;
  knownEcosystems: Array<{
    ecosystem: string;
    members: string[];
    primes: Array<{ name: string; ticker: string | null; view: string | null }>;
  }>;
  reuseNotes: string[];
  requiredRelationshipIds: string[];
};

function linkPartyKey(link: Relationship): string {
  return link.counterpartyTicker ?? ecosystemKey(link.counterpartyName);
}

export async function buildNetworkView(
  store: EcosystemStore,
  ticker: string,
  load: (ticker: string) => Promise<TrajectorySnapshot | null>,
): Promise<NetworkView> {
  const cache = new Map<string, TrajectorySnapshot | null>();
  const loadCached = async (id: string) => {
    if (!cache.has(id)) cache.set(id, await load(id));
    return cache.get(id) ?? null;
  };

  const touching = store.links.filter(
    (link) => link.subjectTicker === ticker || link.counterpartyTicker === ticker,
  );
  const rank = (link: Relationship) => {
    if (link.subjectTicker === ticker && link.role === "supplies_to") return 0;
    if (link.subjectTicker === ticker) return 1;
    if (link.counterpartyTicker === ticker) return 2;
    return 3;
  };
  const ordered = [...touching].sort((a, b) => rank(a) - rank(b)).slice(0, 12);
  const direct: NetworkLinkView[] = [];
  for (const link of ordered) {
    const proxyTicker =
      link.role === "supplies_to" || link.role === "buys_from" ? link.counterpartyTicker : link.counterpartyTicker;
    const snapshot = proxyTicker ? await loadCached(proxyTicker) : null;
    const trajectory = snapshot
      ? {
          source: "ledger_assessment" as const,
          view: snapshot.revenueGrowthView,
          note: link.trajectoryNote,
          stance: snapshot.stance,
          conviction: snapshot.conviction,
          asOf: snapshot.recordedAt,
          thesis: clip(snapshot.growthThesis, 280),
        }
      : link.trajectoryNote || link.counterpartyTrajectory
        ? {
            source: "recorded_note" as const,
            view: link.counterpartyTrajectory,
            note: link.trajectoryNote,
            stance: null,
            conviction: null,
            asOf: link.updatedAt,
            thesis: null,
          }
        : {
            source: "unknown" as const,
            view: null,
            note: null,
            stance: null,
            conviction: null,
            asOf: null,
            thesis: null,
          };
    direct.push({
      id: link.id,
      role: link.role,
      subjectTicker: link.subjectTicker,
      subjectName: link.subjectName,
      counterpartyTicker: link.counterpartyTicker,
      counterpartyName: link.counterpartyName,
      ecosystem: link.ecosystem,
      programme: link.programme,
      rationale: link.rationale,
      provenance: link.provenance,
      confidence: link.confidence,
      recordedFrom: link.recordedFrom,
      demandProxy: link.subjectTicker === ticker && link.role === "supplies_to",
      trajectory,
    });
  }

  const ownEcosystems = new Set<string>();
  for (const link of touching) ownEcosystems.add(ecosystemKey(link.ecosystem));
  const ownMember = store.members.find((member) => member.ticker === ticker);
  if (ownMember) ownEcosystems.add(ecosystemKey(ownMember.ecosystem));

  const directTickers = new Set(
    ordered.flatMap((link) => [link.subjectTicker, link.counterpartyTicker ?? ""]),
  );
  const peers: NetworkView["peers"] = [];
  for (const member of store.members) {
    if (member.ticker === ticker || directTickers.has(member.ticker)) continue;
    if (!ownEcosystems.has(ecosystemKey(member.ecosystem))) continue;
    if (peers.some((peer) => peer.ticker === member.ticker)) continue;
    const snapshot = await loadCached(member.ticker);
    peers.push({
      ticker: member.ticker,
      name: member.name,
      ecosystem: member.ecosystem,
      stance: snapshot?.stance ?? null,
      revenueGrowthView: snapshot?.revenueGrowthView ?? null,
    });
    if (peers.length >= 8) break;
  }

  const grouped = new Map<string, { ecosystem: string; members: Map<string, string>; primes: Map<string, { name: string; ticker: string | null; view: string | null }> }>();
  for (const member of store.members) {
    const key = ecosystemKey(member.ecosystem);
    const group = grouped.get(key) ?? {
      ecosystem: member.ecosystem,
      members: new Map<string, string>(),
      primes: new Map(),
    };
    group.members.set(member.ticker, member.ticker);
    grouped.set(key, group);
  }
  for (const link of store.links) {
    if (link.role !== "supplies_to") continue;
    const key = ecosystemKey(link.ecosystem);
    const group = grouped.get(key);
    if (!group) continue;
    const primeKey = linkPartyKey(link);
    if (group.primes.has(primeKey) || group.primes.size >= 3) continue;
    const snapshot = link.counterpartyTicker ? await loadCached(link.counterpartyTicker) : null;
    group.primes.set(primeKey, {
      name: link.counterpartyName,
      ticker: link.counterpartyTicker,
      view: snapshot?.revenueGrowthView ?? link.counterpartyTrajectory,
    });
  }
  const knownEcosystems = [...grouped.values()]
    .sort((a, b) => b.members.size - a.members.size)
    .slice(0, 8)
    .map((group) => ({
      ecosystem: group.ecosystem,
      members: [...group.members.values()].slice(0, 6),
      primes: [...group.primes.values()],
    }));

  const reuseNotes: string[] = [];
  for (const link of direct) {
    if (!link.demandProxy) continue;
    if (link.trajectory.source === "ledger_assessment") {
      reuseNotes.push(
        `Use ${link.counterpartyName} (${link.counterpartyTicker}) as the demand proxy. Ledger trajectory is ${link.trajectory.view}, stance ${link.trajectory.stance}, as of ${link.trajectory.asOf}. Do not rebuild that trajectory or invent figures for it.`,
      );
    } else if (link.trajectory.source === "recorded_note") {
      reuseNotes.push(
        `External prime ${link.counterpartyName} already has a qualitative trajectory (${link.trajectory.view ?? "noted"}). Reuse it. Do not invent financial figures for a name outside the extract.`,
      );
    } else {
      reuseNotes.push(
        `${link.counterpartyName} is a prime or customer with no trajectory on the ledger yet. A qualitative trajectoryNote may be stored on the link. Do not invent financial figures.`,
      );
    }
  }
  if (peers.length > 0) {
    reuseNotes.push(
      `Peers already filed in this ecosystem: ${peers.map((peer) => peer.ticker).join(", ")}. Extend their links instead of mapping the ecosystem again.`,
    );
  } else if (knownEcosystems.length > 0 && ownEcosystems.size === 0) {
    reuseNotes.push(
      `Ecosystems already mapped: ${knownEcosystems.map((group) => group.ecosystem).join("; ")}. File this name into one when it fits, and point supplies_to at a prime already listed.`,
    );
  }
  if (direct.some((link) => link.recordedFrom !== ticker)) {
    reuseNotes.push("Some relationships were recorded while investigating another constituent. Acknowledge them and only add what is new.");
  }

  return {
    direct,
    peers,
    knownEcosystems,
    reuseNotes,
    requiredRelationshipIds: direct.map((link) => link.id),
  };
}
