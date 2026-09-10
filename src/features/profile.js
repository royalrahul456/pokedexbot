const users = require('../db/users');
const streaks = require('../db/streaks');
const cosmeticsDb = require('../db/cosmetics');
const pokemonInstances = require('../db/pokemonInstances');
const { formatProfile } = require('../utils/format');
const { generateProfileCard } = require('../utils/cardGenerator');
const { escapeHtml, bold, HTML } = require('../utils/text');

async function showProfile(ctx) {
  try {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;
    users.getOrCreateUser(chatId, userId, username);

    const profile = users.getProfile(chatId, userId);
    const streak = streaks.getStreak(chatId, userId);
    const rank = users.getRank(chatId, userId);
    const equipped = cosmeticsDb.getEquipped(userId);

    const formattedText = formatProfile(profile, streak, rank, equipped);

    // 1. Get User Telegram Avatar URL (with 2s timeout safeguard)
    let avatarUrl = null;
    try {
      const avatarPromise = (async () => {
        const photos = await ctx.telegram.getUserProfilePhotos(userId, 0, 1);
        if (photos && photos.total_count > 0 && photos.photos[0] && photos.photos[0].length > 0) {
          const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
          const link = await ctx.telegram.getFileLink(fileId);
          return typeof link === 'string' ? link : (link.href || link.toString());
        }
        return null;
      })();

      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 2000));
      avatarUrl = await Promise.race([avatarPromise, timeoutPromise]);
    } catch (err) {
      // Silent fallback if avatar fetching fails
    }

    // 2. Get Featured Pokémon (latest caught species, or Pikachu default)
    let featuredSpeciesName = 'Pikachu';
    try {
      const collection = pokemonInstances.listInstances(userId);
      if (collection && collection.length > 0) {
        featuredSpeciesName = collection[0].species_name;
      }
    } catch (err) {
      // Silent fallback
    }

    // 3. Generate dynamic profile card graphic & reply with photo + text caption
    try {
      const cardBuffer = await generateProfileCard({
        user: profile,
        streak,
        rank,
        avatarUrl,
        featuredSpeciesName,
      });

      return await ctx.replyWithPhoto(
        { source: cardBuffer, filename: 'profile_card.png' },
        { caption: formattedText, parse_mode: 'HTML' }
      );
    } catch (err) {
      console.error('Failed to send graphic profile card photo, falling back to text:', err.message || err);
      return await ctx.reply(formattedText, HTML);
    }
  } catch (err) {
    console.error('Error in showProfile:', err.message || err);
    return await ctx.reply('<blockquote>An error occurred while loading your profile. Please try again.</blockquote>', HTML);
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
