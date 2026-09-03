(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const params = new URLSearchParams(location.search);
  const chatId = params.get('chatId');
  // Real Telegram always populates tg.initData when this page is opened via a web_app
  // button — the `?initData=` query fallback only exists so this page can be visually
  // tested in a plain browser during development; it's never used inside real Telegram.
  const initData = (tg && tg.initData) || params.get('initData') || '';

  const screens = {
    loading: document.getElementById('screen-loading'),
    error: document.getElementById('screen-error'),
    lobby: document.getElementById('screen-lobby'),
    battle: document.getElementById('screen-battle'),
    eliminated: document.getElementById('screen-eliminated'),
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

  if (!chatId || !initData) {
    showError('This page only works when opened from a raid message inside Telegram.');
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

  function formatMs(ms) {
    if (ms <= 0) return '0s';
    const totalSec = Math.ceil(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function hpColor(pct) {
    if (pct > 0.5) return 'var(--hp-green)';
    if (pct > 0.2) return 'var(--hp-yellow)';
    return 'var(--hp-red)';
  }

  let lastRaid = null;
  let countdownTimer = null;
  let attacking = false;

  function renderLog(containerId, log) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    for (const entry of log || []) {
      const div = document.createElement('div');
      div.className = 'log-line';
      div.textContent = entry.text;
      el.appendChild(div);
    }
    el.scrollTop = el.scrollHeight;
  }

  function flashAndShake(hitFlashId, spriteId) {
    const flash = document.getElementById(hitFlashId);
    const sprite = document.getElementById(spriteId);
    flash.classList.remove('flashing');
    sprite.classList.remove('shaking');
    // Force reflow so re-adding the class restarts the animation even if it's already there.
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

  function renderLobby(raid) {
    showScreen('lobby');
    document.getElementById('lobby-boss-name').textContent = `🐉 ${raid.bossName}`;
    typeBadges(document.getElementById('lobby-boss-types'), raid.bossTypes);
    document.getElementById('lobby-boss-sprite').src = spriteUrl(raid.bossName);
    document.getElementById('lobby-player-count').textContent = raid.playerCount;
    tickCountdown(raid);
  }

  // Applies the boss HP change straight from the /attack HTTP response, so the bar and hit
  // effect react on the same round trip as the damage popup instead of waiting for a second,
  // separate WebSocket round trip (that gap was the "lag" between tapping attack and seeing it
  // land).
  function applyBossHpImmediate(hp, maxHp) {
    if (typeof hp !== 'number') return;
    const effectiveMax = maxHp || (lastRaid ? lastRaid.maxHp : hp) || hp || 1;
    const pct = Math.max(0, hp / effectiveMax);
    const bossFill = document.getElementById('boss-hp-fill');
    bossFill.style.width = `${pct * 100}%`;
    bossFill.style.background = hpColor(pct);
    document.getElementById('boss-hp-text').textContent = `${Math.max(0, hp)} / ${effectiveMax}`;
    flashAndShake('boss-hit-flash', 'boss-sprite');
    // Keep lastRaid.hp in sync so the eventual WS state push (same hp value) doesn't
    // re-trigger a duplicate flash/shake for the same hit.
    if (lastRaid) lastRaid = { ...lastRaid, hp };
  }

  function renderBattle(raid) {
    // Spectator: the group's "Open Battle Arena" button is visible to everyone in the group,
    // not just people who tapped "Join Raid" — so anyone can open this page to watch, and
    // previously the Attack button stayed fully live for them too, only failing (confusingly,
    // "You're not part of this raid") the moment they actually tapped it. Now disabled/hidden
    // up front instead.
    const attackBtn = document.getElementById('attack-btn');
    const spectatorNote = document.getElementById('spectator-note');
    attackBtn.disabled = !raid.isParticipant;
    attackBtn.style.display = raid.isParticipant ? '' : 'none';
    spectatorNote.classList.toggle('active', !raid.isParticipant);

    if (raid.you && raid.you.eliminated) {
      renderLog('battle-log-eliminated', raid.eventLog);
      showScreen('eliminated');
      lastRaid = raid;
      return;
    }

    showScreen('battle');
    const prevBossHp = lastRaid ? lastRaid.hp : raid.hp;
    const prevMonHp = lastRaid && lastRaid.you && lastRaid.you.team[lastRaid.you.activeIndex]
      ? lastRaid.you.team[lastRaid.you.activeIndex].hp
      : (raid.you ? raid.you.team[raid.you.activeIndex]?.hp : 0);

    document.getElementById('boss-name').textContent = raid.bossName;
    typeBadges(document.getElementById('boss-types'), raid.bossTypes);
    document.getElementById('boss-sprite').src = spriteUrl(raid.bossName);
    const bossPct = Math.max(0, raid.hp / raid.maxHp);
    const bossFill = document.getElementById('boss-hp-fill');
    bossFill.style.width = `${bossPct * 100}%`;
    bossFill.style.background = hpColor(bossPct);
    document.getElementById('boss-hp-text').textContent = `${Math.max(0, raid.hp)} / ${raid.maxHp}`;

    if (raid.hp < prevBossHp) {
      flashAndShake('boss-hit-flash', 'boss-sprite');
    }

    if (raid.you) {
      const mon = raid.you.team[raid.you.activeIndex];
      if (mon) {
        document.getElementById('mon-name').textContent = mon.speciesName + (mon.shiny ? ' ✨' : '');
        typeBadges(document.getElementById('mon-types'), mon.types);
        document.getElementById('mon-sprite').src = spriteUrl(mon.speciesName);
        const monPct = Math.max(0, mon.hp / mon.maxHp);
        const monFill = document.getElementById('mon-hp-fill');
        monFill.style.width = `${monPct * 100}%`;
        monFill.style.background = hpColor(monPct);
        document.getElementById('mon-hp-text').textContent = `${Math.max(0, mon.hp)} / ${mon.maxHp}`;

        if (mon.hp < prevMonHp) {
          flashAndShake('mon-hit-flash', 'mon-sprite');
        }
      }

      const dotsEl = document.getElementById('team-dots');
      dotsEl.innerHTML = '';
      raid.you.team.forEach((m, i) => {
        const dot = document.createElement('div');
        dot.className = 'team-dot' + (m.hp <= 0 ? ' fainted' : '') + (i === raid.you.activeIndex ? ' active' : '');
        dotsEl.appendChild(dot);
      });
    }

    document.getElementById('player-count-row').textContent = `👥 ${raid.playerCount}/${raid.lobbySize}`;
    renderLog('battle-log', raid.eventLog);
    tickCountdown(raid);

    lastRaid = raid;
  }

  function renderEnded(raid, reasonText) {
    showScreen('ended');
    const won = raid && raid.hp <= 0;
    document.getElementById('ended-icon').textContent = won ? '🏆' : '🏁';
    document.getElementById('ended-title').textContent = won ? 'Victory!' : 'Raid Ended';
    document.getElementById('ended-sub').textContent = reasonText || 'Check the group chat for full results and rewards.';
  }

  function tickCountdown(raid) {
    clearInterval(countdownTimer);
    const targetIso = raid.phase === 'lobby' ? raid.countdownEndsAt : raid.battleEndsAt;
    if (!targetIso) return;
    const update = () => {
      const remaining = Date.parse(targetIso) - Date.now();
      if (raid.phase === 'lobby') {
        document.getElementById('lobby-countdown').textContent = formatMs(remaining);
      } else {
        document.getElementById('time-remaining-row').textContent = `⏳ ${formatMs(remaining)}`;
      }
    };
    update();
    countdownTimer = setInterval(update, 1000);
  }

  function render(raid) {
    if (!raid) {
      renderEnded(lastRaid, 'This raid is no longer active.');
      return;
    }
    if (raid.phase === 'lobby') renderLobby(raid);
    else if (raid.phase === 'battle') renderBattle(raid);
  }

  async function fetchState() {
    const res = await fetch(`/api/raid/${chatId}/state`, {
      headers: { 'X-Telegram-Init-Data': initData },
    });
    if (res.status === 404) {
      render(null);
      return;
    }
    if (!res.ok) {
      showError('Could not load this raid — it may have already ended.');
      return;
    }
    const raid = await res.json();
    render(raid);
  }

  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?chatId=${encodeURIComponent(chatId)}&initData=${encodeURIComponent(initData)}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state') render(msg.raid);
      } catch (err) {
        console.error('Bad WS message', err);
      }
    };
    ws.onclose = () => {
      setTimeout(connectWebSocket, 2000);
    };
    ws.onerror = () => ws.close();
  }

  document.getElementById('attack-btn').addEventListener('click', async () => {
    if (attacking) return;
    attacking = true;
    const btn = document.getElementById('attack-btn');
    btn.disabled = true;
    try {
      const res = await fetch(`/api/raid/${chatId}/attack`, {
        method: 'POST',
        headers: { 'X-Telegram-Init-Data': initData },
      });
      const result = await res.json();
      if (result.ok) {
        popDamage(result.damage);
        applyBossHpImmediate(result.bossHp, result.bossMaxHp);
        if (tg && tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
      } else if (tg) {
        tg.showAlert(
          result.reason === 'eliminated'
            ? "All 3 of your Pokémon have fainted — you can't attack anymore."
            : result.reason === 'not_in_raid'
              ? "You're not part of this raid."
              : 'This raid has ended.'
        );
      }
    } catch (err) {
      console.error('Attack failed', err);
    } finally {
      setTimeout(() => { attacking = false; btn.disabled = false; }, 400);
    }
  });

  document.getElementById('close-btn').addEventListener('click', () => {
    if (tg) tg.close();
  });

  showScreen('loading');
  fetchState()
    .then(connectWebSocket)
    .catch((err) => {
      console.error(err);
      showError('Could not connect to the raid server.');
    });
})();
