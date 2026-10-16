import { defineEval } from "@cursor/bdk/evals";

export default defineEval({
  tags: ["smoke"],
  description: "One FTSE name is loaded from the pinned fixture and a structured assessment is recorded.",
  async test(t) {
    await t.send(
      "Investigate the next FTSE 350 name. Read the growth-investigation skill, use next_investigation, then record_learning exactly once for that name.",
    );
    t.succeeded();
    t.calledTool("next_investigation", {
      output: (value) => {
        const text = typeof value === "string" ? value : JSON.stringify(value);
        return (
          text.includes("debtToEquityPercent") &&
          !text.includes('"debtToEquity":') &&
          text.includes('"network"')
        );
      },
    });
    t.calledTool("record_learning");
    t.notCalledTool("learning_status");
  },
});
