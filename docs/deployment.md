# Proposed Render deployment

No service has been created. The owner explicitly requires approval before cloud creation.

| Setting | Proposed value |
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

## Approval and authorization

1. Approve the exact Free-service configuration above.
2. Authorize the Render integration, or sign in at the Render Dashboard and grant access to this existing GitHub repository.
3. Review `render.yaml` using **New → Blueprint** with branch `main`. Confirm the proposed service is Free and uses one instance before applying it. Alternatively, create one Web Service with the identical settings.
4. If Render asks for a paid plan, payment, or additional resource, stop. Check workspace billing/spending controls: Free services can still have bandwidth/build quotas. Do not enable paid upgrades or overages for this release.
5. Once created, inspect build/runtime logs and share the actual service URL so the live checks can run. No secret token needs to be pasted into chat.

The Render integration is discoverable but was not connected during preparation. GitHub publication does not itself create a Render service.

## Verify after deployment

Run the small functional browser smoke check against the actual HTTPS origin, not a local substitute:

```sh
SMOKE_URL="$VERIFIED_RENDER_URL" npm run test:browser
```

Set `VERIFIED_RENDER_URL` to the allocated HTTPS origin before running that command; no public origin has been allocated yet. Verify `/health`, assets, room-link refresh, secure WebSocket transport, four-player actions, both modes, scoring, upgrades, respawns, a consistent winner, invalid-action rejection and rematches. Record evidence in [live-verification.md](live-verification.md). Only then add the real **Live Demo** link to the root README and push the documentation update.

Do not run the load suite against production. It deliberately starts its own loopback server and cannot target an arbitrary URL.

## Free-plan and persistence limits

Render's [Free plan documentation](https://render.com/docs/free) describes idle spin-down, cold starts, workspace usage quotas and possible restarts. Free compute is currently listed as 0.1 CPU / 512 MB in the [Blueprint reference](https://render.com/docs/blueprint-spec). Local 100-client measurements on a developer machine are not a capacity promise for that instance.

Rooms are intentionally in memory. Redeploying, sleeping or restarting can discard all games and reconnect credentials. Clients receive a shutdown message, reconnect with backoff, and get a clear missing/expired identity error if their old room is gone. Multiple production instances are unsupported.
