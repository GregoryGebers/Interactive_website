    function drawSpriteFrame(context, image, frameIndex, frameRow, x, y, options = {}) {
      const fw = 64, fh = 64;
      const alpha = options.alpha == null ? 1 : options.alpha;
      const sxScale = options.scaleX == null ? 1 : options.scaleX;
      const syScale = options.scaleY == null ? 1 : options.scaleY;
      const flash = options.whiteFlash === true;

      let source = image;
      let srcX = (frameIndex || 0) * fw, srcY = (frameRow || 0) * fh;
      if (flash) {
        spriteFxCtx.setTransform(1,0,0,1,0,0);
        spriteFxCtx.clearRect(0, 0, fw, fh);
        spriteFxCtx.globalCompositeOperation = 'source-over';
        spriteFxCtx.globalAlpha = 1;
        spriteFxCtx.drawImage(image, srcX, srcY, fw, fh, 0, 0, fw, fh);
        spriteFxCtx.globalCompositeOperation = 'source-atop';
        spriteFxCtx.fillStyle = '#ffffff';
        spriteFxCtx.fillRect(0, 0, fw, fh);
        spriteFxCtx.globalCompositeOperation = 'source-over';
        source = spriteFxCanvas; srcX = 0; srcY = 0;
      }

      context.save();
      context.globalAlpha *= alpha;
      context.translate(x + fw / 2, y + fh / 2);
      context.scale(sxScale, syScale);
      context.drawImage(source, srcX, srcY, fw, fh, -fw / 2, -fh / 2, fw, fh);
      context.restore();
    }

    // Draw every active sprite-effect at its current frame. Chosen by ratio of
    // elapsed / duration, so the animation plays through the full frame list
    // exactly once regardless of frame rate. `flipX` mirrors the frame in place
    // (dash smoke uses this to point the tail behind the dash direction).
    function drawFxSprites() {
      for (const fx of fxSprites) {
        const eff = fx.effect;
        const ratio = Math.min(0.9999, fx.elapsed / fx.duration);
        // Translate to the corner that becomes the origin after mirroring, so
        // the drawn frame always occupies the same [fx.x, fx.x+w] x
        // [fx.y, fx.y+h] rect on screen regardless of flipX/flipY.
        playObj.save();
        playObj.translate(fx.x + (fx.flipX ? eff.w : 0), fx.y + (fx.flipY ? eff.h : 0));
        playObj.scale(fx.flipX ? -1 : 1, fx.flipY ? -1 : 1);
        if (eff.sheet) {
          // Single-image sprite sheet (invisibility): blit one 72x72 cell.
          if (eff.sheet.complete && eff.sheet.naturalWidth) {
            const idx = Math.floor(ratio * eff.cols);
            playObj.drawImage(eff.sheet, idx * eff.w, 0, eff.w, eff.h, 0, 0, eff.w, eff.h);
          }
        } else {
          // One image per frame (dash / double-jump / landing).
          const idx = Math.floor(ratio * eff.frames.length);
          const im = eff.frames[idx];
          if (im && im.complete && im.naturalWidth) playObj.drawImage(im, 0, 0, eff.w, eff.h);
        }
        playObj.restore();
      }
    }

    function drawWorldEffects() {
      for (const p of fxParticles) {
        const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
        playObj.save();
        playObj.globalAlpha = alpha;
        playObj.fillStyle = p.color || '#fff';
        playObj.strokeStyle = p.color || '#fff';
        if (p.type === 'line') {
          playObj.lineWidth = p.lineWidth || 2;
          playObj.beginPath();
          playObj.moveTo(Math.round(p.x), Math.round(p.y));
          playObj.lineTo(Math.round(p.x - (p.dir || 1) * (p.size || 10)), Math.round(p.y));
          playObj.stroke();
        } else if (p.type === 'spark') {
          const r = (p.size || 5) * alpha;
          playObj.fillRect(Math.round(p.x - r / 2), Math.round(p.y - 1), Math.round(r), 2);
          playObj.fillRect(Math.round(p.x - 1), Math.round(p.y - r / 2), 2, Math.round(r));
        } else {
          const size = Math.max(1, Math.round((p.size || 3) * (0.55 + 0.45 * alpha)));
          playObj.fillRect(Math.round(p.x - size / 2), Math.round(p.y - size / 2), size, size);
        }
        playObj.restore();
      }

      for (const r of fxRings) {
        const t = 1 - r.life / r.maxLife;
        const radius = lerp(r.startRadius, r.endRadius, t);
        const alpha = Math.max(0, 1 - t);
        // Eight snapped points make a deliberately pixel-ish expanding ring.
        playObj.save();
        playObj.globalAlpha = alpha;
        playObj.strokeStyle = r.color;
        playObj.lineWidth = r.lineWidth || 2;
        playObj.beginPath();
        const pts = [];
        for (let i = 0; i < 8; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 4;
          pts.push([Math.round(r.x + Math.cos(a) * radius), Math.round(r.y + Math.sin(a) * radius)]);
        }
        playObj.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) playObj.lineTo(pts[i][0], pts[i][1]);
        playObj.closePath();
        playObj.stroke();
        playObj.restore();
      }

      if (coinPickupFx) {
        const now = performance.now();
        const t = (now - coinPickupFx.start) / coinPickupFx.duration;
        if (t >= 1) {
          coinPickupFx = null;
        } else if (coinImg.complete && coinImg.naturalWidth) {
          const clamped = Math.max(0, t);
          const popScale = 1 + 0.3 * Math.sin(Math.PI * clamped);
          const size = 20 * popScale;
          const cx = coinPickupFx.x + 10;
          const cy = coinPickupFx.y + 10 - 12 * clamped;
          playObj.save();
          playObj.globalAlpha = 1 - clamped * 0.75;
          playObj.drawImage(coinImg, cx - size / 2, cy - size / 2, size, size);
          playObj.restore();
        }
      }
    }

    function drawOtherPlayer(p) {
      if (p.invisible) return; // an invisible player is fully hidden to others
      const fw = 64, fh = 64;
      const sprite = skinSheet(p.skin, p.displayEmote);
      const rx = p.renderX ?? p.x;
      const ry = p.renderY ?? p.y;

      const now = performance.now();
      const remoteScale = remoteSpriteScale(p, now);
      drawSpriteFrame(
        playObj, sprite, p.displayFrameIndex || 0, p.displayFrameRow || 0,
        rx - 20, ry - 20,
        { whiteFlash: now < (p.hitFlashUntil || 0), scaleX: remoteScale.x, scaleY: remoteScale.y }
      );

      playObj.font = '16px Arial';
      playObj.fillStyle = p.color || 'blue';
      playObj.textAlign = 'center';
      playObj.textBaseline = 'bottom';
      playObj.fillText(p.username || '', rx + 10, ry - 5);
    }

    function draw() {
      // Clear the full physical canvas in raw pixel space first.
      playObj.setTransform(1, 0, 0, 1, 0, 0);
      playObj.clearRect(0, 0, canvas.width, canvas.height);

      // Everything below is drawn in WORLD coordinates. The transform bakes
      // in three things at once: the view scale, the letterbox offset, and
      // the camera — subtracting cameraX*scale means every world-space
      // drawImage/fillText below is effectively rendered at
      // (worldX - cameraX, worldY - cameraY). Zoom changes how much of the
      // world fits in this same physical viewport.
      const shake = cameraShakeOffset(performance.now());
      playObj.setTransform(
        scale, 0, 0, scale,
        offsetX - cameraX * scale + shake.x,
        offsetY - cameraY * scale + shake.y
      );

      setObjects();
      // Sprite-based effects (dash smoke, double-jump ring, landing dust,
      // invisibility shimmer) render UNDER the players so the puff appears
      // behind the slime instead of covering it.
      drawFxSprites();

      for (const id in otherPlayers) {
        drawOtherPlayer(otherPlayers[id]);
      }

      // While invisible YOU see a half-transparent slime; everyone else sees
      // nothing (their client skips drawing you — see drawOtherPlayer).
      const nowSpriteFx = performance.now();
      const localScale = localSpriteScale(nowSpriteFx);
      drawSpriteFrame(
        playObj, skinSheet(player.skin, player.action), animations.currentFrame, animations.frameRow,
        player.x - 20, player.y - 20,
        {
          alpha: player.invisible ? 0.5 : 1,
          whiteFlash: nowSpriteFx < localHitFlashUntil,
          scaleX: localScale.x, scaleY: localScale.y,
        }
      );

      playObj.font = '16px Arial';
      playObj.fillStyle = player.color || 'blue';
      playObj.textAlign = 'center';
      playObj.textBaseline = 'bottom';
      playObj.fillText(player.username, player.x + player.width/2, player.y - 5);
      playObj.globalAlpha = 1;

      // Bat swings: drawn over sprites (the bat passes in front of the
      // character) but under chat bubbles. Each swing renders for
      // SWING_DURATION_MS after it started, driven by its own clock, so
      // everyone sees the same bottom-to-top swipe regardless of frame rate.
      const swingNow = performance.now();
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (p.invisible) continue;
        if (p.swingStartAt && swingNow - p.swingStartAt < SWING_DURATION_MS) {
          drawBatSwing(
            playObj,
            (p.renderX ?? p.x) + 10,  // other-player sprite center (matches name offset)
            (p.renderY ?? p.y) + 10,
            p.swingDir || 1,
            (swingNow - p.swingStartAt) / SWING_DURATION_MS
          );
        }
      }
      if (player.swingStartAt && swingNow - player.swingStartAt < SWING_DURATION_MS) {
        drawBatSwing(
          playObj,
          player.x + player.width / 2,
          player.y + player.height / 2,
          player.facing,
          (swingNow - player.swingStartAt) / SWING_DURATION_MS
        );
      }

      // Dust, impact pixels, rings, dash streaks and the coin pop sit above
      // characters/weapons but below chat bubbles.
      drawWorldEffects();

      // Chat bubbles go on top of sprites and usernames, drawn in the same
      // world space so they scale with everything else.
      const nowMs = performance.now();
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (p.invisible) continue;
        if (p.chatMessage && nowMs < p.chatExpiresAt) {
          drawChatBubble(playObj, p.chatMessage, (p.renderX ?? p.x) + 10, (p.renderY ?? p.y) - 22);
        }
      }
      if (player.chatMessage && nowMs < player.chatExpiresAt) {
        drawChatBubble(playObj, player.chatMessage, player.x + player.width / 2, player.y - 22);
      }

      // The HTML chat composer (only you see it) tracks your character too.
      positionChatInput();

      // HUD text drawn in real screen space so it stays a fixed, readable size.
      playObj.setTransform(1, 0, 0, 1, 0, 0);
      const scoreText = "SCORE " + player.score;
      playObj.font = 'bold 16px "Press Start 2P", monospace';
      const textWidth = playObj.measureText(scoreText).width;
      const chipX = 16, chipY = 14, chipPadX = 14, chipPadY = 12;
      const chipW = textWidth + chipPadX * 2, chipH = 16 + chipPadY * 2;

      playObj.fillStyle = '#1f3326';
      playObj.fillRect(chipX, chipY, chipW, chipH);
      playObj.strokeStyle = '#16241a';
      playObj.lineWidth = 2;
      playObj.strokeRect(chipX, chipY, chipW, chipH);
      playObj.fillStyle = '#ffc145';
      playObj.fillRect(chipX, chipY, chipW, 4); // top accent stripe

      playObj.textAlign = 'left';
      playObj.textBaseline = 'middle';
      playObj.fillStyle = '#f3f7ee';
      const hudNow = performance.now();
      if (hudNow < hudCoinPulseUntil) {
        const remaining = (hudCoinPulseUntil - hudNow) / 190;
        const pulse = 1 + 0.25 * Math.sin(Math.PI * (1 - remaining));
        playObj.save();
        playObj.translate(chipX + chipPadX, chipY + chipH / 2 + 1);
        playObj.scale(pulse, pulse);
        playObj.fillText(scoreText, 0, 0);
        playObj.restore();
      } else {
        playObj.fillText(scoreText, chipX + chipPadX, chipY + chipH / 2 + 1);
      }

      const now = performance.now();
      if (now - lastMoveEmit >= MOVE_EMIT_INTERVAL_MS) {
        lastMoveEmit = now;
        socket.emit("move", { x: player.x , y: player.y , frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, username:player.username, color:player.color, emote: player.action, score :player.score, skin: player.skin, invisible: player.invisible });
      }
    }

    // WASD works alongside the arrow keys — checked by lowercasing so both
    // "a" and "A" (e.g. with Caps Lock/Shift) count.
    const RIGHT_KEYS = new Set(["ArrowRight", "d"]);
    const LEFT_KEYS = new Set(["ArrowLeft", "a"]);
    const JUMP_KEYS = new Set(["ArrowUp", "w"]);
