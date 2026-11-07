# Render deployment

The owner approved the Free configuration, and the service is now publicly reachable at **https://pen-battle.onrender.com**. HTTPS, secure WebSockets, and small four-player functional games have been verified. The table below records the approved repository configuration; private Render account settings and logs have not been inspected.

| Setting | Approved repository value |
|---|---|
| Repository | https://github.com/ZizhengWang7/pen-battle |
| Branch | `main` |
| Service name | `pen-battle` |
| Type / runtime | One Web Service / Node |
| Plan / region | **Free** / Oregon |
| Instances | **1**; no autoscaling |
| Node version | `22.22.0`, pinned in `.node-version` |
| Build | `npm ci && npm run build` |
| Start | `npm run server` |
| Health check | `/health` |
| Automatic deploy | On commits to `main` |
| `NODE_ENV` | `production` |
| `NPM_CONFIG_INCLUDE` | `dev` (build tools and TypeScript types are needed during build) |
| `HOST` | `0.0.0.0` |
| `MAX_ACTIVE_ROOMS` | `5` |
| `MAX_CONNECTIONS` | `24` |
| `ROOM_TTL_MS` | `600000` |
| `RECONNECT_GRACE_MS` | `60000` |
| `PORT` / `RENDER_EXTERNAL_URL` | Supplied by Render |
| Extra infrastructure | None: no database, Redis, disk, domain purchase, or paid instance |

The frontend uses its own origin. The backend derives its exact allowed production origin from `RENDER_EXTERNAL_URL`; it does not trust request `Host`/forwarding headers or use wildcard CORS. Additional custom frontend origins can be listed in `FRONTEND_ORIGINS`. Do not set `VITE_SERVER_URL` for this single-origin deployment.

Render terminates HTTPS and forwards HTTP/WebSocket traffic to the same Node port. See its [Web Service](https://render.com/docs/web-services), [WebSocket](https://render.com/docs/websocket), [Node version](https://render.com/docs/node-version), and [Blueprint](https://render.com/docs/blueprint-spec) documentation.

## Existing service and redeploys

Use the existing `pen-battle` service; do not create a duplicate. The repository's `render.yaml` requests automatic deployments from `main`. No paid resource or domain was created by this verification work.

Public service: https://pen-battle.onrender.com. Health endpoint: https://pen-battle.onrender.com/health.

A small static marker at `/releases/v2.2-production-check.json` accompanies the production documentation update. It was absent before the push. Checking that its exact committed contents appear on the live origin, followed by a healthy homepage and `/health`, verifies that the new source has rolled out without relying on an old healthy instance. It contains no credential or private server data.

The Render integration remains unauthorized in this environment. Build/runtime dashboard logs, billing settings and exact live environment values therefore remain uninspected. The public rollout check is separate from those control-plane checks.

## Verify after deployment

Run the small functional browser smoke check against the actual HTTPS origin, not a local substitute:

```sh
SMOKE_URL="$VERIFIED_RENDER_URL" npm run test:browser
```

Set `VERIFIED_RENDER_URL=https://pen-battle.onrender.com` before running that command. Verify `/health`, assets, room-link refresh, secure WebSocket transport, four-player actions, both modes, scoring, upgrades, respawns, a consistent winner, invalid-action rejection and rematches. Record evidence in [live-verification.md](live-verification.md). The root README now links to the verified service. Record any later verification against its actual deployed revision.

Do not run the load suite against production. It deliberately starts its own loopback server and cannot target an arbitrary URL.

## Free-plan and persistence limits

Render's [Free plan documentation](https://render.com/docs/free) describes idle spin-down, cold starts, workspace usage quotas and possible restarts. Free compute is currently listed as 0.1 CPU / 512 MB in the [Blueprint reference](https://render.com/docs/blueprint-spec). Local 100-client measurements on a developer machine are not a capacity promise for that instance.

Rooms are intentionally in memory. Redeploying, sleeping or restarting can discard all games and reconnect credentials. Clients receive a shutdown message, reconnect with backoff, and get a clear missing/expired identity error if their old room is gone. Multiple production instances are unsupported.
