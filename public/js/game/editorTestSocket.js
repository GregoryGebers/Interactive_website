    // ---- Public editor test mode --------------------------------------------
    // /editor.html writes a one-off scene/shop snapshot to localStorage and
    // opens /viewer.html?editorTest=<token>. Merely having that query parameter
    // is enough to force isolation: even if the snapshot is missing/corrupt we
    // NEVER fall through and connect that test tab to the live multiplayer.
    const EDITOR_TEST_TOKEN = new URLSearchParams(window.location.search).get('editorTest');
    const IS_EDITOR_TEST = !!EDITOR_TEST_TOKEN;
    const EDITOR_TEST_SNAPSHOT_PREFIX = 'eberhex.sceneBuilder.test.';
    let EDITOR_TEST_PAYLOAD = {};
    if (IS_EDITOR_TEST) {
      try {
        const raw = localStorage.getItem(EDITOR_TEST_SNAPSHOT_PREFIX + EDITOR_TEST_TOKEN);
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object') EDITOR_TEST_PAYLOAD = parsed;
      } catch (e) {
        console.warn('Could not read editor test snapshot; staying isolated with fallback data.', e);
      }
    }

    function createEditorTestSocket(testPayload) {
      const handlers = new Map();
      const localState = {
        coins: 0,
        cosmetics: new Set(['classic']),
        equippedSkin: 'classic',
        upgrades: { jump: 0, dash: 0, knockback: 0, health: 0, invisibility: 0, doubleJump: 0 },
        scene: testPayload && testPayload.scene && typeof testPayload.scene === 'object' ? testPayload.scene : {},
        shop: testPayload && testPayload.shop && typeof testPayload.shop === 'object' ? testPayload.shop : {},
      };
      let coinTimer = null;

      const dispatch = (event, data) => {
        const list = handlers.get(event);
        if (!list) return;
        for (const fn of [...list]) {
          try { fn(data); } catch (e) { console.error('[editor-test socket]', event, e); }
        }
      };
      const publicState = () => ({
        coins: localState.coins,
        cosmetics: [...localState.cosmetics],
        equippedSkin: localState.equippedSkin,
        upgrades: { ...localState.upgrades },
      });
      const pushState = () => dispatch('player_state', publicState());
      const coinSpawns = () => Array.isArray(localState.scene.coins)
        ? localState.scene.coins.filter(c => c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)))
        : [];
      const pushRandomCoin = (delay = 0) => {
        if (coinTimer) clearTimeout(coinTimer);
        coinTimer = setTimeout(() => {
          const list = coinSpawns();
          if (!list.length) { dispatch('coin', null); return; }
          const c = list[Math.floor(Math.random() * list.length)];
          dispatch('coin', { x: Number(c.x), y: Number(c.y) });
        }, delay);
      };
      const cosmeticConfig = id => localState.shop && localState.shop.cosmetics &&
        localState.shop.cosmetics.items && localState.shop.cosmetics.items[id];
      const upgradeConfig = key => localState.shop && localState.shop.upgrades && localState.shop.upgrades[key];

      const api = {
        id: 'editor-test-local',
        connected: true,
        io: { on() {} },
        on(event, fn) {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event).push(fn);
          return api;
        },
        emit(event, data = {}) {
          if (event === 'join') {
            pushState();
            pushRandomCoin(0);
            return api;
          }
          if (event === 'coin_taken') {
            localState.coins += 1;
            dispatch('coin_taken');
            pushState();
            pushRandomCoin(350);
            return api;
          }
          if (event === 'chat') {
            const message = typeof data.message === 'string' ? data.message.slice(0, 100) : '';
            if (message) dispatch('chat', { id: api.id, message });
            return api;
          }
          if (event === 'equip_skin') {
            const id = typeof data.skinId === 'string' ? data.skinId : '';
            const cfg = cosmeticConfig(id);
            const allowed = id === 'classic' || (localState.cosmetics.has(id) && cfg && cfg.enabled !== false);
            if (allowed) localState.equippedSkin = id;
            dispatch('equip_result', { ok: allowed, skinId: id });
            if (allowed) pushState();
            return api;
          }
          if (event === 'buy') {
            const item = String(data.item || '');
            let ok = false, reason = 'invalid';

            if (item === 'skin') {
              const id = typeof data.skinId === 'string' ? data.skinId : '';
              const cfg = cosmeticConfig(id);
              const cost = Math.max(0, Math.round(Number(cfg && cfg.cost) || 0));
              if (!cfg || cfg.enabled === false || id === 'classic') reason = 'invalid';
              else if (localState.cosmetics.has(id)) reason = 'owned';
              else if (localState.coins < cost) reason = 'poor';
              else {
                localState.coins -= cost;
                localState.cosmetics.add(id);
                localState.equippedSkin = id;
                ok = true;
              }
            } else {
              const cfg = upgradeConfig(item);
              const costs = cfg && Array.isArray(cfg.costs) ? cfg.costs : [];
              const tier = Number(data.tier);
              const current = Number(localState.upgrades[item]) || 0;
              if (!cfg || cfg.enabled === false || !Number.isInteger(tier) || tier !== current + 1 || tier > costs.length) reason = 'invalid';
              else {
                const cost = Math.max(0, Math.round(Number(costs[tier - 1]) || 0));
                if (localState.coins < cost) reason = 'poor';
                else {
                  localState.coins -= cost;
                  localState.upgrades[item] = tier;
                  ok = true;
                }
              }
            }

            dispatch('buy_result', { ok, reason: ok ? undefined : reason, score: localState.coins });
            if (ok) pushState();
            return api;
          }
          // move, player-fx, swing and the rest are intentionally local no-ops.
          return api;
        },
      };

      // Let the rest of viewer.html finish registering handlers first.
      setTimeout(() => {
        dispatch('connect');
        dispatch('init', {});
      }, 0);
      return api;
    }
