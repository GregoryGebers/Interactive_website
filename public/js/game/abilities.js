    // ---- Purchasable gameplay upgrades (reset every session; not persisted) --
    // Tier 0..3 for the tiered ones; doubleJump is a one-off unlock. The
    // server authorizes all purchases; knockback tier is ALSO tracked there
    // because hit force must not be client-trust based.
    const upgrades = { jump: 0, dash: 0, knockback: 0, health: 0, invisibility: 0, doubleJump: false };

    const DEFAULT_COSMETIC_ITEMS = {
      classic:  { enabled: true, cost: 0 },
      mob1:     { enabled: true, cost: 10 }, mob2:     { enabled: true, cost: 10 }, mob3:     { enabled: true, cost: 10 },
      monster1: { enabled: true, cost: 10 }, monster2: { enabled: true, cost: 10 }, monster3: { enabled: true, cost: 10 },
      enemy1:   { enabled: true, cost: 10 }, enemy2:   { enabled: true, cost: 10 }, enemy3:   { enabled: true, cost: 10 },
    };
    const DEFAULT_SHOP_CONFIG = {
      version: 2,
      cosmetics: { items: DEFAULT_COSMETIC_ITEMS },
      upgrades: {
        jump:         { enabled: true, costs: [5, 10, 15], pct: 10 },
        dash:         { enabled: true, costs: [5, 10, 15], pct: 10 },
        knockback:    { enabled: true, costs: [5, 10, 15], pct: 15, stunBaseMs: 500, stunMaxMs: 1500 },
        health:       { enabled: true, costs: [5, 10, 15] },
        doubleJump:   { enabled: true, costs: [20] },
        invisibility: { enabled: true, costs: [10, 20, 30] },
      },
    };
    let shopConfig = JSON.parse(JSON.stringify(DEFAULT_SHOP_CONFIG));

    function upgradePct(cat, fallback) {
      const def = shopConfig.upgrades && shopConfig.upgrades[cat];
      const n = Number(def && def.pct);
      return Number.isFinite(n) ? Math.max(0, n) : fallback;
    }
    function upgradeEnabled(cat) {
      const def = shopConfig.upgrades && shopConfig.upgrades[cat];
      return !!def && def.enabled !== false;
    }
    function jumpVelocity() {
      const tiers = upgradeEnabled('jump') ? upgrades.jump : 0;
      return JUMP_BASE + tiers * JUMP_REF * (upgradePct('jump', 10) / 100);
    }
    function dashSpeed() {
      const tiers = upgradeEnabled('dash') ? upgrades.dash : 0;
      return DASH_BASE + tiers * DASH_REF * (upgradePct('dash', 10) / 100);
    }

    // Hidden health stat (base 3, +1 per tier up to 6). Not shown anywhere yet;
    // wired for a future damage/combat pass.
    player.maxHealth = 3;
    player.health = 3;

    // ---- Invisibility (press Control) ----
    // Duration grows with the tier (2s / 3.5s / 5s). You can't move while
    // invisible — any movement breaks it early. Half-transparent to yourself,
    // fully hidden to others (via the network `invisible` flag + draw code).
    const INVIS_DURS = [2, 3.5, 5];  // seconds per tier
    const INVIS_COOLDOWN = 3;        // seconds before you can vanish again
    let invisTimer = 0, invisCooldown = 0;
    player.invisible = false;

    function tryInvisible() {
      if (!upgrades.invisibility || player.invisible || invisCooldown > 0) return;
      player.invisible = true;
      invisTimer = INVIS_DURS[upgrades.invisibility - 1] || 2;
      triggerInvisibilityFx('vanish');   // shimmer at the vanish
      emitMoveNow();             // tell everyone else to hide us right away
    }
    function endInvisible() {
      if (!player.invisible) return;
      player.invisible = false;
      invisCooldown = INVIS_COOLDOWN;
      triggerInvisibilityFx('appear');   // shimmer at the re-appear too
      emitMoveNow();
    }

    // Local player animation is driven by the duck state machine in duck.js
    // (setClip / tickPlayerAnim / updatePlayerClip). The old setPose() pose
    // switch is gone.
