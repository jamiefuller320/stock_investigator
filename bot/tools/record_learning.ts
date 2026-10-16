import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod/v3";
import {
  CONFIDENCE,
  LESSON_EFFECTS,
  LESSON_SCOPES,
  recordLearning,
  STANCES,
} from "../lib/framework.js";

const stance = z.enum(STANCES);
const effect = z.enum(LESSON_EFFECTS);
const scope = z.enum(LESSON_SCOPES);
const confidence = z.enum(CONFIDENCE);

export default defineTool({
  description:
    "Save one structured growth assessment, reusable lessons, and ecosystem relationships. Lessons and newly mapped primes are queued against constituents already assessed. lessonsApplied and relationshipsAcknowledged must cite every id in the work packet. Call once per name.",
  effect: "write",
  inputSchema: z.object({
    ticker: z.string(),
    stance: stance.describe(
      "research_buy = worth deeper work toward a profitable investment. watch = interesting but not yet. pass = no edge. avoid = growth case looks value-destructive.",
    ),
    conviction: z.number().int().min(1).max(5),
    growthThesis: z.string().min(40).max(2000),
    growthDrivers: z.array(z.string().min(3)).min(1).max(6),
    growthConstraints: z.array(z.string().min(3)).max(6).optional(),
    horizonYears: z.number().int().min(1).max(15),
    revenueGrowthView: z.enum(["accelerating", "steady", "decelerating", "unclear"]),
    earningsQuality: z.enum(["high", "mixed", "low", "unclear"]),
    reinvestment: z.enum(["high", "moderate", "low", "unclear"]),
    valuationNote: z.string().min(10).max(800),
    expectedReturnBand: z
      .string()
      .min(8)
      .max(300)
      .describe("Qualitative band and horizon, not a promise. Example: mid-single-digit annualised over 4 years if cash conversion holds."),
    keyRisks: z.array(z.string().min(3)).min(1).max(6),
    whatWouldChangeMyMind: z.array(z.string().min(3)).min(1).max(6),
    openQuestions: z.array(z.string().min(3)).max(6).optional(),
    evidenceUsed: z.array(z.string().min(2)).max(12).optional(),
    lessonsApplied: z
      .array(z.string())
      .max(12)
      .optional()
      .describe("Ids from lessonsToApply. Required when that list is non-empty."),
    ecosystem: z
      .string()
      .min(3)
      .max(80)
      .optional()
      .describe("Operating ecosystem, such as UK defence aerospace or seaborne iron ore. Reuse a name already listed in network.knownEcosystems when it fits."),
    relationshipsAcknowledged: z
      .array(z.string())
      .max(12)
      .optional()
      .describe("Ids from network.direct. Required when that list is non-empty."),
    relationships: z
      .array(
        z.object({
          subjectTicker: z
            .string()
            .optional()
            .describe("FTSE ticker on the supplier side. Defaults to the company being assessed. Use another ticker when mapping that supplier from the prime's investigation."),
          role: z.enum(["supplies_to", "buys_from", "competes_with", "same_programme"]),
          counterpartyTicker: z
            .string()
            .optional()
            .describe("FTSE ticker when the counterparty is in the extract. Omit for a government, foreign, or private prime."),
          counterpartyName: z.string().min(2).max(120),
          ecosystem: z.string().min(3).max(80),
          programme: z.string().min(2).max(120).optional(),
          rationale: z.string().min(10).max(400),
          provenance: z.enum(["general_knowledge", "company_card", "prior_investigation"]),
          confidence: confidence.optional(),
          counterpartyTrajectory: z.enum(["expanding", "steady", "contracting", "unclear"]).optional(),
          trajectoryNote: z
            .string()
            .min(10)
            .max(400)
            .optional()
            .describe("Qualitative demand proxy for a prime that is not on this ledger. No contract values or financial figures."),
        }),
      )
      .max(6)
      .optional()
      .describe(
        "supplies_to means this subject holds supply contracts for the counterparty. The counterparty trajectory is the proxy for how those contracts may grow.",
      ),
    freeNotes: z
      .string()
      .max(4000)
      .optional()
      .describe("Free reasoning. Anything reusable must also be a lesson or a relationship, not only prose here."),
    lessons: z
      .array(
        z.object({
          title: z.string().min(8).max(140),
          statement: z.string().min(20).max(1500),
          scope: scope.describe(
            "matching = names that fit appliesWhen. all_names = every constituent. this_name_only = do not reuse.",
          ),
          effect: effect,
          evidence: z.string().min(10).max(800),
          confidence: confidence.optional(),
          traitMatch: z
            .enum(["any", "all"])
            .optional()
            .describe("When several traits are set: any = one trait is enough, all = every trait must be present. Default any."),
          appliesWhen: z
            .object({
              sectors: z.array(z.string()).max(8).optional(),
              vehicles: z.array(z.enum(["operating", "investment_vehicle"])).max(2).optional(),
              signals: z
                .array(z.enum(["strong_buy", "buy", "hold", "avoid", "insufficient_data"]))
                .max(5)
                .optional(),
              traits: z.array(z.string()).max(8).optional(),
            })
            .optional(),
        }),
      )
      .max(4)
      .optional(),
    confidenceUpdates: z
      .array(z.object({ id: z.string(), confidence }))
      .max(6)
      .optional()
      .describe("Raise an existing lesson from tentative to supported or repeated. Confidence never moves backward."),
  }),
  async execute(input, ctx) {
    return recordLearning(
      ctx,
      input,
      input.lessons ?? [],
      input.confidenceUpdates ?? [],
      input.relationships ?? [],
    );
  },
});
