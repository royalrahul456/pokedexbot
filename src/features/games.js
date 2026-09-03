const { Markup } = require('telegraf');
const { bold, HTML, brandTag } = require('../utils/text');
const { GAME_RULES, formatRules } = require('../data/gameRules');

function menuKeyboard() {
  const rows = Object.entries(GAME_RULES).map(([key, game]) => [
    Markup.button.callback(`${game.emoji} ${game.title}`, `games:rules:${key}`),
  ]);
  return Markup.inlineKeyboard(rows);
}

function rulesKeyboard() {
  return Markup.inlineKeyboard([[Markup.button.callback('⬅️ Back to Games', 'games:menu')]]);
}

function menuText() {
  return [
    brandTag(),
    bold('🎮 Mini-Games'),
    '',
    "Free-time games you can play between spawns — tap one below to see how it works.",
  ].join('\n');
}

function register(bot) {
  bot.command('games', async (ctx) => {
    await ctx.reply(menuText(), { ...HTML, ...menuKeyboard() });
  });

  bot.action('games:menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText(menuText(), { ...HTML, ...menuKeyboard() });
  });

  bot.action(/^games:rules:(\w+)$/, async (ctx) => {
    const key = ctx.match[1];
    const text = formatRules(key);
    if (!text) {
      await ctx.answerCbQuery('Unknown game.');
      return;
    }
    await ctx.answerCbQuery();
    await ctx.editMessageText(text, { ...HTML, ...rulesKeyboard() });
  });
}

module.exports = { register };
