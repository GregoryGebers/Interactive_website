    socket.on('persist_state', data => {
      if (data && typeof data.token === 'string') writeSignedStateCookie(data.token);
    });

    // Authoritative save restore/update from the server.
    socket.on('player_state', data => {
      if (!data || typeof data !== 'object') return;

      const coins = Number(data.coins);
      if (Number.isFinite(coins)) player.score = Math.max(0, Math.floor(coins));

      const incomingUp = data.upgrades && typeof data.upgrades === 'object' ? data.upgrades : {};
      for (const key of ['jump', 'dash', 'knockback', 'health', 'invisibility']) {
        const v = Number(incomingUp[key]);
        upgrades[key] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
      }
      upgrades.doubleJump = Number(incomingUp.doubleJump) > 0;

      ownedSkins = new Set(['classic']);
      if (Array.isArray(data.cosmetics)) {
        for (const id of data.cosmetics) if (SKINS[id]) ownedSkins.add(id);
      }

      const restoredSkin = typeof data.equippedSkin === 'string' && ownedSkins.has(data.equippedSkin)
        ? data.equippedSkin
        : 'classic';
      equippedSkin = restoredSkin;
      player.skin = restoredSkin;

      player.maxHealth = 3 + upgrades.health;
      player.health = player.maxHealth;

      if (shopOpen) renderShop();
      emitMoveNow();
    });

    // Send one move packet right now so other players see a skin change
    // immediately instead of on the next throttled emit.
    function emitMoveNow() {
      socket.emit('move', {
        x: player.x, y: player.y,
        frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow: animations.frameRow, facing: player.facing,
        username: player.username, color: player.color, beakColor: player.beakColor, emote: player.action, score: player.score, skin: player.skin, invisible: player.invisible,
      });
    }

    function equipSkin(id) {
      if (!ownedSkins.has(id)) return;
      if (id !== 'classic' && (!SKINS[id] || SKINS[id].enabled === false)) return;
      if (pendingEquip) return;
      pendingEquip = id;
      setShopMsg('Equipping ' + (SKINS[id] ? SKINS[id].name : 'skin') + '…');
      socket.emit('equip_skin', { skinId: id });
    }

    socket.on('equip_result', data => {
      if (!data) return;
      if (!data.ok) setShopMsg('Cannot equip that cosmetic.');
      pendingEquip = null;
    });
