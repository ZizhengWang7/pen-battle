# Pen Battle V2.1

Classic and Evolution Arena, local or real server-authoritative online play. Requires **Node 22.13+**. No account, paid service, cloud resource, or external database is required. This repository has been tested locally; it is **not deployed on the public internet**.

## Run client and server

Production-style local run (one server serves both the built SPA and Socket.IO):

```sh
npm ci
cp .env.example .env
npm run build
npm run server
```

Open `http://localhost:3001`. The build checks and builds both frontend and server. Environment variables are loaded from `.env` by the Node entrypoint; run commands from this repository's root.

Development, in two terminals:

```sh
npm run server:dev
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/socket.io` and `/health` to port 3001. `server:dev` watches server/shared source and restarts the compiled Node server. `VITE_SERVER_URL` is optional and normally empty; set it before building only when the frontend and server use different origins.

## Test with four browsers or devices

1. Choose **在线游戏**, enter a nickname, and create a room. The creator is host.
2. Copy `/room/CODE` to three friends. The six-character code is prefilled. Enter distinct nicknames and join.
3. The host selects Classic or Evolution; changing the mode clears readiness. All four connected players must click **准备**, then the host starts.
4. Each device controls only its own pen. Drag backward from any point on the pen and release, or use **握笔震桌** once per game instead of a flick.
5. Refresh a page: the room URL plus the locally stored private credential reclaims the same slot. Another window reclaiming that identity disconnects the previous controller.
6. At match completion, everyone readies again and the host starts the rematch. Local mode retains its immediate restart button.

Use four devices, different browsers, or isolated browser profiles. Ordinary tabs sharing one profile also share its saved identity and deliberately cannot control the same player simultaneously. Nicknames are 1–20 Unicode letters/numbers, spaces, `.`, `_`, or `-`; duplicate names are rejected case-insensitively.

For LAN devices, bind `HOST=0.0.0.0`, allow the port in your firewall, and add the exact LAN frontend origin to `FRONTEND_ORIGINS`, for example `http://192.168.1.50:3001` (or `:5173` in development). Friends must use that computer's LAN address, not `localhost`. Device storage must be enabled to survive refresh. Use HTTPS/WSS outside a trusted local test network.

## V2.1 physics measurements

All tests below use the same physical impulse `J=3000`, two seconds at fixed 60 Hz with adaptive substeps. Travel uses a centered impulse; rotation uses an offset of 35 units. These are reproducible simulation measurements, not guarantees about every collision or flick.

| Class | Mass | Centered travel | Off-center angular displacement (rad) |
|---|---:|---:|---:|
| Wooden pencil | 3.4 | 231.54 | 1.739 |
| Mechanical pencil | 4.4 | 193.87 | 4.161 |
| Ballpoint | 5.4425 | 149.21 | 7.498 |
| Highlighter | **6.8** | **136.09** (was 66.57) | **4.889** (was 3.950) |
| Fountain pen | **8.8** | **92.63** (was 42.57) | **3.443** (was 1.081) |

The highlighter grows from 104×26 to **114×34** units with a chunky cap/barrel silhouette. The fountain shrinks from 137×22 to **114×16**, retaining its gold nib, clip and metal finish. Render and collision outlines remain shared and rotate around the weighted center of mass.

| Parameter | Highlighter | Fountain |
|---|---:|---:|
| Contact friction | .32 | .25 |
| Kinetic sliding decrement / base step | .038 | .040 |
| Linear drag / second | 2.30 | 2.45 |
| Angular drag / second | 2.20 | 2.80 |
| Speed-dependent angular drag coefficient | 5 | 6 |
| Uniform-core mass fraction | .94 | .80 |
| Restitution | .10 | .10 |

`src/game/pens.ts` holds all balancing parameters, core/end mass distributions, outlines and inertia calculations. The ballpoint remains the strongest rotational class under the standardized conditions. No scripted spin multiplier is used. Impulses use `Δv=J/m` and `Δω=cross(r,J)/I`, converted to Matter's base-step velocity convention. The power curve is unchanged: normalized drag raised to 1.35, maximum impulse 6000. Normal falling retains the 1.5-unit COM edge tolerance and 400 ms animation. Collision substeps account for translation and rotating-tip speed, bounded at 128.

## Evolution scoring and self-elimination

Everyone starts with a wooden pencil. A seeded shuffle selects the remaining four classes once; all players share that route. Evolution also randomizes turn order; Classic retains blue/red/green/yellow order.

One action resolves atomically:

1. Collect unique eliminated player IDs, including indirect collisions and shake falls.
2. Award the actor one point and one stage per opponent elimination. Self-elimination awards no point.
3. Cap the earned stage at four (displayed as 5/5).
4. If the actor's own pen fell, subtract **one stage**, floored at zero. This applies to both flicks and shakes, once per action. Historical score never decreases. A pen eliminated by somebody else's action is not penalized.
5. Determine the final class from the seeded progression, then check the five-point victory condition. A winning self-eliminating player can finish with a downgraded class.
6. If the match continues, upgrade/relocate and respawn before another turn.

Score and stage are separate. Multiple kills all count; scores cap at five. Restart clears scores, stages, charges and outstanding actions. Classic never applies a downgrade or respawns.

Evolution respawns preserve score, final stage/class and remaining shake charge. An ordered deterministic grid/orientation search checks exact polygon collisions and keeps the entire outline inside the inner safe rectangle plus a two-unit margin. New bodies start at rest. A blocked respawn retries every 250 ms and blocks turn advancement. A larger upgrade that would overlap uses the same safe relocation path without awarding another elimination.

## Shared engine and online protocol

