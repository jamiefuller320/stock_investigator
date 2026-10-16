---
description: Assess one FTSE 350 name for growth potential, record the ecosystem and supply contracts, and reuse lessons and prime-contractor trajectories on later names.
---

# Growth investigation

Use the company card from `next_investigation`. Do not invent figures, filings, or news that are not on the card. If a figure is missing, say it is unknown.

## What you are deciding

Whether this name's growth could support a profitable investment over the stated horizon. Profit here means the growth and the price together look capable of a positive return after the risks, not that a trade should be placed.

Stance:

- `research_buy` — growth case is strong enough to deserve deeper work toward an investment
- `watch` — a real growth path, but price, quality, or evidence is not there yet
- `pass` — no distinguishable growth edge
- `avoid` — growth looks value-destructive or the evidence contradicts the growth story

Conviction is 1 (thin) to 5 (the card supports the stance tightly). A value-screen `strong_buy` does not set the stance.

For `vehicle: investment_vehicle`, growth means NAV compounding, costs, and discount or premium, not operating revenue.

## How to use lessons

`lessonsToApply` is mandatory context. Account for every id in `requiredLessonIds` by passing them in `lessonsApplied`. Accounting for a lesson includes rejecting it, but you must say why in the thesis or free notes.

On a revisit, compare with `priorAssessment`. Say whether stance or conviction moved, and why.

## Ecosystem and supply contracts

For an operating company, name the ecosystem it sells into. If `network.knownEcosystems` already has that ecosystem, use the same label.

Record `supplies_to` when the company holds supply contracts for a customer or prime contractor. The prime's trajectory is the demand proxy for how those contracts may grow. Prefer a counterparty that is already on the ledger.

- If `network.direct` names a prime and `trajectory.source` is `ledger_assessment`, use that stance and revenue view. Do not rebuild the prime's growth story or invent figures for it.
- If the prime is outside the FTSE 350 extract, omit `counterpartyTicker` and, when you can, store a qualitative `counterpartyTrajectory` and `trajectoryNote`. Do not invent contract values, durations, or financials.
- If this investigation is of the prime, record suppliers with `subjectTicker` set to the supplier and the prime as the counterparty. Those suppliers inherit the prime's trajectory when their turn comes.
- `relationshipsAcknowledged` must include every id in `network.requiredRelationshipIds`.
- `provenance` is `prior_investigation` when the link was already in the packet, `company_card` only when the card text names it, otherwise `general_knowledge`.
- A name with no material supply relationship still gets an `ecosystem` when you know one. Investment vehicles usually have neither.

Peers in `network.peers` are names already filed in the same ecosystem. Extend that map. Do not redraw it.

## Free thinking

Reason freely in `freeNotes`. A claim that should change how another name is judged must also be a lesson or a relationship. Notes alone are not reused.

## Lessons

Record a lesson only when the evidence would travel.

- `matching` — set `appliesWhen`. Sectors, vehicles, and signals are OR within a field and AND across fields. Traits are OR unless `traitMatch` is `all` (every listed trait must be present). Copy sector names from the card or from `sectors`.
- `all_names` — method lessons that should be reconsidered on every name. Do not also set filters.
- `this_name_only` — a finding that must stay on this constituent.

Effects: `upgrade_growth`, `downgrade_growth`, `raise_risk`, `lower_conviction`, `recheck_valuation`, `method`.

Start at `confidence: tentative`. When a later name shows the same pattern, raise it with `confidenceUpdates` to `supported`, then `repeated`. Confidence does not move backward.

Trait ids:

- Valuation and returns: `low_pe`, `high_pe`, `high_yield`, `low_yield`, `high_roe`, `low_roe`, `lynch` is not a trait (use the PEG on the card)
- Balance sheet and cash: `high_leverage`, `low_leverage`, `fcf_positive`, `fcf_negative`, `fcf_cover_below_1`, `fcf_cover_comfortable`
- Trajectory: `earnings_growing`, `earnings_shrinking`, `below_sma200`, `above_sma200`, `cyclical`
- Evidence: `high_data_quality`, `thin_data`, `piotroski_strong`, `piotroski_weak`
- Kind: `operating_company`, `investment_vehicle`
- Value-screen families passed: `family_cheapness`, `family_quality`, `family_garp`, `family_risk`, `family_dividend`

`earningsGrowthPercent`, `dividendYieldPercent`, `priceVsSma200Percent`, and `debtToEquityPercent` are already in percent. A `debtToEquityPercent` of 2.4 means 2.4% debt to equity, not 2.4 times. `fcfDividendCoverageNet` is a ratio (1.0 means covered once). Cash flow figures are currency units from the screen, not millions unless the card says so.

## Expected return

Write a qualitative band with a horizon and a condition. Example: "low-single-digit annualised over 4 years if statutory free cash flow stays below the dividend". Do not quote a target price and do not say the return will happen.

## Recording

Call `record_learning` once. If it returns `lessons_not_applied` or `unknown_trait`, correct the input and call it again. Do not change the thesis just to get past the error.
