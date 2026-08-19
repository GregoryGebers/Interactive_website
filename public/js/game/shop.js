    // ---- Shop UI (opens on P) ----------------------------------------------
    // The shop is driven by a CATALOG of sections so new item groups (and, later,
    // whole separate shops) slot in without touching the render/buy plumbing.
    // Each section has a `kind`: 'cosmetic' (skins) or 'upgrade' (tiered/single).
    let shopOpen = false;
    const shopOverlay = document.getElementById('shopOverlay');
    const shopGridEl = document.getElementById('shopGrid');
    const shopCoinsEl = document.getElementById('shopCoins');
    const shopMsgEl = document.getElementById('shopMsg');
    document.getElementById('shopClose').addEventListener('click', closeShop);

    // Upgrade definitions are rebuilt from public/shop.json. This same file is
    // used by the server for authoritative prices/combat and by the level editor.
    let UPGRADE_DEFS = [];
    let UPGRADE_TITLE = {};

    function normalizeClientShopConfig(raw) {
      const out = JSON.parse(JSON.stringify(DEFAULT_SHOP_CONFIG));
      const src = raw && typeof raw === 'object' ? raw : {};
      const srcUp = src.upgrades && typeof src.upgrades === 'object' ? src.upgrades : {};
      const srcCos = src.cosmetics && typeof src.cosmetics === 'object' ? src.cosmetics : {};
      const srcItems = srcCos.items && typeof srcCos.items === 'object' ? srcCos.items : null;
      for (const [id, fallback] of Object.entries(DEFAULT_COSMETIC_ITEMS)) {
        const target = out.cosmetics.items[id];
        const incoming = srcItems && srcItems[id] && typeof srcItems[id] === 'object' ? srcItems[id] : null;
        if (incoming) {
          target.enabled = incoming.enabled !== false;
          const c = Number(incoming.cost);
          if (Number.isFinite(c)) target.cost = id === 'classic' ? 0 : Math.max(0, Math.round(c));
        } else if (id !== 'classic' && (Object.prototype.hasOwnProperty.call(srcCos, 'enabled') || Object.prototype.hasOwnProperty.call(srcCos, 'cost'))) {
          target.enabled = srcCos.enabled !== false;
          const c = Number(srcCos.cost);
          if (Number.isFinite(c)) target.cost = Math.max(0, Math.round(c));
        }
      }
      for (const [key, fallback] of Object.entries(DEFAULT_SHOP_CONFIG.upgrades)) {
        const incoming = srcUp[key] && typeof srcUp[key] === 'object' ? srcUp[key] : {};
        const target = out.upgrades[key];
        target.enabled = incoming.enabled !== false;
        if (Array.isArray(incoming.costs) && incoming.costs.length) {
          const costs = incoming.costs.map(Number).filter(Number.isFinite).map(n => Math.max(0, Math.round(n)));
          if (costs.length) target.costs = costs;
        }
        if (Object.prototype.hasOwnProperty.call(fallback, 'pct')) {
          const pct = Number(incoming.pct);
          if (Number.isFinite(pct)) target.pct = Math.max(0, pct);
        }
      }
      const kb = srcUp.knockback && typeof srcUp.knockback === 'object' ? srcUp.knockback : {};
      const baseMs = Number(kb.stunBaseMs), maxMs = Number(kb.stunMaxMs);
      if (Number.isFinite(baseMs)) out.upgrades.knockback.stunBaseMs = Math.max(0, Math.round(baseMs));
      if (Number.isFinite(maxMs)) out.upgrades.knockback.stunMaxMs = Math.max(out.upgrades.knockback.stunBaseMs, Math.round(maxMs));
      return out;
    }

    function rebuildUpgradeDefs() {
      const up = shopConfig.upgrades;
      const defs = [
        { cat: 'jump',         title: 'Higher Jump',      icon: '⤒', costs: [...up.jump.costs],         blurb: `+${up.jump.pct}% / level`, enabled: up.jump.enabled },
        { cat: 'dash',         title: 'Stronger Dash',    icon: '»', costs: [...up.dash.costs],         blurb: `+${up.dash.pct}% / level`, enabled: up.dash.enabled },
        { cat: 'knockback',    title: 'Stronger Weapon',  icon: '⚔', costs: [...up.knockback.costs],    blurb: `+${up.knockback.pct}% / level`, enabled: up.knockback.enabled },
        { cat: 'health',       title: 'More Health',      icon: '♥', costs: [...up.health.costs],       blurb: '+1 heart / level', enabled: up.health.enabled },
        { cat: 'doubleJump',   title: 'Double Jump',      icon: '⇈', single: true, cost: up.doubleJump.costs[0] || 0, blurb: 'Jump again mid-air', enabled: up.doubleJump.enabled },
        { cat: 'invisibility', title: 'Invisibility',     icon: '◌', costs: [...up.invisibility.costs], blurb: 'Vanish · Ctrl', enabled: up.invisibility.enabled },
      ];
      UPGRADE_DEFS = defs.filter(d => d.enabled !== false);
      UPGRADE_TITLE = Object.fromEntries(defs.map(d => [d.cat, d.title]));
    }

    async function loadShopConfig() {
      try {
        if (IS_EDITOR_TEST && EDITOR_TEST_PAYLOAD.shop && typeof EDITOR_TEST_PAYLOAD.shop === 'object') {
          shopConfig = normalizeClientShopConfig(EDITOR_TEST_PAYLOAD.shop);
        } else {
          const res = await fetch('/shop.json', { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          shopConfig = normalizeClientShopConfig(await res.json());
        }
      } catch (e) {
        console.warn('Could not load shop.json — using defaults:', e);
        shopConfig = normalizeClientShopConfig(DEFAULT_SHOP_CONFIG);
      }
      for (const [id, skin] of Object.entries(SKINS)) {
        const cfg = shopConfig.cosmetics.items[id] || DEFAULT_COSMETIC_ITEMS[id] || { enabled: false, cost: 0 };
        skin.enabled = cfg.enabled !== false;
        skin.cost = id === 'classic' ? 0 : Math.max(0, Math.round(Number(cfg.cost) || 0));
      }
      // If a designer disables an equipped skin, request Classic from the
      // server. Ownership is preserved server-side and becomes usable again
      // if the cosmetic is re-enabled later.
      if (equippedSkin !== 'classic' && SKINS[equippedSkin] && SKINS[equippedSkin].enabled === false) {
        socket.emit('equip_skin', { skinId: 'classic' });
      }
      rebuildUpgradeDefs();
      if (shopOpen) renderShop();
    }
    rebuildUpgradeDefs();
    loadShopConfig();

    // The whole catalog, in display order. Splitting into multiple shops later
    // is just a matter of filtering this array by section id.
    const SHOP_CATALOG = [
      { id: 'skins', title: 'SLIME SKINS', kind: 'cosmetic' },
      { id: 'upgrades', title: 'UPGRADES', kind: 'upgrade' },
    ];

    function setShopMsg(t) { shopMsgEl.textContent = t || ''; }

    // Slot key ('skin:<id>' / 'up:<cat>') to flash lime on the next render.
    let shopFlashKey = null;

    // ---- Slot rendering ------------------------------------------------------
    // Every entry in the shop is the SAME object: one flat slot holding an icon,
    // a name, a level track, a one-line blurb and a footer. The footer is either
    // a price + action (still buyable) or a stamp (MAXED / OWNED / EQUIPPED) —
    // never a disabled button, so an item you already have reads as finished
    // rather than broken.

    // Level track: ● ● ○ . An empty track keeps single-purchase and cosmetic
    // slots the exact same height as tiered ones.
    function pipsHTML(cur, max) {
      if (!max) return `<div class="pips"></div>`;
      let out = '';
      for (let i = 0; i < max; i++) out += `<i class="${i < cur ? 'on' : ''}"></i>`;
      return `<div class="pips">${out}</div>`;
    }

    function stampHTML(text, muted) {
      return `<span class="stamp${muted ? ' stamp-mute' : ''}">${text}</span>`;
    }

    // Price + BUY. Below the player's balance it stays visible but inert, so
    // the cost is still readable — the slot is dimmed by `is-locked` instead.
    function priceHTML(cost, attrs, afford) {
      return `<span class="coin-price${afford ? '' : ' is-poor'}"><i class="coin"></i>${cost}</span>
        <button class="slot-action" ${attrs} ${afford ? '' : 'disabled'}>BUY</button>`;
    }

    function slotHTML(key, cls, icon, name, pips, desc, foot) {
      return `<div class="slot ${cls}" data-key="${key}">
        ${icon}
        <div class="slot-name">${name}</div>
        ${pips}
        <div class="slot-desc">${desc}</div>
        <div class="slot-foot">${foot}</div>
      </div>`;
    }

    function skinCardHTML(id, s) {
      const owned = ownedSkins.has(id);
      const equipped = equippedSkin === id;
      const afford = player.score >= s.cost;
      let cls, foot;
      if (equipped) { cls = 'is-owned is-equipped'; foot = stampHTML('EQUIPPED'); }
      else if (owned) { cls = 'is-owned is-available'; foot = `<button class="slot-action equip" data-equip="${id}">EQUIP</button>`; }
      else { cls = afford ? 'is-available' : 'is-locked'; foot = priceHTML(s.cost, `data-buy="${id}"`, afford); }
      const icon = `<div class="slot-icon slot-preview" style="background-image:url('${s.idle}')"></div>`;
      return slotHTML('skin:' + id, cls, icon, s.name, pipsHTML(0, 0), 'Skin', foot);
    }

    function upgradeCardHTML(def) {
      const icon = `<div class="slot-icon">${def.icon}</div>`;
      const key = 'up:' + def.cat;

      if (def.single) {
        const owned = upgrades.doubleJump;
        const afford = player.score >= def.cost;
        const cls = owned ? 'is-owned' : afford ? 'is-available' : 'is-locked';
        const foot = owned ? stampHTML('OWNED') : priceHTML(def.cost, `data-buyup="${def.cat}" data-tier="1"`, afford);
        return slotHTML(key, cls, icon, def.title, pipsHTML(owned ? 1 : 0, 1), def.blurb, foot);
      }

      const cur = upgrades[def.cat] || 0;
      const max = def.costs.length;
      if (cur >= max) {
        return slotHTML(key, 'is-owned', icon, def.title, pipsHTML(cur, max), def.blurb, stampHTML('MAXED'));
      }
      const cost = def.costs[cur];
      const afford = player.score >= cost;
      const cls = afford ? 'is-available' : 'is-locked';
      const foot = priceHTML(cost, `data-buyup="${def.cat}" data-tier="${cur + 1}"`, afford);
      return slotHTML(key, cls, icon, def.title, pipsHTML(cur, max), def.blurb, foot);
    }

    function renderShop() {
      if (!shopGridEl) return;
      shopCoinsEl.textContent = player.score;
      shopGridEl.innerHTML = SHOP_CATALOG.map(section => {
        let cards;
        if (section.kind === 'cosmetic') {
          cards = Object.entries(SKINS)
            .filter(([id, skin]) => id === 'classic' ? skin.enabled !== false : skin.enabled !== false)
            .map(([id, skin]) => skinCardHTML(id, skin)).join('');
        } else cards = UPGRADE_DEFS.map(upgradeCardHTML).join('');
        if (!cards) return '';
        return `<div class="shop-section">${section.title}</div><div class="shop-grid-inner">${cards}</div>`;
      }).join('');
      shopGridEl.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => { shopFlashKey = 'skin:' + b.dataset.equip; equipSkin(b.dataset.equip); }));
      shopGridEl.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => buySkin(b.dataset.buy)));
      shopGridEl.querySelectorAll('[data-buyup]').forEach(b => b.addEventListener('click', () => buyUpgrade(b.dataset.buyup, Number(b.dataset.tier))));

      // One quick lime flash on whatever just changed, then the key is spent —
      // re-renders for unrelated reasons must not replay it.
      if (shopFlashKey) {
        const el = shopGridEl.querySelector(`.slot[data-key="${shopFlashKey}"]`);
        if (el) el.classList.add('just-changed');
        shopFlashKey = null;
      }
    }

    function buySkin(id) {
      const s = SKINS[id];
      if (!s || s.enabled === false || ownedSkins.has(id) || id === 'classic') return;
      if (player.score < s.cost) { setShopMsg('Not enough coins — collect more!'); return; }
      pendingBuy = { type: 'skin', id };
      setShopMsg('Buying ' + s.name + '…');
      socket.emit('buy', { item: 'skin', skinId: id }); // server validates this exact skin + price
    }

    function buyUpgrade(cat, tier) {
      const def = UPGRADE_DEFS.find(d => d.cat === cat);
      if (!def) return;
      if (def.single) {
        if (upgrades.doubleJump) return;
        if (player.score < def.cost) { setShopMsg('Not enough coins — collect more!'); return; }
      } else {
        const cur = upgrades[cat] || 0;
        if (tier !== cur + 1 || cur >= def.costs.length) return; // must buy the next tier up
        if (player.score < def.costs[cur]) { setShopMsg('Not enough coins — collect more!'); return; }
      }
      pendingBuy = { type: 'upgrade', cat, tier };
      setShopMsg('Buying ' + def.title + '…');
      socket.emit('buy', { item: cat, tier });
    }

    function applyUpgrade(cat, tier) {
      if (cat === 'doubleJump') upgrades.doubleJump = true;
      else upgrades[cat] = tier;
      if (cat === 'health') { player.maxHealth = 3 + upgrades.health; player.health = player.maxHealth; }
    }

    // Server replies with the authoritative new balance + whether it went
    // through. Only then do we unlock/equip the skin or apply the upgrade.
    socket.on('buy_result', (data) => {
      if (!data) return;
      if (typeof data.score === 'number') player.score = data.score;

      if (data.ok && pendingBuy) {
        if (pendingBuy.type === 'skin') {
          const bought = SKINS[pendingBuy.id];
          setShopMsg((bought ? bought.name : 'Skin') + ' unlocked & equipped!');
          shopFlashKey = 'skin:' + pendingBuy.id;
        } else {
          setShopMsg((UPGRADE_TITLE[pendingBuy.cat] || 'Upgrade') + ' purchased!');
          shopFlashKey = 'up:' + pendingBuy.cat;
        }
        // The server follows this with `player_state`, which is the only place
        // that actually updates ownership and upgrade tiers.
      } else if (!data.ok) {
        if (data.reason === 'poor') setShopMsg('Not enough coins.');
        else if (data.reason === 'owned') setShopMsg('You already own that cosmetic.');
        else setShopMsg('Cannot buy that right now.');
      }
      pendingBuy = null;
      renderShop();
    });

    function openShop() {
      if (shopOpen || !hasJoined) return;
      shopOpen = true;
      inputLeft = inputRight = jumpHeld = shiftHeld = false; // stop held movement
      isDashing = false;
      if (chatOpen) closeChat();
      setShopMsg('');
      renderShop();
      shopOverlay.style.display = 'flex';
    }
    function closeShop() {
      shopOpen = false;
      shopOverlay.style.display = 'none';
      canvas.focus();
    }
    function toggleShop() { shopOpen ? closeShop() : openShop(); }

    // Start a dash if one is available. Direction follows current input, or the
    // way you're facing if no direction is held. Refreshes on landing, so you
    // get one air-dash per jump.
    function tryDash() {
      if (isDashing || dashCooldownTimer > 0 || !canDash) return;
      dashDir = inputRight ? 1 : inputLeft ? -1 : player.facing;
      if (!dashDir) dashDir = 1;
      player.facing = dashDir;
      isDashing = true;
      dashTimer = DASH_DURATION;
      dashCooldownTimer = DASH_COOLDOWN;
      canDash = false;
      player.Yv = 0;
      player.Xv = dashDir * dashSpeed();
      triggerDashFx();
    }
