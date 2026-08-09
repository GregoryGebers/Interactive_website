    // ---- Chat ----------------------------------------------------------------
    // Press T -> a private input bubble opens above YOUR character (nobody
    // else sees it). Press Enter -> the message is sent to the server, which
    // filters it and broadcasts the clean version to everyone (including you,
    // so what you see is exactly what others see). Escape cancels.
    const CHAT_MAX_LENGTH = 100;
    const CHAT_DURATION_MS = 6000; // how long a sent bubble stays visible

    const chatInputWrap = document.getElementById('chatInputWrap');
    const chatInput = document.getElementById('chatInput');
    let chatOpen = false;

    // ---- "Say in Twitch chat?" toggle ----
    // When ON, a sent message is ALSO relayed to the real Twitch channel
    // chat (server-side, via your StreamElements bot). Defaults OFF on every
    // page load so nobody accidentally broadcasts; the choice persists while
    // the page stays open (across repeated chat opens).
    let sayInTwitch = false;
    const twitchToggle = document.getElementById('twitchToggle');
    function renderTwitchToggle() {
      twitchToggle.classList.toggle('on', sayInTwitch);
      twitchToggle.setAttribute('aria-checked', sayInTwitch ? 'true' : 'false');
    }
    function toggleSayInTwitch() {
      sayInTwitch = !sayInTwitch;
      renderTwitchToggle();
    }
    twitchToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSayInTwitch();
      chatInput.focus(); // keep typing focus after toggling
    });
    twitchToggle.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        toggleSayInTwitch();
      }
    });
    renderTwitchToggle();

    function openChat() {
      if (chatOpen || !hasJoined) return;
      chatOpen = true;
      // Stop any held movement — while the input has focus, the canvas stops
      // receiving keyup events, so a held key would otherwise run forever.
      inputLeft = inputRight = jumpHeld = shiftHeld = false;
      isDashing = false;
      chatInputWrap.style.display = 'block';
      positionChatInput();
      chatInput.value = '';
      chatInput.focus();
    }

    function closeChat() {
      chatOpen = false;
      chatInputWrap.style.display = 'none';
      chatInput.value = '';
      canvas.focus();
    }

    chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing must never move the character
      if (e.key === 'Enter') {
        const message = chatInput.value.trim().slice(0, CHAT_MAX_LENGTH);
        // Include the toggle state so the server knows whether to relay this
        // one to real Twitch chat as well as the in-game bubble.
        if (message) socket.emit('chat', { message, toTwitch: sayInTwitch });
        closeChat();
      } else if (e.key === 'Escape') {
        closeChat();
      }
    });

    // Keep the composer hovering above your character. World coords ->
    // screen coords using the same scale/offset/camera the canvas draws
    // with, so it stays glued to the slime while the view scrolls.
    function positionChatInput() {
      if (!chatOpen) return;
      const screenX = offsetX + (player.x + player.width / 2 - cameraX) * scale;
      const screenY = offsetY + (player.y - 30 - cameraY) * scale;
      chatInputWrap.style.left = `${screenX}px`;
      chatInputWrap.style.top = `${screenY}px`;
    }

    // The server broadcasts the FILTERED message to everyone, sender
    // included — rendering only what comes back keeps every screen showing
    // the identical censored text.
    socket.on('chat', (data) => {
      if (!data || typeof data.message !== 'string' || !data.message) return;
      const expiresAt = performance.now() + CHAT_DURATION_MS;
      if (data.id === socket.id) {
        player.chatMessage = data.message;
        player.chatExpiresAt = expiresAt;
      } else if (otherPlayers[data.id]) {
        otherPlayers[data.id].chatMessage = data.message;
        otherPlayers[data.id].chatExpiresAt = expiresAt;
      }
    });
