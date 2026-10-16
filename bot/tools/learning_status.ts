import { defineTool } from "@cursor/bdk/tools";
import { z } from "zod/v3";
import { learningStatus } from "../lib/framework.js";

export default defineTool({
  description:
    "Read progress through the FTSE 350, stance counts, the open revisit queue, and the lesson ledger. Does not start an investigation.",
  effect: "read",
  inputSchema: z.object({
    lessonLimit: z.number().int().min(1).max(30).optional(),
    revisitLimit: z.number().int().min(1).max(30).optional(),
  }),
  async execute(input, ctx) {
    return learningStatus(ctx, {
      lessons: input.lessonLimit ?? 10,
      revisits: input.revisitLimit ?? 10,
    });
  },
});
