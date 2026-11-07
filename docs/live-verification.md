# Production verification — V2.2

Public game: **https://pen-battle.onrender.com**

Health: **https://pen-battle.onrender.com/health**

Verified on 2026-11-07 UTC against game source commit `75d9857e0051fc4475cf5859735341caa7a40e7b`. The owner deployed the existing Render service. These checks used the actual public HTTPS origin; no production load benchmark was run.

## Public browser checks

Four isolated Chrome browser contexts at 375 px each joined the same live room. Trusted mouse events exercised flicking. The check also opened local Classic and Evolution modes from the publicly served frontend. A timer-backed presentation clock was used for the macOS headless display-link limitation; the server and network ran in real time.

| Check | Result |
|---|---|
| Homepage | HTTP 200 over valid TLS |
| `/health` | HTTP 200, `{"ok":true}` |
| Plain HTTP | Redirects to HTTPS with HTTP 301 |
| Production assets | Loaded; no captured asset errors |
| Browser errors | No captured window errors in the four-player check |
| 375 px layout | No horizontal overflow |
| Room creation, code and invitation route | Passed |
| Four independent players join and ready | Passed |
| Host removal and rejoin | Passed |
| Public WSS | Successful WebSocket upgrade observed for all four browsers |
| Flick and Table Shake | Synchronized turn progression across all four clients |
| Refresh/reconnect | Same player slot restored; pause cleared |
| Cross-client visible state | Agreed across all four browsers |
| Local Classic and Evolution on the public frontend | Both rendered; Classic flick advanced the turn |

## Small live protocol games

Separate independent Socket.IO clients used actual secure WebSocket connections and legal action intents. No test endpoint, remote physics mutation, fabricated score or forced elimination was used. Two functional rooms were active, with actions run sequentially rather than as a load scenario.

- A Classic match verified flick impact, one-use shake, reconnect, ordinary self-fall eliminations, an agreed winner, and a rematch resetting players and charges.
- Wrong-turn, duplicate-action and forged-score intents were rejected.
- A cross-room intent was rejected, and the rooms retained separate match identities.
- Hashes of shared authoritative snapshot sequences agreed across clients; no inconsistent snapshots were observed.
- An initial 18-turn Evolution sequence verified credited scores and respawns. Maximum-power shots also eliminated the actor, so these turns did not demonstrate a retained upgrade. This is not counted as an upgrade pass.
- A separate five-action Evolution follow-up used a controlled flick to earn a point and retain an upgrade. After three gentle turn-advancing flicks, a deliberate self-fall lowered the upgraded actor's stage **1 → 0**, preserved their historical score **1 → 1**, and respawned the downgraded pen. All clients agreed.

The protocol games completed between `2026-11-07T19:45:51Z` and `2026-11-07T19:48:47Z`. Test clients left and disconnected afterward. Reconnect credentials were kept only in temporary browser profiles or process memory and were not written into this repository.

## Documentation rollout

The README update adds the verified public URL. It also includes `public/releases/v2.2-production-check.json`, copied by Vite into the deployed static files. The live marker returned **404 before the documentation push**. After pushing, its exact contents and the public health/homepage are checked to verify a new rollout; an already healthy old deployment is not sufficient evidence.

The after-push rollout result is reported separately because it can only be observed after this commit exists on GitHub. No manual redeploy is triggered by the verification tool.

## Not exercised or unavailable

- Evolution's five-credited-kill finale was **not exercised live** in these bounded games. Its unit/integration coverage is not substituted for a public pass.
- Physical phones and WeChat were not tested; 375 px browser emulation is not a physical-device test.
- Private Render build/runtime logs, exact live environment settings, and billing/plan details were not accessible through an authenticated integration. The approved configuration is recorded in `render.yaml`; public verification does not independently audit those settings.
- No claim is made about production capacity. The 20/40/100-player benchmarks were local only.
- Free-service cold starts and loss of in-memory rooms on restart/redeploy remain operational limitations.
