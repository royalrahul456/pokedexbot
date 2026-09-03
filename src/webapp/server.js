// Runs IN-PROCESS with the main Telegraf bot (started from src/index.js, not a separate pm2
// app) — this is deliberate: it needs to `require('../features/bossRaid')` and get the exact
// same module instance (same in-memory `activeRaids` Map) that the Telegram bot.action
// handlers use, so an attack from either surface updates the one shared raid state. Two
// separate Node processes would each get their own independent copy and silently drift apart.
const express = require('express');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const { WEBAPP_PORT } = require('./port');
const { validateInitData } = require('./telegramAuth');
const bossRaidFeature = require('../features/bossRaid');
const battleFeature = require('../features/battle');
const tradingFeature = require('../features/trading');
const tradesDb = require('../db/trades');
const pokemonInstances = require('../db/pokemonInstances');
const inventoryDb = require('../db/inventory');
const { getItemInfo } = require('../data/items');

function authFromRequest(req) {
  const initData = req.headers['x-telegram-init-data'] || req.query.initData;
  return validateInitData(initData);
}

function authMiddleware(req, res, next) {
  const auth = authFromRequest(req);
  if (!auth) {
    res.status(401).json({ error: 'invalid_init_data' });
    return;
  }
  req.telegramUser = auth;
  next();
}

