# FTSE Growth Explorer

A research agent that walks FTSE 350 constituents and builds a growth assessment for each name, with a view to finding investments that can be profitable. It is an experiment of its own. Market and fundamental figures are read from the public [value_investor](https://github.com/jamiefuller320/value_investor) screen (`docs/data/latest.json`). Nothing is written back to that repo.

This is not personal financial advice and it does not place trades. A `research_buy` stance means the growth case is worth deeper work, not that an order should be sent.

## How a run works

1. `next_investigation` loads the FTSE 350 extract (operating companies plus investment vehicles) and returns one name.
2. The agent judges growth potential from that card, from lessons already on the ledger, and from any supply network already mapped.
3. `record_learning` stores a structured assessment, the operating ecosystem, and supply relationships. A `supplies_to` link means the company holds contracts for that customer or prime. The prime's trajectory is kept as the proxy for how those contracts may grow.
4. A lesson, or a change in a prime's trajectory, is queued against constituents already assessed. A later name that sits in the same ecosystem arrives with those links and trajectories already filled in, so the overlapping part of the work is not repeated.

Progress is alphabetical by ticker. The weekday schedule (`bot/schedules/weekday-investigation.ts`, 08:17 UTC, Monday to Friday) investigates one name. Schedules do not fire under local `--dev`.

## Ledger

Shared across sessions, in the host key-value store:

| Record | What it holds |
| --- | --- |
| Assessment | Stance, conviction, growth thesis, drivers, risks, what would change the view, and free notes |
| Lesson | Statement, effect, confidence (`tentative` → `supported` → `repeated`), and where it applies |
| Revisit | An already-assessed name that a newer lesson or a changed prime-contractor trajectory now affects |
| Relationship | Who supplies whom, in which ecosystem, and the prime's trajectory when the prime is outside the extract |

Matching lessons combine sectors, vehicles, and value-screen signals (any value inside a field, all fields must hit). Traits match if any listed trait is present, or every trait when `traitMatch` is `all`.

## Run locally

```bash
npm install
npm run check
npx @cursor/bdk validate --dir .
npx @cursor/bdk dev
```

Playground: `http://127.0.0.1:3000/playground`. A model turn needs a Cursor credential (`CURSOR_API_KEY`, then a key file, then `npx @cursor/bdk login`).

Ask it to investigate the next name, to check `learning_status`, or to reopen a ticker. The universe cache refreshes every 24 hours. Ask for a refresh when you want the latest value_investor file immediately.

## Defaults chosen for this experiment

- Playground and HTTP, plus a weekday schedule. No Slack or GitHub channel.
- Model `grok-4.5` with high effort.
- One name per scheduled run, up to three when you ask in conversation.
- Eval sessions and `GROWTH_EXPLORER_FIXTURE=1` use a pinned three-name fixture so tests do not depend on the live file. That fixture ledger is stored separately from the live walk.
