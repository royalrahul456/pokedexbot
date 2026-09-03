const cron = require('node-cron');
const { Markup } = require('telegraf');
const eggsDb = require('../db/eggs');
const inventory = require('../db/inventory');
const pokemonCollectionDb = require('../db/pokemonCollection');
const users = require('../db/users');
const { COMMON, RARE, LEGENDARY, getPokedexEntry, getArtworkUrl, formatTypeLine } = require('../data/pokemon');
const { getItemInfo } = require('../data/items');
const { grantRewards } = require('../utils/rewards');
const XP = require('../utils/xpValues');
const { escapeHtml, bold, HTML } = require('../utils/text');
const { formatDuration } = require('../utils/format');
const { react } = require('../utils/reactions');

const EGG_KEYS = ['egg_common', 'egg_rare'];
const INCUBATION_MS = { egg_common: 2 * 60 * 60 * 1000, egg_rare: 3 * 60 * 60 * 1000 };
// [pool, weight] pairs per egg type — never mythical, keeps that tier earnable only via wild
// spawns/promo codes so eggs don't quietly become the best way to farm the rarest Pokémon.
const HATCH_POOLS = {
  egg_common: [[COMMON, 80], [RARE, 20]],
  egg_rare: [[RARE, 70], [LEGENDARY, 30]],
};

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPoolPick(pools) {
  const total = pools.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [pool, weight] of pools) {
    if (roll < weight) return pick(pool);
    roll -= weight;
  }
  return pick(pools[0][0]);
}

function eggPickerKeyboard(ownedEggs) {
  const rows = ownedEggs.map(({ key, qty }) => [
    Markup.button.callback(`${getItemInfo(key).emoji} Incubate ${getItemInfo(key).label} (x${qty})`, `egg:start:${key}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function register(bot) {
  bot.command('egg', async (ctx) => {
    const userId = ctx.from.id;
    users.getOrCreateUser(ctx.chat.id, userId, ctx.from.username || ctx.from.first_name);
    const incubation = eggsDb.getIncubation(userId);

    if (incubation) {
      if (eggsDb.isReady(incubation)) {
        await hatchEgg(ctx, incubation);
        return;
      }
      const msRemaining = Date.parse(incubation.ready_at) - Date.now();
      await ctx.reply(
        `🥚 ${bold(getItemInfo(incubation.egg_key).label)} is incubating — ready in ${bold(formatDuration(msRemaining))}.`,
        HTML
      );
      return;
    }

    const ownedEggs = EGG_KEYS.map((key) => ({ key, qty: inventory.getItemQuantity(userId, key) })).filter(
      (e) => e.qty > 0
    );
    if (ownedEggs.length === 0) {
      await ctx.reply("🥚 You don't have any eggs yet — get one from /spin or /chest!");
      return;
    }

    await ctx.reply(
      [bold('🥚 Incubate an Egg'), '', 'Pick one to start incubating (only one egg can incubate at a time):'].join('\n'),
      { ...HTML, ...eggPickerKeyboard(ownedEggs) }
    );
  });

  bot.action(/^egg:start:(egg_common|egg_rare)$/, async (ctx) => {
    const userId = ctx.from.id;
    const eggKey = ctx.match[1];

    if (eggsDb.getIncubation(userId)) {
      await ctx.answerCbQuery('You already have an egg incubating.', { show_alert: true });
      return;
    }
    const consumed = inventory.consumeItem(userId, eggKey);
    if (!consumed) {
      await ctx.answerCbQuery("You don't have that egg anymore.", { show_alert: true });
      return;
    }

    eggsDb.startIncubation(userId, eggKey, INCUBATION_MS[eggKey], ctx.chat.id);
    await ctx.answerCbQuery('Incubation started!');
    await ctx.editMessageText(
      `🥚 ${bold(getItemInfo(eggKey).label)} is now incubating! Ready in ${bold(
        formatDuration(INCUBATION_MS[eggKey])
      )} — check back with /egg.`,
      HTML
    );
  });

  // Checked every 5 minutes — pings whoever's egg just became ready, in the group where they
  // started incubating it, so it isn't easy to forget about (rather than only finding out
  // whenever they happen to run /egg again).
  cron.schedule('*/5 * * * *', async () => {
    for (const incubation of eggsDb.listReadyUnnotified()) {
      try {
        const profile = users.getProfile(incubation.chat_id, incubation.user_id);
        const name = escapeHtml(profile?.username || 'Trainer');
        await bot.telegram.sendMessage(
          incubation.chat_id,
          `🐣 ${bold(name)}, your ${bold(getItemInfo(incubation.egg_key).label)} is ready to hatch! Run /egg to see what you got.`,
          HTML
        );
      } catch (err) {
        console.error(`Failed to send egg-ready notification to chat ${incubation.chat_id}:`, err.message);
      }
      eggsDb.markNotified(incubation.user_id);
    }
  });
}

async function hatchEgg(ctx, incubation) {
  const userId = ctx.from.id;
  eggsDb.clearIncubation(userId);

  const suspense = await ctx.reply(`${bold('🥚 Your egg is hatching...')} 🐣`, HTML);

  const speciesName = weightedPoolPick(HATCH_POOLS[incubation.egg_key]);
  const entry = getPokedexEntry(speciesName);
  const baseRarity = COMMON.includes(speciesName) ? 'common' : RARE.includes(speciesName) ? 'rare' : 'legendary';
  pokemonCollectionDb.recordCatch(userId, speciesName, baseRarity, false);
  const levelUpMsg = grantRewards(ctx.chat.id, userId, { xp: XP.HATCH_EGG });

  const caption = [
    bold(`🐣 It hatched into ${escapeHtml(speciesName)}!`),
    '',
    bold(formatTypeLine(entry.types)),
    '',
    `+${bold(XP.HATCH_EGG)} XP`,
    'Added to your global /collection.',
  ];
  if (levelUpMsg) caption.push('', levelUpMsg);

  const imageUrl = getArtworkUrl(entry.dexNumber, false);
  try {
    if (imageUrl) {
      const sent = await ctx.telegram.sendPhoto(ctx.chat.id, imageUrl, { caption: caption.join('\n'), parse_mode: 'HTML' });
      await react(ctx.telegram, ctx.chat.id, sent.message_id, '🎉');
    } else {
      const sent = await ctx.reply(caption.join('\n'), HTML);
      await react(ctx.telegram, ctx.chat.id, sent.message_id, '🎉');
    }
  } finally {
    try {
      await ctx.telegram.deleteMessage(ctx.chat.id, suspense.message_id);
    } catch (err) {
      // Not fatal if Telegram won't let us delete it (e.g. too old) — leaving the "hatching..."
      // message behind is harmless, the real reveal already posted.
    }
  }
}

module.exports = { register };