function startWebAppServer(bot) {
  const app = express();
  app.use(express.json());

  // Enable CORS for cross-domain requests (e.g., GitHub Pages frontend)
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, x-telegram-init-data');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check endpoint for Render / Uptime monitors
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/api/raid/:chatId/state', authMiddleware, (req, res) => {
    const chatId = Number(req.params.chatId);
    const raid = bossRaidFeature.getRaid(chatId);
    if (!raid) {
      res.status(404).json({ error: 'no_active_raid' });
      return;
    }
    res.json(bossRaidFeature.sanitizeRaidForWeb(raid, req.telegramUser.userId));
  });

  app.get('/api/collection', authMiddleware, (req, res) => {
    res.json({ collection: bossRaidFeature.collectionForWeb(req.telegramUser.userId) });
  });

  app.get('/api/team', authMiddleware, (req, res) => {
    res.json({ team: bossRaidFeature.teamForWeb(req.telegramUser.userId) });
  });

  app.post('/api/team', authMiddleware, (req, res) => {
    const result = bossRaidFeature.saveTeamForWeb(req.telegramUser.userId, req.body?.picks);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/raid/:chatId/attack', authMiddleware, async (req, res) => {
    const chatId = Number(req.params.chatId);
    try {
      const result = await bossRaidFeature.attackFromWeb(bot, chatId, req.telegramUser.userId);
      res.json(result);
    } catch (err) {
      console.error(`Web attack failed for chat ${chatId}:`, err.message);
      res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });

  app.get('/api/battle/:matchId/state', authMiddleware, (req, res) => {
    const matchId = Number(req.params.matchId);
    const match = battleFeature.getMatch(matchId);
    if (!match) {
      res.status(404).json({ error: 'no_active_battle' });
      return;
    }
    res.json(battleFeature.sanitizeMatchForWeb(match, req.telegramUser.userId));
  });

  app.post('/api/battle/:matchId/attack', authMiddleware, async (req, res) => {
    const matchId = Number(req.params.matchId);
    const moveIndex = Number(req.body?.moveIndex);
    try {
      const result = await battleFeature.attackFromWeb(bot, matchId, req.telegramUser.userId, moveIndex);
      res.json(result);
    } catch (err) {
      console.error(`Web battle attack failed for match ${matchId}:`, err.message);
      res.status(500).json({ ok: false, reason: 'server_error' });
    }
  });

  // ── Trading ────────────────────────────────────────────────────────────
  function requireTradeParticipant(req, res) {
    const tradeId = Number(req.params.tradeId);
    const trade = tradesDb.getTrade(tradeId);
    if (!trade) {
      res.status(404).json({ error: 'trade_not_found' });
      return null;
    }
    const side = tradesDb.sideFor(trade, req.telegramUser.userId);
    if (!side) {
      res.status(403).json({ error: 'not_a_participant' });
      return null;
    }
    if (trade.status !== 'pending') {
      res.status(409).json({ error: 'trade_not_pending', status: trade.status });
      return null;
    }
    return { trade, side };
  }

  app.get('/api/trade/:tradeId', authMiddleware, (req, res) => {
    const tradeId = Number(req.params.tradeId);
    const trade = tradesDb.getTrade(tradeId);
    if (!trade) {
      res.status(404).json({ error: 'trade_not_found' });
      return;
    }
    if (!tradesDb.sideFor(trade, req.telegramUser.userId)) {
      res.status(403).json({ error: 'not_a_participant' });
      return;
    }
    res.json(tradingFeature.sanitizeTradeForWeb(trade, req.telegramUser.userId));
  });

  // Individual Pokémon instances (not the aggregate /api/collection) — a trade needs to offer a
  // SPECIFIC copy, not "one of my 3 Ho-Oh", now that every Pokémon has a permanent unique ID.
  app.get('/api/trade-collection', authMiddleware, (req, res) => {
    const instances = pokemonInstances.listInstances(req.telegramUser.userId);
    res.json({
      instances: instances.map((i) => ({
        instanceId: i.instance_id,
        speciesName: i.species_name,
        shiny: Boolean(i.shiny),
        rarity: i.base_rarity,
      })),
    });
  });

  app.get('/api/trade-inventory', authMiddleware, (req, res) => {
    const items = inventoryDb.listInventory(req.telegramUser.userId);
    res.json({
      items: items.map((i) => ({
        itemKey: i.item_key,
        quantity: i.quantity,
        label: getItemInfo(i.item_key).label,
        emoji: getItemInfo(i.item_key).emoji,
      })),
    });
  });

  app.post('/api/trade/:tradeId/pokemon', authMiddleware, (req, res) => {
    const ctx = requireTradeParticipant(req, res);
    if (!ctx) return;
    const { instanceId, action } = req.body || {};
    if (!instanceId || (action !== 'add' && action !== 'remove')) {
      res.status(400).json({ ok: false, reason: 'bad_request' });
      return;
    }
    let result;
    if (action === 'add') {
      result = tradesDb.addPokemonToOffer(ctx.trade.id, ctx.side, req.telegramUser.userId, instanceId);
    } else {
      tradesDb.removePokemonFromOffer(ctx.trade.id, instanceId);
      result = { ok: true };
    }
    tradingFeature.emitTradeChange(ctx.trade.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/trade/:tradeId/item', authMiddleware, (req, res) => {
    const ctx = requireTradeParticipant(req, res);
    if (!ctx) return;
    const { itemKey, quantity } = req.body || {};
    if (!itemKey || !Number.isInteger(quantity)) {
      res.status(400).json({ ok: false, reason: 'bad_request' });
      return;
    }
    const result = tradesDb.setItemInOffer(ctx.trade.id, ctx.side, req.telegramUser.userId, itemKey, quantity);
    tradingFeature.emitTradeChange(ctx.trade.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/trade/:tradeId/coins', authMiddleware, (req, res) => {
    const ctx = requireTradeParticipant(req, res);
    if (!ctx) return;
    const amount = Number(req.body?.amount);
    const result = tradesDb.setCoinsInOffer(ctx.trade.id, ctx.side, req.telegramUser.userId, ctx.trade.chat_id, amount);
    tradingFeature.emitTradeChange(ctx.trade.id);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post('/api/trade/:tradeId/ready', authMiddleware, (req, res) => {
    const ctx = requireTradeParticipant(req, res);
    if (!ctx) return;
    const ready = req.body?.ready !== false;
    tradesDb.setReady(ctx.trade.id, ctx.side, ready);
    tradingFeature.emitTradeChange(ctx.trade.id);
    res.json({ ok: true });
  });

  app.post('/api/trade/:tradeId/cancel', authMiddleware, (req, res) => {
    const tradeId = Number(req.params.tradeId);
    const trade = tradesDb.getTrade(tradeId);
    if (!trade || trade.status !== 'pending' || !tradesDb.sideFor(trade, req.telegramUser.userId)) {
      res.status(404).json({ ok: false });
      return;
    }
    tradesDb.cancelTrade(tradeId, 'cancelled');
    tradingFeature.emitTradeChange(tradeId);
    res.json({ ok: true });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const raidSubscribers = new Map(); // chatId -> Set(ws)
  const battleSubscribers = new Map(); // matchId -> Set(ws)
  const tradeSubscribers = new Map(); // tradeId -> Set(ws)

  // Same /ws endpoint serves all three surfaces — distinguished by which id the query string
  // carries (`chatId` for raids, `matchId` for battles, `tradeId` for trades) rather than a
  // separate path, so the already-deployed raid arena's connect URL (`?chatId=...`) keeps
  // working unchanged.
  wss.on('connection', (ws, req) => {
    let url;
    try {
      url = new URL(req.url, `http://localhost:${WEBAPP_PORT}`);
    } catch (err) {
      ws.close(4000, 'bad_request');
      return;
    }
    const auth = validateInitData(url.searchParams.get('initData'));
    if (!auth) {
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.userId = auth.userId;

    const tradeIdParam = url.searchParams.get('tradeId');
    if (tradeIdParam !== null) {
      const tradeId = Number(tradeIdParam);
      if (!Number.isFinite(tradeId)) {
        ws.close(4001, 'unauthorized');
        return;
      }
      const trade = tradesDb.getTrade(tradeId);
      if (!trade || !tradesDb.sideFor(trade, auth.userId)) {
        ws.close(4003, 'not_a_participant');
        return;
      }
      ws.tradeId = tradeId;
      if (!tradeSubscribers.has(tradeId)) tradeSubscribers.set(tradeId, new Set());
      tradeSubscribers.get(tradeId).add(ws);

      ws.send(JSON.stringify({ type: 'state', trade: tradingFeature.sanitizeTradeForWeb(trade, auth.userId) }));

      ws.on('close', () => tradeSubscribers.get(tradeId)?.delete(ws));
      ws.on('error', () => tradeSubscribers.get(tradeId)?.delete(ws));
      return;
    }

    const matchIdParam = url.searchParams.get('matchId');
    if (matchIdParam !== null) {
      const matchId = Number(matchIdParam);
      if (!Number.isFinite(matchId)) {
        ws.close(4001, 'unauthorized');
        return;
      }
      ws.matchId = matchId;
      if (!battleSubscribers.has(matchId)) battleSubscribers.set(matchId, new Set());
      battleSubscribers.get(matchId).add(ws);

      const match = battleFeature.getMatch(matchId);
      if (match) {
        ws.send(JSON.stringify({ type: 'state', battle: battleFeature.sanitizeMatchForWeb(match, auth.userId) }));
      }

      ws.on('close', () => battleSubscribers.get(matchId)?.delete(ws));
      ws.on('error', () => battleSubscribers.get(matchId)?.delete(ws));
      return;
    }

    const chatId = Number(url.searchParams.get('chatId'));
    if (!Number.isFinite(chatId)) {
      ws.close(4001, 'unauthorized');
      return;
    }
    ws.chatId = chatId;
    if (!raidSubscribers.has(chatId)) raidSubscribers.set(chatId, new Set());
    raidSubscribers.get(chatId).add(ws);

    // Send the current state immediately on connect, don't make the client wait for the
    // next change to see anything.
    const raid = bossRaidFeature.getRaid(chatId);
    if (raid) {
      ws.send(JSON.stringify({ type: 'state', raid: bossRaidFeature.sanitizeRaidForWeb(raid, auth.userId) }));
    }

    ws.on('close', () => raidSubscribers.get(chatId)?.delete(ws));
    ws.on('error', () => raidSubscribers.get(chatId)?.delete(ws));
  });

  bossRaidFeature.onRaidChange((raid) => {
    const subs = raidSubscribers.get(raid.chatId);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(JSON.stringify({ type: 'state', raid: bossRaidFeature.sanitizeRaidForWeb(raid, ws.userId) }));
      } catch (err) {
        console.error('Failed to push raid update over WebSocket:', err.message);
      }
    }
  });

  battleFeature.onBattleChange((match) => {
    const subs = battleSubscribers.get(match.id);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(JSON.stringify({ type: 'state', battle: battleFeature.sanitizeMatchForWeb(match, ws.userId) }));
      } catch (err) {
        console.error('Failed to push battle update over WebSocket:', err.message);
      }
    }
  });

  tradingFeature.onTradeChange((trade) => {
    const subs = tradeSubscribers.get(trade.id);
    if (!subs || subs.size === 0) return;
    for (const ws of subs) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(JSON.stringify({ type: 'state', trade: tradingFeature.sanitizeTradeForWeb(trade, ws.userId) }));
      } catch (err) {
        console.error('Failed to push trade update over WebSocket:', err.message);
      }
    }
  });

  server.listen(WEBAPP_PORT, () => {
    console.log(`[webapp] Raid Mini App server listening on port ${WEBAPP_PORT}`);
  });

  return server;
}

module.exports = { startWebAppServer };
