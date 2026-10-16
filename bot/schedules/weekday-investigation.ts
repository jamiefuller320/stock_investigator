import { defineSchedule } from "@cursor/bdk/schedules";

export default defineSchedule({
  // Weekdays 08:17 UTC. One name per fire so the ledger grows steadily.
  cron: "17 8 * * 1-5",
  markdown: `Run exactly one FTSE 350 growth investigation.

1. Read the growth-investigation skill.
2. Call next_investigation with no ticker.
3. If the queue is finished, say so and stop. Do not invent a name.
4. Otherwise assess that name and call record_learning once.
5. Reply with the structured memo from your instructions.

Do not investigate a second name in this run.`,
});
