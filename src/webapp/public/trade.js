(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  const params = new URLSearchParams(location.search);
  const tradeId = params.get('tradeId');
  const initData = (tg && tg.initData) || params.get('initData') || '';

  const screens = {
    loading: document.getElementById('screen-loading'),
    error: document.getElementById('screen-error'),
    ended: document.getElementById('screen-ended'),
    trade: document.getElementById('screen-trade'),
    'pick-pokemon': document.getElementById('screen-pick-pokemon'),
    'pick-item': document.getElementById('screen-pick-item'),
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

  if (!tradeId || !initData) {
    showError('This page only works when opened from a trade message inside Telegram.');
    return;
  }

  function spriteUrl(speciesName) {
    const normalized = speciesName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `https://play.pokemonshowdown.com/sprites/ani/${normalized}.gif`;
  }

  const headers = { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData };

  async function api(path, options) {
    const res = await fetch(path, { headers, ...options });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  }

  let trade = null; // last known full trade state from server
  const otherNameEl = document.getElementById('other-name');
  const theirChips = document.getElementById('their-chips');
  const theirCoins = document.getElementById('their-coins');
  const theirReady = document.getElementById('their-ready');
  const yourChips = document.getElementById('your-chips');
  const yourCoins = document.getElementById('your-coins');
  const yourReady = document.getElementById('your-ready');
  const statusEl = document.getElementById('trade-status');
  const readyBtn = document.getElementById('ready-btn');
  const coinInput = document.getElementById('coin-input');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = `trade-status${kind ? ` ${kind}` : ''}`;
  }

  function mySide() {
    return trade.viewerSide;
  }
  function otherSide() {
    return trade.viewerSide === 'initiator' ? 'target' : 'initiator';
  }

  function renderChips(container, offer, editable) {
    container.innerHTML = '';
    const items = [...offer.pokemon.map((p) => ({ kind: 'pokemon', ...p })), ...offer.items.map((i) => ({ kind: 'item', ...i }))];
    if (items.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'offer-empty';
      empty.textContent = 'Nothing added yet.';
      container.appendChild(empty);
      return;
    }
    for (const entry of items) {
      const chip = document.createElement('div');
      chip.className = 'offer-chip';
      if (entry.kind === 'pokemon') {
        const img = document.createElement('img');
        img.src = spriteUrl(entry.species_name);
        chip.appendChild(img);
        const label = document.createElement('span');
        label.textContent = entry.species_name + (entry.shiny ? ' ✨' : '');
        chip.appendChild(label);
        if (editable) {
          const x = document.createElement('span');
          x.className = 'remove-x';
          x.textContent = '✕';
          x.addEventListener('click', () => removePokemon(entry.instance_id));
          chip.appendChild(x);
        }
      } else {
        const label = document.createElement('span');
        const humanized = entry.item_key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        label.textContent = `${humanized} ×${entry.quantity}`;
        chip.appendChild(label);
        if (editable) {
          const x = document.createElement('span');
          x.className = 'remove-x';
          x.textContent = '✕';
          x.addEventListener('click', () => setItemQuantity(entry.item_key, 0));
          chip.appendChild(x);
        }
      }
      container.appendChild(chip);
    }
  }

  function render() {
    const you = trade[mySide()];
    const them = trade[otherSide()];
    otherNameEl.textContent = them.name;

    renderChips(theirChips, them.offer, false);
    theirCoins.textContent = them.coins > 0 ? `🪙 Offering ${them.coins} Coins` : '';
    theirReady.textContent = them.ready ? '✅ Ready' : '⏳ Building';
    theirReady.classList.toggle('active', them.ready);

    renderChips(yourChips, you.offer, true);
    yourCoins.textContent = you.coins > 0 ? `🪙 Offering ${you.coins} Coins` : '';
    yourReady.textContent = you.ready ? '✅ Ready' : '⏳ Building';
    yourReady.classList.toggle('active', you.ready);

    readyBtn.textContent = you.ready ? '🔓 Unready (edit offer)' : '✅ Mark Ready';
    readyBtn.classList.toggle('is-ready', you.ready);
    coinInput.value = you.coins > 0 ? String(you.coins) : '';

    showScreen('trade');
  }

  function showEnded(status) {
    const icon = document.getElementById('ended-icon');
    const title = document.getElementById('ended-title');
    const text = document.getElementById('ended-text');
    const map = {
      completed: ['✅', 'Trade Complete', 'Check the group chat or your DMs for the full summary.'],
      cancelled: ['❌', 'Trade Cancelled', 'This trade was cancelled.'],
      declined: ['❌', 'Trade Declined', 'This trade was declined.'],
      expired: ['⌛', 'Trade Expired', 'This trade timed out from inactivity.'],
    };
    const [i, t, m] = map[status] || ['ℹ️', 'Trade Ended', ''];
    icon.textContent = i;
    title.textContent = t;
    text.textContent = m;
    showScreen('ended');
  }

  async function refreshTrade() {
    const { ok, body } = await api(`/api/trade/${tradeId}`);
    if (!ok) {
      showError('Could not load this trade — it may have ended.');
      return;
    }
    applyTradeState(body);
  }

  function applyTradeState(newTrade) {
    trade = newTrade;
    if (trade.status !== 'pending') {
      showEnded(trade.status);
      return;
    }
    render();
  }

  async function addPokemon(instanceId) {
    const { ok, body } = await api(`/api/trade/${tradeId}/pokemon`, {
      method: 'POST',
      body: JSON.stringify({ instanceId, action: 'add' }),
    });
    if (!ok) setStatus(body.reason === 'already_offered' ? 'Already in your offer.' : 'Could not add that.', 'err');
  }

  async function removePokemon(instanceId) {
    await api(`/api/trade/${tradeId}/pokemon`, {
      method: 'POST',
      body: JSON.stringify({ instanceId, action: 'remove' }),
    });
  }

  async function setItemQuantity(itemKey, quantity) {
    const { ok, body } = await api(`/api/trade/${tradeId}/item`, {
      method: 'POST',
      body: JSON.stringify({ itemKey, quantity }),
    });
    if (!ok) setStatus(body.reason === 'not_enough' ? "You don't have that many." : 'Could not update.', 'err');
  }

  document.getElementById('add-pokemon-btn').addEventListener('click', openPokemonPicker);
  document.getElementById('add-item-btn').addEventListener('click', openItemPicker);
  document.getElementById('pokemon-back-btn').addEventListener('click', () => showScreen('trade'));
  document.getElementById('item-back-btn').addEventListener('click', () => showScreen('trade'));

  async function openPokemonPicker() {
    showScreen('pick-pokemon');
    const grid = document.getElementById('pokemon-grid');
    grid.innerHTML = '<p class="empty-note">Loading...</p>';
    const { ok, body } = await api('/api/trade-collection');
    if (!ok) {
      grid.innerHTML = '<p class="empty-note">Could not load your collection.</p>';
      return;
    }
    const offeredIds = new Set(trade[mySide()].offer.pokemon.map((p) => p.instance_id));
    grid.innerHTML = '';
    if (body.instances.length === 0) {
      grid.innerHTML = '<p class="empty-note">You have no Pokémon to offer yet.</p>';
      return;
    }
    for (const mon of body.instances) {
      const card = document.createElement('div');
      card.className = 'pick-card';
      if (offeredIds.has(mon.instanceId)) card.classList.add('selected');

      const img = document.createElement('img');
      img.src = spriteUrl(mon.speciesName);
      card.appendChild(img);

      const name = document.createElement('div');
      name.className = 'card-name';
      name.textContent = mon.speciesName + (mon.shiny ? ' ✨' : '');
      card.appendChild(name);

      const rarity = document.createElement('div');
      rarity.className = 'card-rarity';
      rarity.textContent = mon.rarity;
      card.appendChild(rarity);

      card.addEventListener('click', async () => {
        if (card.classList.contains('selected')) {
          await removePokemon(mon.instanceId);
          card.classList.remove('selected');
        } else {
          await addPokemon(mon.instanceId);
          card.classList.add('selected');
        }
      });

      grid.appendChild(card);
    }
  }

  async function openItemPicker() {
    showScreen('pick-item');
    const list = document.getElementById('item-list');
    list.innerHTML = '<p class="empty-note">Loading...</p>';
    const { ok, body } = await api('/api/trade-inventory');
    if (!ok) {
      list.innerHTML = '<p class="empty-note">Could not load your items.</p>';
      return;
    }
    const offeredQty = new Map(trade[mySide()].offer.items.map((i) => [i.item_key, i.quantity]));
    list.innerHTML = '';
    if (body.items.length === 0) {
      list.innerHTML = '<p class="empty-note">You have no items to offer.</p>';
      return;
    }
    for (const item of body.items) {
      const row = document.createElement('div');
      row.className = 'pick-item-row';

      const left = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'item-label';
      label.textContent = `${item.emoji} ${item.label}`;
      left.appendChild(label);
      const owned = document.createElement('div');
      owned.className = 'item-owned';
      owned.textContent = `You own ${item.quantity}`;
      left.appendChild(owned);
      row.appendChild(left);

      const stepper = document.createElement('div');
      stepper.className = 'pick-item-stepper';
      const minusBtn = document.createElement('button');
      minusBtn.textContent = '−';
      const countSpan = document.createElement('span');
      let current = offeredQty.get(item.itemKey) || 0;
      countSpan.textContent = String(current);
      const plusBtn = document.createElement('button');
      plusBtn.textContent = '+';

      minusBtn.addEventListener('click', async () => {
        if (current <= 0) return;
        current -= 1;
        countSpan.textContent = String(current);
        await setItemQuantity(item.itemKey, current);
      });
      plusBtn.addEventListener('click', async () => {
        if (current >= item.quantity) return;
        current += 1;
        countSpan.textContent = String(current);
        await setItemQuantity(item.itemKey, current);
      });

      stepper.appendChild(minusBtn);
      stepper.appendChild(countSpan);
      stepper.appendChild(plusBtn);
      row.appendChild(stepper);
      list.appendChild(row);
    }
  }

  document.getElementById('set-coins-btn').addEventListener('click', async () => {
    const amount = Math.max(0, Math.floor(Number(coinInput.value) || 0));
    const { ok, body } = await api(`/api/trade/${tradeId}/coins`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
    if (!ok) setStatus(body.reason === 'not_enough' ? "You don't have that many Coins." : 'Could not set Coins.', 'err');
    else setStatus('Coin offer updated.', 'ok');
  });

  readyBtn.addEventListener('click', async () => {
    const you = trade[mySide()];
    const { ok } = await api(`/api/trade/${tradeId}/ready`, {
      method: 'POST',
      body: JSON.stringify({ ready: !you.ready }),
    });
    if (ok && tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    if (!ok) setStatus('Could not update ready status.', 'err');
  });

  document.getElementById('cancel-btn').addEventListener('click', async () => {
    await api(`/api/trade/${tradeId}/cancel`, { method: 'POST' });
    showEnded('cancelled');
  });

  function connectWebSocket() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws?tradeId=${encodeURIComponent(tradeId)}&initData=${encodeURIComponent(initData)}`);
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'state' && msg.trade) applyTradeState(msg.trade);
      } catch (err) {
        // ignore malformed frame
      }
    });
    ws.addEventListener('close', () => {
      setTimeout(connectWebSocket, 2000);
    });
  }

  showScreen('loading');
  refreshTrade()
    .then(connectWebSocket)
    .catch((err) => {
      console.error(err);
      showError('Could not connect to the server.');
    });
})();
