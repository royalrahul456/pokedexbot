const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { getPokedexEntry, formatDexId, getArtworkUrl } = require('../data/pokemon');
const { rankForLevel } = require('./levels');

// Default fallback images
const DEFAULT_AVATAR = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png';
const DEFAULT_POKEMON_ART = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png';

/**
 * Helper to draw a rounded rectangle path
 */
function drawRoundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Safely load an image from URL or buffer, fallback to default if error
 */
async function safeLoadImage(src, fallbackSrc) {
  if (!src) src = fallbackSrc;
  try {
    return await loadImage(src);
  } catch (err) {
    if (src !== fallbackSrc && fallbackSrc) {
      try {
        return await loadImage(fallbackSrc);
      } catch (e) {
        return null;
      }
    }
    return null;
  }
}

/**
 * Generate player profile card canvas buffer
 */
async function generateProfileCard({ user, streak, rank, avatarUrl, featuredSpeciesName }) {
  const width = 1200;
  const height = 675;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Outer Dark Emerald Gradient Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#041007');
  bgGrad.addColorStop(0.5, '#0b2413');
  bgGrad.addColorStop(1, '#030a05');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle radial glow behind right artwork
  const glowGrad = ctx.createRadialGradient(955, 337, 50, 955, 337, 400);
  glowGrad.addColorStop(0, 'rgba(46, 204, 113, 0.22)');
  glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Left Glass Card Container
  const leftX = 40;
  const leftY = 40;
  const leftW = 680;
  const leftH = 595;
  const leftRadius = 24;

  drawRoundRect(ctx, leftX, leftY, leftW, leftH, leftRadius);
  ctx.fillStyle = 'rgba(15, 35, 21, 0.75)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.35)';
  ctx.stroke();

  // 3. User Avatar Box
  const avX = leftX + 30;
  const avY = leftY + 30;
  const avSize = 90;
  const avRadius = 20;

  // Background for avatar
  drawRoundRect(ctx, avX, avY, avSize, avSize, avRadius);
  ctx.fillStyle = '#0a1a0e';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.stroke();

  // Load avatar image
  const avatarImg = await safeLoadImage(avatarUrl, DEFAULT_AVATAR);
  if (avatarImg) {
    ctx.save();
    drawRoundRect(ctx, avX, avY, avSize, avSize, avRadius);
    ctx.clip();
    ctx.drawImage(avatarImg, avX, avY, avSize, avSize);
    ctx.restore();
  }

  // 4. User Name & ID
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px sans-serif';
  const nameText = user.username ? `@${user.username}` : 'Trainer';
  ctx.fillText(nameText, avX + avSize + 24, avY + 40);

  ctx.fillStyle = '#94bda2';
  ctx.font = 'bold 20px monospace';
  ctx.fillText(`ID: ${user.user_id || user.id}`, avX + avSize + 24, avY + 72);

  // 5. Stat Boxes Row 1: Catches & Shinies
  const boxY = avY + avSize + 30;
  const boxW = 295;
  const boxH = 90;
  const boxRadius = 16;

  // Box 1: Catches
  const box1X = leftX + 30;
  drawRoundRect(ctx, box1X, boxY, boxW, boxH, boxRadius);
  ctx.fillStyle = 'rgba(6, 20, 11, 0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();

  ctx.fillStyle = '#81c784';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('CATCHES', box1X + 24, boxY + 36);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText((user.catches || 0).toLocaleString(), box1X + 24, boxY + 72);

  // Box 2: Shinies
  const box2X = box1X + boxW + 30;
  drawRoundRect(ctx, box2X, boxY, boxW, boxH, boxRadius);
  ctx.fillStyle = 'rgba(6, 20, 11, 0.8)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.stroke();

  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('SHINIES', box2X + 24, boxY + 36);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText((user.shiny_count || 0).toLocaleString(), box2X + 24, boxY + 72);

  // 6. Middle Currency Box (Coins)
  const coinY = boxY + boxH + 20;
  const coinW = leftW - 60;
  const coinH = 100;

  drawRoundRect(ctx, leftX + 30, coinY, coinW, coinH, boxRadius);
  ctx.fillStyle = 'rgba(6, 20, 11, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.25)';
  ctx.stroke();

  // Draw custom coin badge circle
  ctx.beginPath();
  ctx.arc(leftX + 75, coinY + 50, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd700';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffa000';
  ctx.stroke();

  ctx.fillStyle = '#5d4037';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText('P', leftX + 68, coinY + 58);

  // Coin Value
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText((user.coins || 0).toLocaleString(), leftX + 115, coinY + 62);

  ctx.fillStyle = '#a5d6a7';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('COINS BALANCE', leftX + coinW - 140, coinY + 60);

  // 7. Bottom Ranks & Level Section
  const rankY = coinY + coinH + 30;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftX + 30, rankY);
  ctx.lineTo(leftX + leftW - 30, rankY);
  ctx.stroke();

  const rankTitle = rankForLevel(user.level || 1);
  const currentStreak = streak?.current_streak || 0;
  const groupRankText = rank ? `#${rank}` : 'Unranked';

  // Item 1: Group Rank
  ctx.fillStyle = '#c8e6c9';
  ctx.font = '22px sans-serif';
  ctx.fillText('Group Rank -', leftX + 30, rankY + 42);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 24px monospace';
  ctx.fillText(groupRankText, leftX + leftW - 160, rankY + 42);

  // Item 2: Trainer Level & Rank Title
  ctx.fillStyle = '#c8e6c9';
  ctx.font = '22px sans-serif';
  ctx.fillText('Trainer Rank -', leftX + 30, rankY + 86);
  ctx.fillStyle = '#4caf50';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`Lvl ${user.level || 1} (${rankTitle})`, leftX + leftW - 280, rankY + 86);

  // Item 3: Daily Streak
  ctx.fillStyle = '#c8e6c9';
  ctx.font = '22px sans-serif';
  ctx.fillText('Daily Streak -', leftX + 30, rankY + 130);
  ctx.fillStyle = '#ff9800';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`${currentStreak} Days`, leftX + leftW - 160, rankY + 130);

  // 8. Right Featured Pokémon Container & Artwork
  const rightX = 750;
  const rightY = 40;
  const rightW = 410;
  const rightH = 595;
  const rightRadius = 24;

  drawRoundRect(ctx, rightX, rightY, rightW, rightH, rightRadius);
  ctx.fillStyle = 'rgba(15, 35, 21, 0.75)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.4)';
  ctx.stroke();

  // Determine Pokémon Artwork URL
  let pokeArtUrl = DEFAULT_POKEMON_ART;
  let pokeName = 'Pikachu';
  let dexIdStr = '#025';

  if (featuredSpeciesName) {
    const entry = getPokedexEntry(featuredSpeciesName);
    if (entry && entry.dexNumber) {
      pokeArtUrl = getArtworkUrl(entry.dexNumber);
      pokeName = featuredSpeciesName;
      dexIdStr = formatDexId(entry.dexNumber);
    }
  }

  // Load and draw Pokémon Artwork inside right container
  const pokeImg = await safeLoadImage(pokeArtUrl, DEFAULT_POKEMON_ART);
  if (pokeImg) {
    ctx.save();
    drawRoundRect(ctx, rightX + 15, rightY + 15, rightW - 30, rightH - 70, rightRadius - 4);
    ctx.clip();

    // Draw image centered and scaled
    const padding = 20;
    const drawW = rightW - 30 - padding * 2;
    const drawH = rightH - 100 - padding * 2;
    ctx.drawImage(pokeImg, rightX + 15 + padding, rightY + 30 + padding, drawW, drawH);
    ctx.restore();
  }

  // Bottom Label on Right Container
  drawRoundRect(ctx, rightX + 20, rightY + rightH - 65, rightW - 40, 48, 14);
  ctx.fillStyle = 'rgba(4, 16, 7, 0.9)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(46, 204, 113, 0.3)';
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`${dexIdStr} ${pokeName}`, rightX + 40, rightY + rightH - 34);

  return await canvas.encode('png');
}

module.exports = { generateProfileCard };
