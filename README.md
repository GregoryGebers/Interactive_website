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
| `PLAYER_STATE_SECRET` | HMAC secret for the signed player-state cookie (guest persistence). **≥ 32 chars.** If unset, guest persistence is disabled (progression won't survive refresh). |
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxxx.supabase.co`). Enables accounts + DB-backed progression. |
| `SUPABASE_ANON_KEY` | Supabase **anon** (public) key. Sent to the browser via `/config` for Supabase Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase **service-role** key. Server-only — reads/writes player rows and bypasses RLS. **Never expose to the browser.** If this or `SUPABASE_URL` is unset, accounts are disabled and the game uses the guest/cookie flow. |
| `isEberhex` | `"true"` selects the `eberhex` host; anything else selects `izu_kora`. Switches Twitch channel + StreamElements bot together. |
| `SE_JWT_TOKEN_EBERHEX` / `SE_CHANNEL_ID_EBERHEX` | StreamElements bot creds for eberhex. |
| `SE_JWT_TOKEN_IZU` / `SE_CHANNEL_ID_IZU` | StreamElements bot creds for izu_kora. |

## Accounts & saved progress (Supabase)

Players can optionally **sign in** with a **username + password** (no email) to
save coins, cosmetics and upgrades to their account so progress follows them
across devices. The name color is chosen at sign-up and reused on every login.
Not signing in still works — that's a **guest** session persisted in a signed
HttpOnly cookie in the current browser (the original behavior).

Supabase Auth is email-based under the hood, so each username is mapped to a
stable synthetic email (`<username>@slime.game`) and the display name + color
live in the account's user metadata. Because those emails are synthetic, **email
confirmation must be turned OFF** (see step 4).

The server stays **authoritative**: the browser never writes coins/upgrades to
the database. It only authenticates with Supabase and passes its access token on
the socket handshake; the server verifies the token (service-role key) and is
the only writer to the `player_state` table. Row Level Security lets a signed-in
player *read* only their own row and blocks all direct client writes.

**One-time setup:**

1. Create a Supabase project (already done — it just has no tables yet).
2. In the Supabase Dashboard → **SQL Editor**, paste and run
   [`db/supabase_schema.sql`](db/supabase_schema.sql). This creates the
   `player_state` table, its RLS policies, and the `updated_at` trigger.
3. In **Project Settings → API**, copy the **Project URL**, **anon** key, and
   **service_role** key into the three `SUPABASE_*` environment variables (see
   the table above; `.env.example` has a template). On Render, add them as
   environment variables.
4. **Required:** In **Authentication → Providers → Email**, turn *"Confirm
   email"* **OFF**. Usernames map to synthetic emails that can't receive a
   confirmation link, so with confirmation on, new accounts can never sign in.

If the `SUPABASE_*` vars are absent, the login panel hides itself and the game
runs exactly as before on the guest/cookie path.

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
