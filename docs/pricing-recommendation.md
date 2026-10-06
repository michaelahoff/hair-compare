# Pricing recommendation

Research date: **2026-10-02**. Assumes a US launch, USD prices and standard in-app subscriptions. This is a launch hypothesis, not measured willingness to pay. No billing or paywall implementation is included in this work.

## Proposed launch offer

| Plan | Price | Included |
| --- | --- | --- |
| Free | $0 | Unlimited photos stored on the device, capture/import, automatic/manual alignment, synchronized zoom and comparison, treatment history; no AI. Unlimited means subject to device capacity. |
| Pro monthly | $6.99/month | Everything in Free, all existing AI assessment features, 20 successful photo assessments per subscription month, and private cloud storage up to 1 GB. |
| Pro annual | $39.99/year | The same features and monthly allowance; billed annually, equivalent to about $3.33/month. |

One assessment evaluates one current photo and can include an earlier photo of the same view for comparison. It counts once even though the provider may receive two images. The allowance refreshes monthly on the subscription anniversary, including for annual subscribers; unused assessments do not roll over. Twenty assessments accommodate four sessions covering all five supported views. This is packaging capacity, not a recommended medical monitoring frequency.

Include photo quality feedback, approximate thinning-region indicators, an estimated stage when the view supports it, uncertainty and visible-change interpretation with treatment dates as context. Do not promise reconstructed hair length, clinical diagnosis, quantified regrowth, or proof that a treatment caused improvement. The current implementation does not establish those capabilities.

Free should remain useful without an account. Keep locally saved photos and completed results accessible after cancellation. Provide data export and clearly stated cloud retention before selling storage. Export, cancellation handling and migration between the app's currently separate device/cloud journals still need implementation; the table describes the proposed product, not shipped entitlements or automatic backup/sync.

## Market support

Direct examples in the US App Store include [Follicle](https://apps.apple.com/us/app/follicle-hair-loss-tracker/id6759066308), with explicit $4.99 monthly and $19.99 annual products; [Hairly](https://apps.apple.com/us/app/hairly-hair-health-ai-scanner/id6754949306), with $9.99 monthly and $19.99 annual products; and [HairLoss AI](https://apps.apple.com/us/app/hairloss-ai-beat-balding/id6563141135), with $9.99/$19.99 monthly and $44.99 annual products. Published IAP lists can include legacy and promotional products; these are not verified live paywalls.

[RevenueCat's 2026 report](https://www.revenuecat.com/state-of-subscription-apps) places the Health & Fitness monthly median at $9.99 and annual median around $40. The proposed price sits below that monthly benchmark and close to the annual benchmark. Lower-priced direct competitors mean we should test value and retention before charging $9.99/month. See [the detailed market research](./pricing-market-research.md) for five competitors and source limitations.

## Operating-cost estimate

The current [analysis function](../supabase/functions/analyze-photo/index.ts) uses `claude-sonnet-5-5`, sends one or two images, and caps generated output at 4,096 tokens. Photos are resized to a maximum 1,800 px long edge. No paid production calls or token measurements were performed for this estimate.

[Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing) lists $2 per million input tokens and $10 per million output tokens. [Its vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision) estimates visual tokens as `ceil(width / 28) * ceil(height / 28)`; current high-resolution models accept these photo sizes. Two 1,800 × 1,350 images use about 6,370 visual tokens. Allowing roughly 1,000 additional input tokens gives about 7,400 total input tokens. Two square 1,800 px images plus text are approximately 9,500 input tokens. Text/schema overhead is an assumption and can grow with user notes and treatment history.

[Thinking is billed as output and counts toward the output cap](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost). Use the provider's inclusive usage totals when measuring, rather than the visible report length.

Estimated cost per attempted assessment:

```text
cost = input_tokens * $2 / 1,000,000 + output_tokens * $10 / 1,000,000
example: 7,400 input + 1,500 output = $0.0298
larger-photo/full-output scenario: 9,500 input + 4,096 output = $0.05996
```

Budget **$0.03–$0.06 per call** pending measurement. At 20 completed assessments, the high scenario is $1.20/month; a planning reserve of 20% for unsuccessful paid calls brings it to $1.44. This reserve is an assumption, not a measured failure rate or hard maximum. Enforce input limits and rate limits because unsuccessful attempts can still incur cost.

[Supabase Pro](https://supabase.com/pricing) starts at $25/month for the backend, with 100 GB file storage and 250 GB uncached egress included. Overages are listed at $0.0213/GB-month for storage and $0.09/GB for uncached egress. These are shared plan allowances, not per subscriber. At 100 subscribers the $25 base allocates to $0.25 each; compute upgrades, other projects, email, support and any billing vendor fees are additional.

For standard US store billing, use a **15% fee** planning case. [Apple](https://developer.apple.com/app-store/subscriptions/) gives enrolled Small Business Program developers 85% before applicable taxes; otherwise first-year subscription proceeds are 70%, increasing to 85% after a year. [Google's current US subscription fee](https://support.google.com/googleplay/android-developer/answer/112622?hl=en) totals 15% with Play Billing (10% service fee plus 5% billing fee).

| Per active subscriber-month | Monthly plan | Annual plan, averaged |
| --- | ---: | ---: |
| Revenue after assumed 15% store fee | $5.94 | $2.83 |
| Less 10 calls at $0.03 plus 20% failure reserve | $5.58 | $2.47 |
| Instead, less 20 calls at $0.06 plus 20% failure reserve | $4.50 | $1.39 |

Rows after the first are alternative scenarios, not cumulative deductions. Amounts remaining are **not profit**: subtract shared hosting, storage/egress overages, support, refunds, taxes, development and acquisition. At 100 subscribers, subtract another $0.25 per subscriber for the base backend. With a 30% Apple fee, annual proceeds average $2.33/month, leaving $0.89 after the heavy-use AI scenario and before hosting/other costs. Avoid promising unlimited AI on a cheap annual plan.

## Launch and validation

- Offer one Pro tier with monthly/annual payment options. Avoid weekly subscriptions and lifetime unlimited AI, which create poor packaging for a continuing journal and recurring costs.
- Demonstrate a sample AI report without spending money on every free user. A capped subscription trial can be tested later; the ongoing free tier remains AI-free.
- Start at $6.99/month and $39.99/year. Test $7.99/month and $49.99/year once quality is demonstrated, with the same allowance, rather than assume higher prices improve revenue.
- Measure successful and failed calls, inclusive token usage, photo bytes, usage distribution, paid conversion, refunds, contribution per install and 60–90-day paid retention. Annual renewal needs a longer observation period; acquisition economics cannot be inferred from API cost alone.
- Before monetization, implement server-verified purchases, entitlement updates for renewals/cancellations/refunds, atomic monthly quota reservation, idempotency and attempt rate limits. The current function authenticates users but does not check subscriptions or quotas. The free tier must be enforced on the server, not just by hiding a button.

