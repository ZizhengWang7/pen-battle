# V2.2 local load measurements

Recorded 2026-11-07T19:05:08.281Z on Apple M3 (darwin/arm64, v22.13.1). These are local measurements, not Render Free capacity claims.

Each scenario ran its own authoritative server process, four independent Socket.IO clients per room, eight three-action cycles, all four shake charges, and one disconnect/reconnect per room. Modes alternate between Classic and Evolution. Each run lasted about 33–34 seconds; this is a short exercise, not a sustained soak test.

## Action acknowledgement latency

| Rooms / players | Actions | p50 ms | p95 ms | p99 ms |
|---|---:|---:|---:|---:|
| 5 / 20 | 120 | 2.60 | 5.68 | 6.92 |
| 10 / 40 | 240 | 2.68 | 8.41 | 181.68 |
| 25 / 100 | 600 | 4.70 | 13.88 | 15.66 |

Latency measures a valid intent sent over loopback until its server acknowledgement, not the duration of the hand/physics animation or Internet round trips.

## Server resources

| Rooms | Mean CPU (% of one core) | Peak sampled CPU | Peak RSS MiB | Event-loop p95 ms | Event-loop max ms |
|---|---:|---:|---:|---:|---:|
| 5 | 7.53% | 40.86% | 69.00 | 12.70 | 23.12 |
| 10 | 9.33% | 40.73% | 68.75 | 12.75 | 194.25 |
| 25 | 13.55% | 77.11% | 79.75 | 13.65 | 61.41 |

The 10-room run had a 181.68 ms p99 acknowledgement and a 194.25 ms maximum event-loop delay. Those tail spikes are retained in the raw data. No errors or synchronization failures were hidden by retrying failed actions.

All three scenarios recorded:

- Zero failed requests/connections and zero unexpected disconnects.
- Zero cross-room frames and zero differing snapshots for a shared sequence.
- Zero game snapshots emitted during the final idle observation.
- Successful room creation, joins, readiness, starts, flicks, shakes, and identity-preserving reconnects.

CPU and RSS are measured in the server child process, excluding client processes. Peak CPU is sampled over roughly 100 ms intervals; event-loop delay uses 10 ms sampling resolution. All clients share one loopback IP, so setup join/create rate limits are raised for the benchmark; gameplay and identity validation remain enabled. Snapshot hashes and bounded per-sequence masks check consistency without retaining an unbounded frame history.

## Reproduce

```sh
npm ci
npm run build
npm run test:load
```

Optional individual scenarios: `npm run test:load -- 5`, `-- 10`, or `-- 25`. The runner creates only loopback listeners and has no remote target parameter. It writes [v2.2-local.json](v2.2-local.json), including the Node/platform details and server-source hash. Room credentials remain in memory and are never written to the report.

The proposed Render Free deployment caps rooms at five and connections at 24. Its smaller CPU allocation, network latency, cold starts and hosting quotas are not represented by this local benchmark. Actual public capacity remains unverified.
