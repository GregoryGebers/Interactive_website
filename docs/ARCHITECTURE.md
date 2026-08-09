# Architecture

A multiplayer browser platformer that runs as the interactive background of a
Twitch stream. There are four surfaces plus a shared data layer.

## The four surfaces

| Surface | File | Runtime | Role |
|---|---|---|---|
| **Player client** | `public/viewer.html` | Browser | The actual game a viewer plays. Has a player, a follow camera, local effects and camera shake. |
| **Stream overlay** | `public/overlay.html` | Browser (OBS) | Spectator view composited over the stream. Renders the whole world at once, **never** spawns a player, **never** shakes. |
| **Scene editor** | `tools/editor.html` | Browser (dev tool) | Visual level + shop editor. Read-only against deployed files online; saves drafts to the browser or exports JSON. |
| **Server** | `server.js` → `src/server/` | Node | Authoritative multiplayer state, persistence, pricing, combat, chat filtering, Twitch relay. |

## Data flow

```
        Player Viewer (viewer.html)
              |  ^
     Socket.IO|  | init / player-move / coin / buy_result / ...
              v  |
          ┌─────────────┐        broadcast
          │   server    │ ───────────────────────┐
          │ (src/server)│                         │
          └─────────────┘                         v
              │  ▲                          Other Viewers
   reads      │  │ reads                    OBS Overlay (overlay.html, spectator)
              v  │
      public/scene.json   public/shop.json
              ^                    ^
              │ exports            │ exports
        ┌───────────────────────────────┐
        │   editor.html (dev tool)       │
        │   ├─ browser draft (localStorage)
        │   ├─ scene.json export (download)
        │   ├─ shop.json export (download)
        │   └─ isolated viewer test (?editorTest=…)
        └───────────────────────────────┘
```

The overlay is a **spectator**: it opens a Socket.IO connection purely to watch,
and deliberately never emits `join`, so the server never spawns a character for
it. This is the single most important behavioral invariant of the overlay.

## Source of truth

| Concern | Authoritative owner | Notes |
|---|---|---|
| Level layout (props, hitboxes, coins, spawn, camera) | `public/scene.json` | Authored in the editor; read by viewer/overlay for rendering and by the server for coin spawns. **Camera / zoom-zone config is player-viewer behavior**; the overlay ignores it (it shows the whole world). |
| Shop prices, upgrade tiers, combat tuning | `public/shop.json` | Re-read by the server on every purchase/hit so it stays authoritative even though the client displays it. |
| Coin balance / score | **Server** (`gameState.players[id].score`) | Only the coin handler changes it; movement packets never do. |
| Cosmetic ownership | **Server** (`gameState.playerCosmetics`) | Client can request equip, never assert ownership. |
| Upgrade ownership | **Server** (`gameState.playerUpgrades`) | Kept outside `players` so move sanitization can't erase it. Purchased strictly in tier order. |
| Equipped skin | **Server** | Changed only via `equip_skin`; move packets can't switch it. |
| Multiplayer positions | **Server**, mirrored to clients | Clamped to world bounds in `sanitizeMoveData`. |
| Combat hits / knockback | **Server** | Hit detection + cooldown run server-side against tracked positions. |
| Durable progression | **Signed HttpOnly cookie** | HMAC-signed by the server; the browser cannot forge coins/upgrades. |
| Local particles, animation timers, camera shake, UI visibility | **Client** (presentation only) | Never sent to the server. |

### Intentionally duplicated values

Some constants exist on both the server and the client because the server must
not trust the client. When one changes, the other **must** change too:

- **World bounds** `WORLD_WIDTH=3000`, `WORLD_HEIGHT=500` — server
  (`src/server/config/gameConfig.js`) and client (viewer/overlay). The server
  clamps every position to its own copy.
- **Knockback impulse math** — derived from the client's max jump impulse; the
  server recomputes it in `gameConfig.js` so it owns the authoritative result.

## Directory overview

