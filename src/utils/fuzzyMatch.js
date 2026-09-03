// Standard edit-distance DP — how many single-character insert/delete/substitute
// operations turn `a` into `b`.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Accepts a guess that's an exact match or a genuine small typo (at most 1-2 characters off,
// scaled slightly down for very short names since a 2-character difference on something like
// "Mew" is basically a different word). Tightened 2026-07-23 — the previous version also
// accepted a *phonetic* (Soundex) match, e.g. "Zoobat" for Zubat or "Evi"/"Eve" for Eevee, which
// let players win with guesses that weren't actually close to the real spelling at all. With
// 231 species now in the roster (up from 107), that phonetic path was producing real false
// positives (guesses landing on the wrong intended Pokémon by sound-alike coincidence) and made
// the games too easy to win without actually knowing the name. Removed entirely — spelling now
// has to be genuinely close, not just "sounds kind of similar."
//
// `knownNames` (optional): the full pool of valid names this guess could be drawn from. If the
// guess is an *exact* match for a name other than the current answer, it's always treated as an
// intentional (if wrong) guess of that other Pokémon — never fuzzy-credited toward the real
// answer. Without this guard, real evolution-line pairs like Machop/Machamp or Latios/Latias
// are close enough in spelling to falsely accept one for the other.
function isCloseMatch(guess, answer, knownNames = []) {
  const g = guess.trim().toLowerCase();
  const a = answer.trim().toLowerCase();
  if (!g) return false;
  if (g === a) return true;

  const isExactOtherKnownName = knownNames.some((name) => {
    const n = name.toLowerCase();
    return n === g && n !== a;
  });
  if (isExactOtherKnownName) return false;

  const distance = levenshtein(g, a);
  const threshold = a.length <= 5 ? 1 : 2;
  return distance <= threshold;
}

module.exports = { isCloseMatch, levenshtein };
