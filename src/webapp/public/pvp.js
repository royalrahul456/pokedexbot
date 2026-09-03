(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const params = new URLSearchParams(location.search);
  const matchId = params.get('matchId');
  // Same real-Telegram-vs-dev-testing fallback as the raid arena's app.js.
  const initData = (tg && tg.initData) || params.get('initData') || '';

  const screens = {
    loading: document.getElementById('screen-loading'),
    error: document.getElementById('screen-error'),
    battle: document.getElementById('screen-battle'),
    ended: document.getElementById('screen-ended'),
  };

  function showScreen(name) {
    for (const key of Object.keys(screens)) {
      screens[key].classList.toggle('active', key === name);
    }
  }

  function showError(text) {
    document.getElementById('error-text').textContent = text;
    showScreen('error');
  }

  if (!matchId || !initData) {
    showError('This page only works when opened from a battle message inside Telegram.');
    return;
  }

  function spriteUrl(speciesName) {
    const normalized = speciesName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `https://play.pokemonshowdown.com/sprites/ani/${normalized}.gif`;
  }

  function typeBadges(container, types) {
    container.innerHTML = '';
    for (const t of types || []) {
      const span = document.createElement('span');
      span.className = 'type-badge';
      span.textContent = t;
      container.appendChild(span);
    }
  }

  function hpColor(pct) {
    if (pct > 0.5) return 'var(--hp-green)';
    if (pct > 0.2) return 'var(--hp-yellow)';
    return 'var(--hp-red)';
  }

  function flashAndShake(hitFlashId, spriteId) {
    const flash = document.getElementById(hitFlashId);
    const sprite = document.getElementById(spriteId);
    flash.classList.remove('flashing');
    sprite.classList.remove('shaking');
    void flash.offsetWidth;
    void sprite.offsetWidth;
    flash.classList.add('flashing');
    sprite.classList.add('shaking');
  }

  function popDamage(amount) {
    const popup = document.getElementById('damage-popup');
    popup.textContent = `-${amount}`;
    popup.classList.remove('pop');
    void popup.offsetWidth;
    popup.classList.add('pop');
  }

  function renderLog(log) {
    const el = document.getElementById('battle-log');
    el.innerHTML = '';
    for (const entry of log || []) {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.textContent = entry.text;
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  function renderBench(prefix, team) {
    const row = document.getElementById(`${prefix}-bench`);
    row.innerHTML = '';
    for (const slot of team || []) {
      const icon = document.createElement('div');
      icon.className = `bench-icon${slot.active ? ' active' : ''}${slot.fainted ? ' fainted' : ''}`;
      const img = document.createElement('img');
      img.src = spriteUrl(slot.speciesName);
      img.alt = '';
      icon.appendChild(img);
      row.appendChild(icon);
    }
  }

  function showSwapToast(prefix, speciesName) {
    const toast = document.getElementById(`${prefix}-swap-toast`);
    toast.textContent = `Go, ${speciesName}!`;
    toast.classList.remove('show');
    void toast.offsetWidth;
    toast.classList.add('show');
  }

  function playSpriteSwapIn(spriteId) {
    const sprite = document.getElementById(spriteId);
    sprite.classList.remove('swapping-in');
    void sprite.offsetWidth;
    sprite.classList.add('swapping-in');
  }

  function setMonSide(prefix, name, mon, team) {
    document.getElementById(`${prefix}-name`).textContent = name + (mon && mon.shiny ? ' ✨' : '');
    typeBadges(document.getElementById(`${prefix}-types`), mon ? mon.types : []);
    if (mon) document.getElementById(`${prefix}-sprite`).src = spriteUrl(mon.speciesName);
    renderBench(prefix, team);
    const pct = mon && mon.maxHp ? Math.max(0, mon.hp / mon.maxHp) : 0;
    const fill = document.getElementById(`${prefix}-hp-fill`);
    fill.style.width = `${pct * 100}%`;
    fill.style.background = hpColor(pct);
    document.getElementById(`${prefix}-hp-text`).textContent = mon ? `${Math.max(0, mon.hp)} / ${mon.maxHp}` : '-- / --';
  }

  let lastState = null;
  let yourSide = null;
  let acting = false;

  function renderMoves(state) {
    const grid = document.getElementById('move-grid');
    grid.innerHTML = '';
    const isYourTurn = state.turn === state.yourSide;
    for (let i = 0; i < (state.moves || []).length; i++) {
      const move = state.moves[i];
      const btn = document.createElement('button');
      btn.className = 'move-btn';
      btn.disabled = !isYourTurn || acting;
      btn.innerHTML = `${move.name}<span class="move-type">${move.type}</span>`;
      btn.addEventListener('click', () => attack(i));
      grid.appendChild(btn);
    }

    const statusEl = document.getElementById('turn-status');
    statusEl.classList.toggle('your-turn', isYourTurn);
    statusEl.textContent = isYourTurn ? '⚔️ Your turn!' : `⏳ Waiting for ${state.opponent ? state.opponent.name : 'opponent'}...`;
    document.getElementById('turn-indicator').textContent = isYourTurn ? '⬅️' : '➡️';
  }

  function renderBattle(state) {
    yourSide = state.yourSide;
    showScreen('battle');

    // Detect a Pokémon-GO-style swap (active species changed since the last render — i.e. the
    // previous one fainted and the next team member came in) BEFORE overwriting the sprites, so
    // the swap-in slide/toast has something to compare against.
    const youSwapped = lastState && lastState.you && state.you && lastState.you.mon.speciesName !== state.you.mon.speciesName;
    const oppSwapped =
      lastState && lastState.opponent && state.opponent && lastState.opponent.mon.speciesName !== state.opponent.mon.speciesName;

    setMonSide('you', state.you ? state.you.name : 'You', state.you ? state.you.mon : null, state.you ? state.you.team : null);
    setMonSide('opp', state.opponent ? state.opponent.name : 'Opponent', state.opponent ? state.opponent.mon : null, state.opponent ? state.opponent.team : null);

    if (youSwapped) {
      showSwapToast('you', state.you.mon.speciesName);
      playSpriteSwapIn('you-sprite');
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
    } else if (lastState && lastState.you && state.you && state.you.mon.hp < lastState.you.mon.hp) {
      flashAndShake('you-hit-flash', 'you-sprite');
    }
    if (oppSwapped) {
      showSwapToast('opp', state.opponent.mon.speciesName);
      playSpriteSwapIn('opp-sprite');
    } else if (lastState && lastState.opponent && state.opponent && state.opponent.mon.hp < lastState.opponent.mon.hp) {
      flashAndShake('opp-hit-flash', 'opp-sprite');
    }

    renderMoves(state);
    renderLog(state.eventLog);
    lastState = state;
  }

  function renderEnded(state) {
    showScreen('ended');
    const won = state && state.winnerSide != null && state.winnerSide === yourSide;
    const lost = state && state.winnerSide != null && state.winnerSide !== yourSide;
    document.getElementById('ended-icon').textContent = won ? '🏆' : lost ? '😵' : '🏁';
    document.getElementById('ended-title').textContent = won ? 'Victory!' : lost ? 'Defeat' : 'Battle Ended';
    document.getElementById('ended-sub').textContent = 'Check the group chat for full results and rewards.';
  }

  function render(state) {
    if (!state || state.phase === 'ended') {
      renderEnded(state);
      return;
    }
    if (!state.isParticipant) {
      showError("This battle isn't yours to view.");
      return;
    }
    renderBattle(state);
  }

  async function fetchState() {
    const res = await fetch(`/api/battle/${matchId}/state`, {
      headers: { 'X-Telegram-Init-Data': initData },
    });
    if (res.status === 404) {
      render(null);
      return;
    }
    if (!res.ok) {
      showError('Could not load this battle — it may have already ended.');
      return;
    }
    const state = await res.json();
    render(state);
  }

  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?matchId=${encodeURIComponent(matchId)}&initData=${encodeURIComponent(initData)}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') render(msg.battle);
      } catch (err) {
        console.error('Bad WS message', err);
      }
    };
    ws.onclose = () => {
      setTimeout(connectWebSocket, 2000);
    };
    ws.onerror = () => ws.close();
  }

  async function attack(moveIndex) {
    if (acting) return;
    acting = true;
    renderMoves(lastState);
    try {
      const res = await fetch(`/api/battle/${matchId}/attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ moveIndex }),
      });
      const result = await res.json();
      if (result.ok) {
        popDamage(result.damage);
        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
        // Apply the new HP values straight from this response so both bars react on the same
        // round trip as the damage popup instead of waiting for a separate WebSocket push —
        // same lesson learned fixing the raid attack button's lag.
        if (typeof result.hpA === 'number' && lastState) {
          const aIsYou = yourSide === 'A';
          if (lastState.you) lastState.you.mon.hp = aIsYou ? result.hpA : result.hpB;
          if (lastState.opponent) lastState.opponent.mon.hp = aIsYou ? result.hpB : result.hpA;
          lastState.turn = result.turn;
          renderBattle(lastState);
        }
        if (result.matchOver) {
          renderEnded({ winnerSide: result.winnerSide });
        }
      } else if (tg) {
        tg.showAlert(
          result.reason === 'not_your_turn'
            ? "It's not your turn yet."
            : result.reason === 'not_in_battle'
              ? "You're not part of this battle."
              : 'This battle has ended.'
        );
      }
    } catch (err) {
      console.error('Attack failed', err);
    } finally {
      acting = false;
      if (lastState) renderMoves(lastState);
    }
  }

  document.getElementById('close-btn').addEventListener('click', () => {
    if (tg) tg.close();
  });

  showScreen('loading');
  fetchState()
    .then(connectWebSocket)
    .catch((err) => {
      console.error(err);
      showError('Could not connect to the battle server.');
    });
})();
