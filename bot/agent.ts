import { defineAgent } from "@cursor/bdk";

export default defineAgent({
  name: "FTSE Growth Explorer",
  description:
    "Walks FTSE 350 constituents one at a time, records a growth assessment for each, and applies lessons to names not yet seen and names already assessed.",
  model: {
    id: "grok-4.5",
    params: [
      { id: "effort", value: "high" },
      { id: "fast", value: "true" },
    ],
  },
  hosting: {
    egressDomains: ["raw.githubusercontent.com"],
  },
});
