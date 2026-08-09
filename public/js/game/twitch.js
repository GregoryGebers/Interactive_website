    // ---- Twitch background --------------------------------------------------
    // Twitch requires a "parent" param that exactly matches the hostname the
    // page is actually loaded from (no protocol, no port), or the embed just
    // shows a "refused to connect" error. Building it from window.location
    // means this keeps working whether you're on the Render URL, a custom
    // domain, or testing on localhost — no manual editing needed per-deploy.
    //
    // WHICH channel to embed is decided SERVER-SIDE by the isEberhex env var
    // on Render and fetched from /config — so switching hosts (eberhex <->
    // izu_kora) is a one-variable change on the server, with no edit to this
    // file. If the config request fails for any reason, we fall back to the
    // value below so the page still shows *a* stream.
    let TWITCH_CHANNEL = 'izu_kora'; // fallback until /config responds

    async function setupTwitchBackground() {
      if (IS_EDITOR_TEST) {
        document.getElementById('twitchBg').style.display = 'none';
        return;
      }
      if (!window.location.hostname) {
        console.warn('Twitch embed needs a real hostname (http/https) — opening this file directly (file://) will not work.');
        return;
      }

      // Same-origin fetch: viewer.html is served by the same Render service,
      // so a relative /config needs no CORS. (If you ever serve this page
      // from a different origin than the server, switch this to the full
      // server URL and enable CORS on the /config route.)
      try {
        const res = await fetch('/config');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg && cfg.twitchChannel) TWITCH_CHANNEL = cfg.twitchChannel;
        }
      } catch (e) {
        console.warn('Could not fetch /config — using fallback channel:', TWITCH_CHANNEL, e);
      }

      const parents = [window.location.hostname];
      // If you test locally alongside the deployed site, uncomment:
      // parents.push('localhost');

      const parentParams = parents.map(p => `parent=${encodeURIComponent(p)}`).join('&');
      const twitchBg = document.getElementById('twitchBg');
      twitchBg.src = `https://player.twitch.tv/?channel=${encodeURIComponent(TWITCH_CHANNEL)}&${parentParams}&muted=true&autoplay=true`;
    }
    setupTwitchBackground();

    // Fallback that's always available regardless of whether autoplay
    // worked: some things Twitch will never let a script click through on
    // the viewer's behalf, by design — a mature-content consent gate, or a
    // browser that's decided to block autoplay for this site entirely.
    // Both require an actual click inside the Twitch player itself. Since
    // the background layer sits under the game canvas with
    // pointer-events:none (so the canvas can normally receive all clicks/
    // keys), this button temporarily swaps that: canvas stops receiving
    // clicks, the Twitch iframe starts receiving them, so its own native
    // play button / consent screen / volume control can be clicked directly
    // like a normal webpage. Click again to hand control back to the game.
    let streamInteractive = false;
    const twitchControlsBtn = document.getElementById('twitchControls');
    if (IS_EDITOR_TEST) {
      twitchControlsBtn.style.display = 'none';
      const twitchToggleRow = document.getElementById('twitchToggleRow');
      if (twitchToggleRow) twitchToggleRow.style.display = 'none';
    }
    twitchControlsBtn.addEventListener('click', () => {
      streamInteractive = !streamInteractive;
      canvas.style.pointerEvents = streamInteractive ? 'none' : 'auto';
      document.getElementById('twitchBg').style.pointerEvents = streamInteractive ? 'auto' : 'none';
      document.body.classList.toggle('stream-interactive', streamInteractive);
      twitchControlsBtn.textContent = streamInteractive ? 'Return to Game' : 'Interact with Stream';
      if (!streamInteractive) canvas.focus();
    });
