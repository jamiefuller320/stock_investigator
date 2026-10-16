import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod/v3";
import { buildWorkItem } from "../lib/framework.js";

export default defineTool({
  description:
    "Pick the next FTSE 350 growth investigation. Revisits triggered by a lesson or by a prime-contractor trajectory come before unseen names. Pass a ticker only when the user asked for that constituent. Returns the company card, prior assessment, lessons, and any ecosystem or supply relationships already on the ledger.",
  effect: "read",
  inputSchema: z.object({
    ticker: z
      .string()
      .optional()
      .describe("Optional LSE ticker such as MEGP.L. Omit to take the next queued name."),
    refreshUniverse: z
      .boolean()
      .optional()
      .describe("Set true to bypass the 24-hour cache and reload value_investor docs/data/latest.json."),
  }),
  async execute(input, ctx) {
    return buildWorkItem(ctx, input);
  },
});
