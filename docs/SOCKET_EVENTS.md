# Socket.IO protocol

All realtime traffic flows over one Socket.IO connection per browser tab.
Server handlers live in `src/server/socket/*.handlers.js`. Unless noted, the
server **ignores client-supplied authoritative fields** (score, ownership,
absolute effect positions) and substitutes its own.

Legend — Direction: `C→S` client→server, `S→C` server→client,
`C→S→C` client emits, server relays to others.

---

## Connection lifecycle

### `init`  · S→C
On every connection the server sends the current `players` map. A socket does
**not** become a player just by connecting.
Payload: `{ [socketId]: playerSnapshot }`.

### `coin`  · S→C
Current coin spawn position (single shared coin). Sent on connect and after each
respawn. Payload: `{ x, y }` (or `null` briefly while respawning).

### `join`  · C→S
Player opts in to being a character. **The overlay never sends this.**
Payload: `{ username, color }`. Server validates/trims both, loads the signed
save, spawns the player at `(100,100)`, then broadcasts `new-player` and pushes
`player_state` + `persist_state` to the joiner.

### `new-player`  · S→C (broadcast, excludes sender)
A player joined. Payload: `{ id, x, y, emote, score, username, color, skin }`.

### `remove-player`  · S→C (broadcast)
A player left (disconnect grace elapsed) or was AFK-swept. Payload: `socketId`.
Both viewer and overlay clear the character on this one event.

### `afk-removed`  · S→C (to the removed socket only)
The player's own screen should show the rejoin prompt. No payload.

---

## Movement

### `move`  · C→S
Position + animation frame. **Rate-limited** to 1 per `MIN_MOVE_INTERVAL_MS`
(15 ms). Validated by `sanitizeMoveData`: position clamped to world bounds; skin
and score are **kept from server state**, never taken from the packet. Only a
real position change (> `AFK_MOVE_EPSILON`) counts as activity.
Payload: `{ x, y, frameCount, frameIndex, frameRow, username, color, emote, skin, invisible }`.

### `player-move`  · S→C
Broadcast of one player's sanitized snapshot to everyone else (and to everyone,
including the sender, when triggered by a coin/buy/equip so scores update
immediately). Payload: `{ id, ...playerSnapshot }`.

---

## Coins

### `coin_taken`  · C→S
Claim the current coin. Only a joined player may. Server increments **its own**
score counter, clears the coin, broadcasts `coin_taken` + `coin-fx`, emits an
updated `player-move`, persists state, and respawns a coin after 3 s.

### `coin_taken`  · S→C (broadcast, excludes taker)
Tells other clients to remove the coin.

### `coin-fx`  · S→C (broadcast, excludes taker)
World-space pickup pop for everyone else (incl. overlay). Position is the
**server's** authoritative pickup location. Payload: `{ id, x, y }`.

---

## Shop

### `buy`  · C→S
Payload: `{ item, tier?, skinId? }`. Score is the currency and is server-owned:
the client says *which* item, never the price. Server looks up `priceOf`, checks
affordability, enforces **sequential** upgrade tiers, deducts, and replies.

### `buy_result`  · S→C (to buyer)
`{ ok, score, item, tier, skinId, reason? }` where `reason ∈ {invalid, poor, owned}`.
On success the new authoritative `score` is included and a `player-move` +
`persist_state` follow.

### `equip_skin`  · C→S
`{ skinId }`. Server verifies ownership and that the skin is enabled.

### `equip_result`  · S→C (to requester)
`{ ok, skinId, reason? }`. On success broadcasts `player-move` and persists.

---

## Persistence

### `player_state`  · S→C (to the player)
Live authoritative progression for the client to display.
`{ coins, cosmetics, equippedSkin, upgrades }`. Sent even when cookie
persistence is disabled.

### `persist_state`  · S→C (to the player)
A signed, one-time snapshot token. `{ token, rev }`. The client POSTs it to
`/api/player-state` (HTTP) so the server can set the HttpOnly cookie — Socket.IO
cannot change cookies after the handshake. Only sent when persistence is enabled.

---

## Chat

### `chat`  · C→S
`{ message, toTwitch? }`. Rate-limited to 1/s. Server strips control chars,
caps length, **profanity-censors server-side**, then broadcasts the clean text.
If `toTwitch` is true, the same censored line is relayed to the host's Twitch
chat via the StreamElements bot (queued to respect Twitch's rate cap).

### `chat`  · S→C (broadcast, **includes** sender)
`{ id, message }` — the censored text, so the sender's own bubble matches the
room. Both viewer (bubbles) and overlay render this.

---

## Combat

### `swing`  · C→S
`{ dir }` (±1). **Cooldown and hit detection are server-side.** Server checks a
circle in front of the swinger against tracked player positions; the client's
own 2 s cooldown is only UX.

### `player-swing`  · S→C (broadcast, excludes swinger)
Play the swing animation on that character. `{ id, dir }`.

### `player-hit`  · S→C (broadcast to everyone)
A server-confirmed hit. `{ attackerId, targetId, dir, tier, maxTier }`. Viewers
and overlay show the flash/particles; **camera shake is created only inside each
viewer**, so the overlay never shakes.

### `knockback`  · S→C (to the target only)
`{ vx, vy, stunMs, tier, maxTier, dir, attackerId }`. The impulse magnitude and
stun are computed server-side from the attacker's knockback tier and `shop.json`.

---

## Shared visual effects

### `player-fx`  · C→S→C
`{ type, dir?, speed?, phase? }` where `type ∈ {jump, double-jump, dash, land, invisibility}`.
The sender already rendered the effect locally; the server relays it so other
viewers and the overlay reproduce it. **Rate-limited per effect type.** The
server ignores client x/y and anchors the effect to its own authoritative
player position. Broadcast excludes the sender.

---

## Rate limits (server-enforced)

| Event | Limit |
|---|---|
| `move` | 1 per 15 ms per socket |
| `chat` | 1 per 1000 ms per socket |
| `swing` | 1 per ~1900 ms per socket (2000 ms − 100 ms tolerance) |
| `player-fx` | per-type: jump 60 ms, others 80 ms |
| Twitch relay | 1 per 1600 ms globally (one bot account) |