- `MatchEngine.ts`: headless authoritative physics, phases, falling, scoring, upgrading, respawns and animation timing. Both local play and the Node server instantiate **this same engine**.
- `PenBattle.ts`: local browser pointer handling and animation clock around that engine.
- `renderer.ts`: pure scene drawing for local and online play.
- `rules.ts`, `physics.ts`, `pens.ts`, `spawn.ts`: shared rules, physical mechanics, balance and placement.
- `src/shared/protocol.ts`: serializable room, intent and authoritative scene types.
- `server/service.ts`: isolated rooms, authenticated membership, validation, deadlines and fixed-step scheduling.
- `src/online/`: Socket.IO UI, pointer intents, read-only snapshot interpolation and synchronized rendering. **Online clients do not advance an independent Matter.js gameplay engine.**

The server owns all positions, velocities, phases, scores, charges, classes, respawns and winners. Clients submit only contact/direction/power/action ID or a shake intent, scoped to a match and turn. Every intent checks socket membership, room, match ID, turn, phase, contact on the owned pen, finite normalized power/direction, charge and duplicate action ID. Client scores/positions/outcomes are not accepted.

The server steps at 60 Hz and broadcasts at about 20 Hz plus immediate impact and phase-change snapshots. Packets include match ID, sequence, simulation tick, timestamp, pen poses/velocities/types, falling state, action animation timing, score/stage, upgrade and respawn notices. Online rendering interpolates about 100 ms behind server time, avoids interpolating through respawns, and presents the exact contact snapshot once. Interpolation never changes authoritative logic. The server never waits for individual clients' animations.

Phases: `waiting`, `aiming`, `hand_animation`, `physics`, `falling`, `scoring`, `upgrading`, `respawning`, `next_turn`, `finished`. One action has a deduplicated victim list; attribution never carries into the next turn.

## Hand, shake and identity

The hand uses a lightweight articulated bone model with tapered continuous skin envelopes, nail/crease layers, thumb release and power-dependent curl/speed/follow-through. It is stylized top-down Canvas artwork, **not photorealistic**.

Shake grips the acting player's pen, lifts its temporary rendered representation and strikes at 180 ms. No duplicate physical body is created. At impact, every surviving COM strictly outside the inner 90% safe rectangle falls, including the actor; equality is safe. The camera then vibrates for 360 ms without moving world coordinates. Physics, falling, scoring and respawns complete before the next turn.

Room codes use cryptographic randomness and a clear six-character alphabet, with uniqueness checked against active/expired rooms. Each player receives a separate 32-byte private random reconnect credential. The server stores its hash and never includes it in shared room views, snapshots or URLs. The browser stores its own credential locally. Reclaiming a slot disconnects its prior socket; nicknames/codes do not authenticate existing players.

Payloads are size-limited and validated, creation/join/resume and actions have basic rate limits, and configured origin checks apply to WebSocket handshakes as well as polling CORS. Unknown clients cannot subscribe to room broadcasts. Room simulation errors are isolated rather than terminating other matches.

## Disconnect and abandonment policy

A missing player blocks new actions. An in-flight action finishes; the room pauses at the next aiming boundary. A player can resume within `RECONNECT_GRACE_MS` (default 60 seconds), keeping their slot and state. On timeout, the match is cancelled without awarding artificial points; remaining players return to the lobby unready, missing slots are freed and a connected player becomes host when necessary. They can fill seats and start again. Finished rooms also return to a fillable lobby if a missing player expires.

Rooms with no connected players expire after `ROOM_TTL_MS` of inactivity (default 10 minutes), with an explicit expired-room response retained briefly. Server restart loses in-memory rooms and credentials; clients must create/join a new room. No persistent-room promise is made.

## Verification

```sh
npm test                 # unit/regression + real network integration
npm run test:unit
npm run test:online      # opens a temporary loopback listener
npm run build            # frontend + typed Node server builds
```

The integration suite starts a real server and connects independent Socket.IO clients, running two independent four-player rooms. It covers creation/capacity/names, private reconnect/takeover, unauthorized and duplicate actions, authoritative hand/strike impacts, cross-client snapshots, scoring/downgrades/respawns, five-kill completion, rematch, pause/reconnect, grace abandonment, expiry, origins and rate limits. Scenario placement is arranged directly inside the test's server instance; **no remote test mutation endpoint exists**.

Browser testing uses isolated Chrome contexts at 375 px, real pointer events, room links and refresh. Physical mobile-device performance and extended balance still require playtesting.

## Production deployment

Run `npm ci`, `npm run build`, then `npm run server` in one long-running Node 22.13+ process with this repository as working directory. Both `dist/` and `dist-server/` and production Node dependencies are required. Use a process supervisor for restarts. `/health` returns a minimal health response. Do not serve the source tree or `.env` publicly.

Configure `FRONTEND_ORIGINS=https://pens.example.com` and place the server behind an HTTPS reverse proxy. Socket.IO automatically uses WSS when the page is HTTPS. A typical Nginx configuration includes:

```nginx
# In the http context:
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

server {
    listen 443 ssl;
    server_name pens.example.com;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 75s;
    }
}
```

Hosting must support persistent Node processes and WebSocket upgrades/polling; request-only serverless functions and static hosting alone are insufficient. A free/self-hosted machine can run this implementation. No cloud resources were created and no public endpoint was deployed.

Current online rooms are single-process, in-memory and nonpersistent. Multiple workers would require coordinated authoritative simulation plus shared room/identity storage; a broadcast adapter alone is insufficient. Basic rate limits are not a replacement for production ingress monitoring. Adaptive substeps are not true continuous collision detection at extreme injected speeds. A completely blocked respawn intentionally remains pending until space becomes available or a match is restarted.
