# A five-day forward deployment, the way I run one

*How I would run an on-site n8n engagement: arrive with a hypothesis, leave with production
workflows the customer owns. Based on how I already deliver client work, adapted to a time box.*

## Before arriving (remote, 2 to 3 hours)

- One call with the Deployment Strategist and the customer sponsor: which outcome would make this
  week a success story, and who signs it off.
- Written hypothesis, one paragraph: *"Ticket triage costs 3 FTE. We can auto-route 60% of tickets
  with an AI classifier plus their CRM, with a human queue for the rest."*
- Access checklist sent ahead: instance (Cloud or self-hosted, version, queue mode?), SSO, the 3 to 5
  systems we will touch, sandbox vs production credentials, who can approve a firewall change.
  Missing access is the most common way a week gets lost.

## Day 1: Map, then cut

- Shadow the people doing the work for two hours. Write the real process, not the documented one.
- Pick **one** workflow to take to production and up to two to prototype. Agree the cut with the
  sponsor in writing.
- By end of day: credentials working for every system, a skeleton workflow running end to end on
  test data.

## Day 2 to 3: Build to production standard

- Build in the customer's instance, in their project, with their credentials. Nothing lives on my
  laptop.
- Production checklist on every workflow: error workflow wired, retries on flaky APIs, idempotency
  on writes, pinned test data, sub-workflows for anything reused, no secrets in Code nodes.
- Daily 15-minute demo to the people who will own it. They should be able to explain it by day 4.
- Log every gap as it happens: missing node operation, auth pattern we had to hand-roll, a UI step
  that confused the customer. One line each, with how long the workaround took.

## Day 4: Harden and hand over

- Run on real data with a human checking outputs. Measure the agreed metric.
- Handover session: the owner changes one thing themselves while I watch.
- Runbook in their wiki: what it does, how it fails, who to call, how to switch it off.

## Day 5: Close the loop

- Go live, or a dated go-live plan with a named owner if a dependency is outside our control.
- Sponsor read-out: metric before and after, what is next, what should *not* be built.
- Internal write-up for n8n, sorted into three buckets:

| Bucket | Example | Goes to |
|---|---|---|
| One-off workaround | Customer-specific field mapping | Stays in their workflow |
| Reusable pattern | "AI triage with human fallback" | Playbook library, with a template |
| Product gap | Missing Gemini cache support | Product, with evidence and a reference fix ([example](PRODUCT_FEEDBACK.md)) |

## Rules I hold myself to

- Ship one thing in production rather than three demos.
- If the customer cannot own it after I leave, it is not done.
- Say no to scope that turns a five-day deployment into open-ended services. Write it down as
  a follow-up instead.
