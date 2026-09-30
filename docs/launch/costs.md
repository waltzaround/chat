# Measuring Chat hosting costs

No real-community usage measurement is available yet. Do not publish a made-up monthly bill or describe “free for most communities” as an observed result.

## Sources

Check the current [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/), [Queues](https://developers.cloudflare.com/queues/platform/pricing/) and [RealtimeKit](https://developers.cloudflare.com/realtime/realtimekit/pricing/) allowances and rates when publishing numbers. Different services meter different operations, and some limits are daily.

## First measurement

Use a consenting pilot community and identify its resources separately from other workloads. Record a full week of actual usage:

- Daily active members and messages sent.
- Worker requests and CPU time.
- Durable Object requests, duration and storage.
- D1 rows read/written and storage.
- R2 storage and operations.
- Queue operations and any other enabled paid services.
- RealtimeKit participant-minutes by media type, separately from text chat.

Compare resource-level metrics with the billing dashboard. State whether account allowances are shared with other applications. Report the observation window and observed cost first. If extrapolating to a month, label that figure as an estimate and explain the assumptions, including storage growth and existing account usage.

A publishable result should read: “Over [dates], [active members] sent [messages] and stored [files]. These resources recorded [usage]. Observed charges were [amount]; voice/video accounted for [amount].” Fill this only from measured data.
