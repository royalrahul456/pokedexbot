(function () {
  const tg = window.Telegram && window.Telegram.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
  }

  // Same real-Telegram-vs-dev-testing fallback as app.js — `?initData=` only exists for
  // testing this page outside real Telegram.
  const params = new URLSearchParams(location.search);
  const initData = (tg && tg.initData) || params.get('initData') || '';

  const screens = {
    loading: document.getElementById('screen-loading'),
    error: document.getElementById('screen-error'),
    empty: document.getElementById('screen-empty'),
    team: document.getElementById('screen-team'),
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

  if (!initData) {
    showError('This page only works when opened from the bot inside Telegram.');
    return;
  }

  function spriteUrl(speciesName) {
    const normalized = speciesName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `https://play.pokemonshowdown.com/sprites/ani/${normalized}.gif`;
  }

  function cardKey(pick) {
    return `${pick.speciesName}|${Boolean(pick.shiny)}`;
  }

  // Owning more than one copy of a species used to show as ONE card with a cycling "×N"
  // badge — confusing, and there was no direct way to deselect without tapping all the way
  // back around to 0. Fixed 2026-07-24: duplicates now render as genuinely separate cards
  // (one per owned copy, capped at 3 since that's the max a team could ever use), each a
  // plain independent tap-to-select/deselect toggle — no cycling, no badge to interpret.
  // `selected` is a Set of per-copy keys, e.g. "Pikachu|false#0", "Pikachu|false#1".
  const selected = new Set();
  let collection = [];

  const grid = document.getElementById('team-grid');
  const countEl = document.getElementById('pick-count');
  const saveBtn = document.getElementById('save-btn');
  const statusEl = document.getElementById('team-status');

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.className = `team-status${kind ? ` ${kind}` : ''}`;
  }

  function renderGrid() {
    const total = selected.size;
    countEl.textContent = String(total);
    saveBtn.disabled = total !== 3;

    for (const card of grid.children) {
      const copyKey = card.dataset.copyKey;
      const isSelected = selected.has(copyKey);
      card.classList.toggle('selected', isSelected);
      card.classList.toggle('disabled', !isSelected && total >= 3);
    }
  }

  function buildGrid() {
    grid.innerHTML = '';
    for (const mon of collection) {
      const baseKey = cardKey(mon);
      const cap = Math.min(mon.quantity, 3);
      for (let copyIndex = 0; copyIndex < cap; copyIndex++) {
        const copyKey = `${baseKey}#${copyIndex}`;
        const card = document.createElement('div');
        card.className = 'team-card';
        card.dataset.copyKey = copyKey;

        const img = document.createElement('img');
        img.src = spriteUrl(mon.speciesName);
        img.alt = '';
        card.appendChild(img);

        const name = document.createElement('div');
        name.className = 'card-name';
        name.textContent = mon.speciesName + (mon.shiny ? ' ✨' : '');
        card.appendChild(name);

        const rarity = document.createElement('div');
        rarity.className = 'card-rarity';
        rarity.textContent = mon.rarity;
        card.appendChild(rarity);

        // Plain toggle — tap to select, tap again to deselect. No cycling, no count badge.
        card.addEventListener('click', () => {
          if (selected.has(copyKey)) {
            selected.delete(copyKey);
            setStatus('');
            renderGrid();
            return;
          }
          if (selected.size >= 3) {
            setStatus('Deselect one first — you can only bring 3.', 'err');
            return;
          }
          selected.add(copyKey);
          setStatus('');
          renderGrid();
        });

        grid.appendChild(card);
      }
    }
    renderGrid();
  }

  async function loadTeamBuilder() {
    const [collectionRes, teamRes] = await Promise.all([
      fetch('/api/collection', { headers: { 'X-Telegram-Init-Data': initData } }),
      fetch('/api/team', { headers: { 'X-Telegram-Init-Data': initData } }),
    ]);
    if (!collectionRes.ok || !teamRes.ok) {
      showError('Could not load your collection — try again in a bit.');
      return;
    }
    const collectionData = await collectionRes.json();
    const teamData = await teamRes.json();
    collection = collectionData.collection || [];

    if (collection.length < 3) {
      showScreen('empty');
      return;
    }

    buildGrid();
    // Pre-select whichever copy-cards match the previously-saved team — one distinct copy
    // index per saved pick of the same species, so re-opening the builder shows the exact
    // same cards highlighted rather than re-deriving a count.
    const usedCopyIndex = new Map();
    for (const pick of teamData.team || []) {
      const baseKey = cardKey(pick);
      const mon = collection.find((m) => cardKey(m) === baseKey);
      if (!mon) continue;
      const cap = Math.min(mon.quantity, 3);
      const nextIndex = usedCopyIndex.get(baseKey) || 0;
      if (nextIndex < cap) {
        selected.add(`${baseKey}#${nextIndex}`);
        usedCopyIndex.set(baseKey, nextIndex + 1);
      }
    }
    renderGrid();
    showScreen('team');
  }

  saveBtn.addEventListener('click', async () => {
    if (selected.size !== 3) return;
    saveBtn.disabled = true;
    setStatus('Saving...');
    const picks = [];
    for (const copyKey of selected) {
      const [speciesName, shinyStr] = copyKey.split('#')[0].split('|');
      picks.push({ speciesName, shiny: shinyStr === 'true' });
    }
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData },
        body: JSON.stringify({ picks }),
      });
      const result = await res.json();
      if (result.ok) {
        setStatus('✅ Team saved! Use it in any Raid or /battle.', 'ok');
        if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
      } else {
        setStatus('⚠️ Could not save — try again.', 'err');
      }
    } catch (err) {
      setStatus('⚠️ Could not save — check your connection.', 'err');
    } finally {
      renderGrid();
    }
  });

  showScreen('loading');
  loadTeamBuilder().catch((err) => {
    console.error(err);
    showError('Could not connect to the server.');
  });
})();
