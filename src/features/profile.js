const users = require('../db/users');
const streaks = require('../db/streaks');
const cosmeticsDb = require('../db/cosmetics');
const pokemonInstances = require('../db/pokemonInstances');
const { formatProfile } = require('../utils/format');
const { generateProfileCard } = require('../utils/cardGenerator');
const { escapeHtml, bold, HTML } = require('../utils/text');

async function showProfile(ctx) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name;
  users.getOrCreateUser(chatId, userId, username);

  const profile = users.getProfile(chatId, userId);
  const streak = streaks.getStreak(chatId, userId);
  const rank = users.getRank(chatId, userId);
  const equipped = cosmeticsDb.getEquipped(userId);

  // 1. Get User Telegram Avatar URL (if accessible)
  let avatarUrl = null;
  try {
    const photos = await ctx.telegram.getUserProfilePhotos(userId, { limit: 1 });
    if (photos && photos.total_count > 0 && photos.photos[0] && photos.photos[0].length > 0) {
      const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
      const link = await ctx.telegram.getFileLink(fileId);
      avatarUrl = link.href || link.toString();
    }
  } catch (err) {
    // Silent fallback if avatar fetching is restricted
  }

  // 2. Get Featured Pokémon (latest caught, or Pikachu fallback)
  let featuredSpeciesName = 'Pikachu';
  try {
    const collection = pokemonInstances.listInstances(userId);
    if (collection && collection.length > 0) {
      featuredSpeciesName = collection[0].species_name;
    }
  } catch (err) {
    // Silent fallback
  }

  // 3. Generate dynamic profile card graphic
  try {
    const cardBuffer = await generateProfileCard({
      user: profile,
      streak,
      rank,
      avatarUrl,
      featuredSpeciesName,
    });

    const caption = `<b>👤 ${escapeHtml(profile.username || 'Trainer')}'s Profile Card</b>\n\nLevel <b>${profile.level}</b> • <b>${(profile.coins || 0).toLocaleString()} Coins</b> • Rank <b>#${rank || 'N/A'}</b>`;

    return await ctx.replyWithPhoto(
      { source: cardBuffer },
      { caption, parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('Failed to generate image profile card, using text fallback:', err);
    return ctx.reply(formatProfile(profile, streak, rank, equipped), HTML);
  }
}

function showLeaderboard(ctx) {
  const rows = users.getLeaderboard(ctx.chat.id, 10);
  if (rows.length === 0) {
    return ctx.reply('<blockquote>No trainers ranked yet — be the first to earn XP!</blockquote>', HTML);
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = rows.map((u, i) => {
    const rankIcon = medals[i] || `${i + 1}.`;
    return `${rankIcon} ${bold(escapeHtml(u.username || 'Trainer'))} — Lv${u.level} (${u.xp} XP)`;
  });
  return ctx.reply(`<blockquote>\n${bold('🏆 Trainer Leaderboard')}\n\n${lines.join('\n')}\n</blockquote>`, HTML);
}

function register(bot) {
  bot.command(['profile', 'me'], showProfile);
  bot.command(['leaderboard', 'top'], showLeaderboard);
}

module.exports = { register, showProfile, showLeaderboard };