```
server.js                      Application bootstrap: composes app + sockets, wires lifecycle.
src/server/
  app.js                       createApp() (Express) + createServer() (HTTP+Socket.IO) factories.
  config/
    environment.js             The only place process.env is read.
    hosts.js                   eberhex vs izu_kora host selection (isEberhex).
    paths.js                   Filesystem paths (scene/shop/public/tools).
    gameConfig.js              Server-authoritative gameplay + protocol constants.
  utils/
    crypto.js                  Signed-cookie token sign/verify + cookie read/write.
    validation.js              sanitizeMoveData() for untrusted move packets.
  state/
    gameState.js               The single shared runtime state object.
  services/
    scene.service.js           Coin spawns from scene.json (+ fallback).
    shop.service.js            Shop defaults, normalization, loading, pricing.
    playerState.service.js     Persistent-state shape, normalization, push-to-client.
    profanity.service.js       Server-side chat censoring (+ leetspeak evasion).
    twitchRelay.service.js     StreamElements bot relay queue.
    editorAssets.service.js    Read-only editor image listing.
  routes/
    config.routes.js           / , /config , /health
    editor.routes.js           /editor , /api/editor-assets
    playerState.routes.js      /api/player-state (signed-cookie bridge)
  socket/
    registerSocketHandlers.js  Connection wiring + AFK sweep.
    player.handlers.js         join / disconnect / error
    movement.handlers.js       move
    coin.handlers.js           coin_taken
    shop.handlers.js           buy / equip_skin
    chat.handlers.js           chat
    combat.handlers.js         swing (server-side hit detection)
    effects.handlers.js        player-fx relay

public/
  viewer.html                  Player page (markup + imports).
  overlay.html                 Overlay page (markup + imports).
  css/viewer.css               Player styles.
  js/game/viewer.js            Player client logic.
  js/overlay/overlay.js        Overlay client logic.
  scene.json, shop.json        Deployed level + shop config.
  assets/                      Sprites, effects, tiles.

tools/
  editor.html                  Editor page (markup + imports).
  editor/editor.css            Editor styles.
  editor/editor.js             Editor logic.

scene_editor.py                OWNER-ONLY localhost backend giving the editor
                               /api/scene and /api/shop WRITE endpoints. Not
                               part of the deployed server.

docs/                          This documentation.
test/                          node:test unit tests for pure server logic.
```

## Common development tasks

- **Change player physics** → `public/js/game/viewer.js` (the `update()` loop and
  the jump/dash/gravity constants near it). Movement *validation* is server-side
  in `src/server/utils/validation.js`.
- **Add a Socket.IO event** → add a handler under `src/server/socket/`, register
  it in `registerSocketHandlers.js`, add the client listener/emitter, and
  document it in [`SOCKET_EVENTS.md`](SOCKET_EVENTS.md).
- **Change a price / upgrade tuning** → edit `public/shop.json` (authored via the
  editor's shop panel). Validation/defaults live in `shop.service.js`.
- **Add a cosmetic** → add it to `DEFAULT_COSMETIC_ITEMS` in
  `src/server/services/shop.service.js`, to the client skin catalog in
  `viewer.js`/`overlay.js`, and to `shop.json`. (See "intentionally duplicated
  values" — the server list is authoritative for ownership.)
- **Add an editor tool** → `tools/editor/editor.js`.
- **Change the level** → author in the editor, export `scene.json`, replace
  `public/scene.json`. Camera/zoom zones affect the viewer only.

## Security invariants (must not regress)

- Never trust client score, cosmetic ownership, upgrade ownership, or equipped
  skin — all server-authoritative.
- Combat results (hit detection, cooldown, knockback, stun) are decided server
  side against the server's own player positions.
- The signed player-state cookie is HMAC-verified; `PLAYER_STATE_SECRET` never
  reaches the browser and, if unset, persistence disables itself.
- The public editor exposes **no** scene/shop write route online; only a
  read-only asset listing. Owner writes go through the localhost-only
  `scene_editor.py`.
- Editor **Test Draft** runs `viewer.html?editorTest=…`, which uses a fake
  in-page socket and never connects to the live multiplayer world.
- The overlay is a spectator and must never emit `join`.
