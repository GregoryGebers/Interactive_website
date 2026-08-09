# Twitch Overlay Game

A multiplayer browser platformer that runs as the interactive background of a
Twitch stream. Viewers play a little slime character over the streamer's video;
an OBS overlay composites everyone onto the broadcast; a visual editor authors
the level and shop.

## Components

- **Player client** — `public/viewer.html`. The game a viewer plays (movement,
  jump/double-jump/dash/invisibility, combat, coins, shop, chat).
- **Stream overlay** — `public/overlay.html`. A spectator view for OBS that
  shows the whole world. Never spawns a player, never shakes the camera.
- **Scene editor** — `tools/editor.html` (served at `/editor`). Build levels and
  configure the shop; export `scene.json` / `shop.json` or test drafts safely.
- **Server** — `server.js` + `src/server/`. Authoritative multiplayer state,
  signed-cookie persistence, pricing, combat, chat filtering, Twitch relay.

## Prerequisites

- **Node.js 18+** (uses built-in `fetch` and `node:test`; developed on Node 24).

## Install

```bash
npm install
```

`leo-profanity` is an optional dependency — chat filtering falls back to a small
built-in word list if it is not installed.

## Run

```bash
npm start        # production: node server.js
npm run dev      # same, for local development
```

Then open:

- `http://localhost:3000/` — the player client
- `http://localhost:3000/overlay.html` — the OBS overlay
- `http://localhost:3000/editor` — the scene editor

## Test

```bash
npm test         # node --test — unit tests for pure server logic
```

Covers shop normalization/pricing, movement sanitization, persistent-state
normalization, signed-cookie crypto, and profanity filtering.

## Environment variables

All server config is read in `src/server/config/environment.js`. **Never commit
secrets.**

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default `3000`). |
| `NODE_ENV` | `production` enables the `Secure` cookie flag. |
| `PLAYER_STATE_SECRET` | HMAC secret for the signed player-state cookie. **≥ 32 chars.** If unset, persistence is disabled (progression won't survive refresh). |
| `isEberhex` | `"true"` selects the `eberhex` host; anything else selects `izu_kora`. Switches Twitch channel + StreamElements bot together. |
| `SE_JWT_TOKEN_EBERHEX` / `SE_CHANNEL_ID_EBERHEX` | StreamElements bot creds for eberhex. |
| `SE_JWT_TOKEN_IZU` / `SE_CHANNEL_ID_IZU` | StreamElements bot creds for izu_kora. |

## Configuration files

- `public/scene.json` — the level (world, spawn, ground, props, hitboxes, coins,
  camera). See [`docs/DATA_SCHEMAS.md`](docs/DATA_SCHEMAS.md).
- `public/shop.json` — cosmetics, upgrade tiers, combat tuning. Same doc.

Author both in the editor. Online the editor is **read-only** against these
files; it saves browser drafts or exports JSON you copy into `public/`.

## How each surface works

### Viewer
Loads `/config` (which Twitch channel to embed), `scene.json`, and `shop.json`,
connects via Socket.IO, and only becomes a player after you enter a name and
press GO (which emits `join`). Physics, rendering, effects and camera are all
client-side; positions/score/ownership are validated and owned by the server.

### Overlay
Connects as a **spectator** — it never emits `join`, so no ghost player appears.
It renders the entire world scaled to the canvas (no follow camera, no shake)
and draws names/chat in screen space so text stays readable.

### Editor
- **Save draft** stores the scene in your browser (`localStorage`).
- **Export** downloads `scene.json` / `shop.json`.
- **Test Draft** opens `viewer.html?editorTest=…`, an isolated single-player
  session backed by a fake in-page socket — it never touches the live game.
- Owner-only disk writes: run `python scene_editor.py` (binds `127.0.0.1`),
  which adds the local `/api/scene` and `/api/shop` write endpoints the editor
  uses on `localhost`.

### Testing multiplayer locally
Open `/` in two browser windows, join with different names, and open
`/overlay.html` in a third — the overlay should show both players and never add a
third "spectator" character.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system map, data flow, source
  of truth, directory overview, security invariants.
- [`docs/SOCKET_EVENTS.md`](docs/SOCKET_EVENTS.md) — the full Socket.IO protocol.
- [`docs/DATA_SCHEMAS.md`](docs/DATA_SCHEMAS.md) — `scene.json` / `shop.json`.

## Deploy notes

Designed for Render's free tier. `/health` is a lightweight probe for an uptime
monitor to keep the instance warm (free instances sleep after ~15 min idle).
Socket.IO connection-state recovery lets brief drops rejoin without a visible
reconnect.
