  // ---- Shared game-feel effects ---------------------------------------------
  // These are the SAME world-space visual effects the player clients see.
  // The overlay deliberately has NO camera-shake system, so the stream stays
  // stable even when individual player browsers shake on impacts/landings.
  const fxParticles = [];
  const fxRings = [];
  const fxSprites = [];
  const fxCoinPops = [];

  function loadFrames(paths) {
    return paths.map(src => { const im = new Image(); im.src = src; return im; });
  }
  const EFFECT_DASH = {
    frames: loadFrames(Array.from({length:12}, (_,i)=>`/assets/effects/Horisontal_smoke/Horisontal_smoke${i+1}.png`)),
    w:100, h:100, duration:0.26,
  };
  const EFFECT_DOUBLE_JUMP = {
    frames: loadFrames(Array.from({length:7}, (_,i)=>`/assets/effects/Smoke_ring1/Smoke_ring1_${i+1}.png`)),
    w:64, h:64, duration:0.30,
  };
  const EFFECT_LAND = {
    frames: loadFrames(Array.from({length:11}, (_,i)=>`/assets/effects/Falling_smoke/Falling_smoke${i+6}.png`)),
    w:117, h:48, duration:0.35,
  };
  const EFFECT_INVIS = {
    sheet:(()=>{ const im=new Image(); im.src='/assets/effects/invisibility/9.png'; return im; })(),
    cols:8, w:72, h:72, duration:0.5,
  };
  const HIT_STOP_SEC = 0.065;

  const fxRand = (a,b) => a + Math.random() * (b-a);
  const fxLerp = (a,b,t) => a + (b-a) * Math.max(0, Math.min(1,t));

  function spawnFxSprite(effect, x, y, opts={}) {
    fxSprites.push({ effect, x, y, flipX:!!opts.flipX, flipY:!!opts.flipY,
      elapsed:0, duration:Number(opts.duration)||effect.duration||0.3 });
  }
  function pushFxParticle(p) {
    p.life = Number(p.life)||0.2; p.maxLife = p.life; fxParticles.push(p);
  }
  function spawnImpactParticles(x,y,dir,tier=0,maxTier=3) {
    const count = Math.round(fxLerp(3,6,maxTier>0?tier/maxTier:0));
    for (let i=0;i<count;i++) {
      pushFxParticle({ type:'square', x:x+fxRand(-4,4), y:y+fxRand(-6,6),
        vx:-dir*fxRand(85,155)+fxRand(-24,24), vy:fxRand(-105,45), gravity:210,
        size:fxRand(2.5,5.5), color:i%3===0?'#ffc145':'#f3f7ee', life:fxRand(.18,.3) });
    }
  }
  function spawnRing(x,y,startRadius,endRadius,life,color='#f3f7ee',lineWidth=2) {
    fxRings.push({x,y,startRadius,endRadius,life,maxLife:life,color,lineWidth});
  }
  function spawnCoinFx(x,y) {
    fxCoinPops.push({x,y,elapsed:0,duration:0.12});
    for (let i=0;i<4;i++) pushFxParticle({type:'square',x:x+10,y:y+10,
      vx:fxRand(-70,70),vy:fxRand(-115,-45),gravity:250,size:fxRand(2.5,4.5),color:'#ffc145',life:fxRand(.2,.32)});
    pushFxParticle({type:'spark',x:x+10,y:y+6,vx:0,vy:-18,gravity:0,size:6,color:'#fff7cf',life:.16});
  }

  function handleSharedPlayerFx(data) {
    if (!data) return;
    const x=Number(data.x), y=Number(data.y);
    if (!Number.isFinite(x)||!Number.isFinite(y)) return;
    const p=players[data.id];
    const now=now0();
    const type=String(data.type||'');
    if (type==='dash') {
      const dir=Number(data.dir)===-1?-1:1, cx=x+10, cy=y+10;
      spawnFxSprite(EFFECT_DASH,cx-EFFECT_DASH.w/2-dir*18,cy-EFFECT_DASH.h/2,{flipX:dir>0});
    } else if (type==='jump') {
      if (p) p.jumpStretchStartedAt=now;
    } else if (type==='double-jump') {
      const cx=x+10, feet=y+20;
      spawnFxSprite(EFFECT_DOUBLE_JUMP,cx-EFFECT_DOUBLE_JUMP.w/2,feet-EFFECT_DOUBLE_JUMP.h/2);
      if (p) p.jumpStretchStartedAt=now;
    } else if (type==='land') {
      const cx=x+10, feet=y+20;
      spawnFxSprite(EFFECT_LAND,cx-EFFECT_LAND.w/2,feet-EFFECT_LAND.h,{flipY:false});
      if (p) p.landingSquashStartedAt=now;
    } else if (type==='invisibility') {
      const cx=x+10, cy=y+10;
      spawnFxSprite(EFFECT_INVIS,cx-EFFECT_INVIS.w/2+5,cy-EFFECT_INVIS.h+10);
    }
  }

  socket.on('player-fx', handleSharedPlayerFx);
  socket.on('coin-fx', data => {
    if (!data) return;
    const x=Number(data.x), y=Number(data.y);
    if (Number.isFinite(x)&&Number.isFinite(y)) spawnCoinFx(x,y);
  });
  socket.on('player-hit', data => {
    if (!data) return;
    const target=players[data.targetId];
    if (!target) return;
    const dir=Number(data.dir)===-1?-1:1;
    const maxTier=Math.max(1,Number(data.maxTier)||1);
    const tier=Math.max(0,Math.min(maxTier,Number(data.tier)||0));
    const tx=(target.renderX??target.x)+10, ty=(target.renderY??target.y)+10;
    spawnImpactParticles(tx,ty,dir,tier,maxTier);
    target.hitFlashUntil=now0()+90;
    target.hitStopUntil=now0()+HIT_STOP_SEC*1000;
    if (tier>=maxTier) {
      spawnRing(tx,ty,7,48,.28,'#ffc145',3);
      target.hitSquashUntil=now0()+80;
    }
  });

  function updateSharedFx(dt) {
    const step=Math.max(0,Math.min(Number(dt)||0,.05));
    for (let i=fxParticles.length-1;i>=0;i--) {
      const p=fxParticles[i]; p.life-=step;
      if (p.life<=0) { fxParticles.splice(i,1); continue; }
      p.vy+=(p.gravity||0)*step; p.x+=(p.vx||0)*step; p.y+=(p.vy||0)*step;
    }
    for (let i=fxRings.length-1;i>=0;i--) {
      fxRings[i].life-=step; if (fxRings[i].life<=0) fxRings.splice(i,1);
    }
    for (let i=fxSprites.length-1;i>=0;i--) {
      fxSprites[i].elapsed+=step; if (fxSprites[i].elapsed>=fxSprites[i].duration) fxSprites.splice(i,1);
    }
    for (let i=fxCoinPops.length-1;i>=0;i--) {
      fxCoinPops[i].elapsed+=step; if (fxCoinPops[i].elapsed>=fxCoinPops[i].duration) fxCoinPops.splice(i,1);
    }
  }

  function drawFxSpritesOverlay() {
    for (const fx of fxSprites) {
      const eff=fx.effect, ratio=Math.min(.9999,fx.elapsed/fx.duration);
      ctx.save();
      ctx.translate(fx.x+(fx.flipX?eff.w:0),fx.y+(fx.flipY?eff.h:0));
      ctx.scale(fx.flipX?-1:1,fx.flipY?-1:1);
      if (eff.sheet) {
        if (eff.sheet.complete&&eff.sheet.naturalWidth) {
          const idx=Math.floor(ratio*eff.cols);
          ctx.drawImage(eff.sheet,idx*eff.w,0,eff.w,eff.h,0,0,eff.w,eff.h);
        }
      } else {
        const idx=Math.floor(ratio*eff.frames.length), im=eff.frames[idx];
        if (im&&im.complete&&im.naturalWidth) ctx.drawImage(im,0,0,eff.w,eff.h);
      }
      ctx.restore();
    }
  }

  function drawWorldFxOverlay() {
    for (const p of fxParticles) {
      const alpha=Math.max(0,Math.min(1,p.life/p.maxLife));
      ctx.save(); ctx.globalAlpha=alpha; ctx.fillStyle=p.color||'#fff'; ctx.strokeStyle=p.color||'#fff';
      if (p.type==='spark') {
        const r=(p.size||5)*alpha;
        ctx.fillRect(Math.round(p.x-r/2),Math.round(p.y-1),Math.round(r),2);
        ctx.fillRect(Math.round(p.x-1),Math.round(p.y-r/2),2,Math.round(r));
      } else {
        const size=Math.max(1,Math.round((p.size||3)*(.55+.45*alpha)));
        ctx.fillRect(Math.round(p.x-size/2),Math.round(p.y-size/2),size,size);
      }
      ctx.restore();
    }
    for (const r of fxRings) {
      const t=1-r.life/r.maxLife, radius=fxLerp(r.startRadius,r.endRadius,t), alpha=Math.max(0,1-t);
      ctx.save(); ctx.globalAlpha=alpha; ctx.strokeStyle=r.color; ctx.lineWidth=r.lineWidth||2; ctx.beginPath();
      const pts=[]; for(let i=0;i<8;i++){const a=-Math.PI/2+i*Math.PI/4;pts.push([Math.round(r.x+Math.cos(a)*radius),Math.round(r.y+Math.sin(a)*radius)]);}
      ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0],pts[i][1]); ctx.closePath(); ctx.stroke(); ctx.restore();
    }
    for (const pop of fxCoinPops) {
      if (!coinImg.complete||!coinImg.naturalWidth) continue;
      const t=Math.max(0,Math.min(1,pop.elapsed/pop.duration));
      const popScale=1+.3*Math.sin(Math.PI*t), size=20*popScale, cx=pop.x+10, cy=pop.y+10-12*t;
      ctx.save(); ctx.globalAlpha=1-t*.75; ctx.drawImage(coinImg,cx-size/2,cy-size/2,size,size); ctx.restore();
    }
  }

  const overlaySpriteFxCanvas=document.createElement('canvas');
  overlaySpriteFxCanvas.width=64; overlaySpriteFxCanvas.height=64;
  const overlaySpriteFxCtx=overlaySpriteFxCanvas.getContext('2d');
  function drawOverlaySpriteFrame(image,frameIndex,frameRow,x,y,opts={}) {
    const fw=64,fh=64, sxScale=opts.scaleX??1, syScale=opts.scaleY??1;
    const pivotX=opts.pivotX==null?fw/2:opts.pivotX, pivotY=opts.pivotY==null?fh/2:opts.pivotY;
    let source=image,srcX=(frameIndex||0)*fw,srcY=(frameRow||0)*fh;
    if (opts.whiteFlash) {
      overlaySpriteFxCtx.setTransform(1,0,0,1,0,0); overlaySpriteFxCtx.clearRect(0,0,fw,fh);
      overlaySpriteFxCtx.globalCompositeOperation='source-over'; overlaySpriteFxCtx.globalAlpha=1;
      overlaySpriteFxCtx.drawImage(image,srcX,srcY,fw,fh,0,0,fw,fh);
      overlaySpriteFxCtx.globalCompositeOperation='source-atop'; overlaySpriteFxCtx.fillStyle='#fff'; overlaySpriteFxCtx.fillRect(0,0,fw,fh);
      overlaySpriteFxCtx.globalCompositeOperation='source-over'; source=overlaySpriteFxCanvas; srcX=0; srcY=0;
    }
    ctx.save(); ctx.translate(x+pivotX,y+pivotY); ctx.scale(sxScale,syScale);
    ctx.drawImage(source,srcX,srcY,fw,fh,-pivotX,-pivotY,fw,fh); ctx.restore();
  }
  function overlaySpriteScale(p,now=now0()) {
    if (now<(p.hitSquashUntil||0)) return {x:.72,y:1.18};
    const landAge=now-(p.landingSquashStartedAt||0);
    if (p.landingSquashStartedAt&&landAge>=0&&landAge<180) {
      if (landAge<80){const t=landAge/80;return{x:fxLerp(1.15,.95,t),y:fxLerp(.85,1.05,t)};}
      const t=(landAge-80)/100;return{x:fxLerp(.95,1,t),y:fxLerp(1.05,1,t)};
    }
    const jumpAge=now-(p.jumpStretchStartedAt||0);
    if (p.jumpStretchStartedAt&&jumpAge>=0&&jumpAge<80){const t=jumpAge/80;return{x:fxLerp(.9,1,t),y:fxLerp(1.1,1,t)};}
    return{x:1,y:1};
  }


  let coin = null;
  socket.on("coin", data => {
    coin = data;
    console.log("Coin received:", data.x, data.y);
  });

  socket.on("coin_taken", (data) => {
    coin = null;
    console.log("coin taken:");
  });
  

  // Collision/crate rectangles. Seeded with the built-in level as a fallback,
  // then replaced by scene.json in loadScene() below. `let` so that can swap.
