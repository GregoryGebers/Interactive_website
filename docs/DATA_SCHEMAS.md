# Data file schemas

Both files live in `public/` so the editor, the two clients, and the server all
read the same deployed copy. They are authored in `tools/editor.html` and, for
the owner, written to disk by `scene_editor.py` (localhost only).

---

## `public/scene.json` — the level

```jsonc
{
  "version": 1,
  "world":       { "width": 3000, "height": 500 },   // world bounds in world units
  "playerStart": { "x": 100, "y": 100 },             // where a new player spawns
  "ground": {                                         // repeating ground strip
    "sprite": "/assets/obstacles/grass.png",
    "height": 20,
    "tileWidth": 32
  },
  "camera": {                                         // VIEWER-ONLY (see note)
    "baseZoom": 1.5,
    "zoomZones": [
      { "x": 1260, "y": 160, "width": 1090, "height": 340, "zoom": 2 }
    ]
  },
  "props":    [ { "src": "/assets/…png", "x": 1430, "y": 460, "width": 20, "height": 20 } ],
  "hitboxes": [ { "x": 0, "y": 480, "width": 3000, "height": 20 } ],
  "coins":    [ { "x": 920, "y": 340 } ]
}
```

### Field consumers

| Field | Viewer | Overlay | Server |
|---|---|---|---|
| `world` | render + clamp | render (scales whole world to canvas) | ships its own authoritative `WORLD_WIDTH/HEIGHT` |
| `playerStart` | spawn position | — | — |
| `ground` | draws the repeating strip | draws the repeating strip | — |
| `camera.baseZoom` / `camera.zoomZones` | **yes — follow camera + zoom-in regions** | **no — overlay shows the entire world** | — |
| `props` | drawn as scenery | drawn as scenery | — |
| `hitboxes` | player collision | (visual only) | — |
| `coins` | render pickup | render pickup | **coin spawn points** (`scene.service.js`) |

> **Camera is viewer-only.** `camera` describes how the *player's* follow camera
> behaves. The overlay intentionally renders the whole world scaled to the
> canvas and ignores `camera` entirely — applying zoom zones would make the
> overlay jump around and make names/chat unreadable.

> **Grouping** in the editor (Ctrl+G) is an authoring convenience for moving
> objects together. It is not persisted into `scene.json`; exported items are
> flat `{src?,x,y,width,height}` records.

If `scene.json` is missing/unreadable or has no valid coins, the server falls
back to `FALLBACK_COINS` in `scene.service.js` so the game still runs.

---

## `public/shop.json` — cosmetics, upgrades, combat tuning

```jsonc
{
  "version": 2,
  "cosmetics": {
    "items": {
      "classic":  { "enabled": true,  "cost": 0 },   // classic is always free & owned
      "mob1":     { "enabled": false, "cost": 10 },   // disabled: hidden/unbuyable but kept if owned
      "enemy3":   { "enabled": true,  "cost": 500 }
      // …one entry per known skin id
    }
  },
  "upgrades": {
    "jump":         { "enabled": true, "costs": [5,10,15], "pct": 10 },
    "dash":         { "enabled": true, "costs": [5,10,15], "pct": 10 },
    "knockback":    { "enabled": true, "costs": [5,10,15], "pct": 15,
                      "stunBaseMs": 500, "stunMaxMs": 1500 },
    "health":       { "enabled": true, "costs": [5,10,15] },
    "doubleJump":   { "enabled": true, "costs": [20] },        // single tier
    "invisibility": { "enabled": true, "costs": [10,20,30] }
  }
}
```

### Semantics

- **`enabled`** — a disabled cosmetic is hidden and unbuyable, but players who
  already own it keep ownership (re-enabling restores access); a currently
  disabled equipped skin falls back to `classic`.
- **`cost`** — coin price of a cosmetic. `classic` is forced to `0` no matter
  what the file says.
- **`costs`** — array of per-tier upgrade prices. Length = number of tiers.
  Upgrades must be bought in order (tier *n* requires owning tier *n−1*).
- **`pct`** — additive per-tier percentage. For `jump`/`dash` it scales the
  ability; for `knockback` it scales the knockback impulse (T1=115%… by default).
- **`stunBaseMs` / `stunMaxMs`** — knockback stun duration, scaled linearly from
  base (tier 0) to max (top tier). `stunMaxMs` is clamped to be ≥ `stunBaseMs`.

### Authority + backward compatibility

The server re-reads and **normalizes** `shop.json` on every purchase/hit via
`normalizeShopConfig` (`src/server/services/shop.service.js`), so prices stay
authoritative and any missing/invalid fields fall back to defaults. The
normalizer also accepts the older flat `cosmetics.enabled/cost` shape. If the
file can't be read, `DEFAULT_SHOP_CONFIG` is used.
