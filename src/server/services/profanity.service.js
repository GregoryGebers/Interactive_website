'use strict';

// ---- Chat filtering ---------------------------------------------------------
// The filter runs SERVER-SIDE so it can't be bypassed by editing client code.
// Primary list: the `leo-profanity` package (community-maintained). Install it
// with `npm install leo-profanity`. If it isn't installed we fall back to a
// small built-in list so chat still gets basic filtering instead of none.

let profanityFilter = null;
try {
  profanityFilter = require('leo-profanity');
} catch (e) {
  console.warn('[chat] leo-profanity not installed — using minimal fallback list. Run: npm install leo-profanity');
}

const FALLBACK_BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'bastard',
  'slut', 'whore', 'pussy', 'douche', 'wanker'
];

// Merge the fallback words INTO leo-profanity too (its default list has a few
// surprising gaps, e.g. "whore"), so both its clean() pass and our evasion
// pass below see the same complete list.
if (profanityFilter) {
  try { profanityFilter.add(FALLBACK_BAD_WORDS); } catch (e) {}
}

// One lowercase Set for fast whole-word lookups in the evasion check below.
const badWordSet = new Set(
  (profanityFilter ? profanityFilter.list() : FALLBACK_BAD_WORDS)
    .map(w => String(w).toLowerCase())
);

// Common letter->symbol substitutions people use to sneak words past filters
// ("f4ck", "sh!t", "b1tch"). Mapped back to letters before checking.
const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '6': 'g', '7': 't', '8': 'b', '@': 'a', '$': 's',
  '!': 'i', '+': 't', '€': 'e', '£': 'l'
};

// Reduce a token to bare lowercase letters: map leetspeak, drop everything
// that isn't a-z (so "f.u.c.k" collapses too).
function lettersOnly(token) {
  let out = '';
  for (const ch of String(token).toLowerCase()) {
    const mapped = LEET_MAP[ch] || ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

// Collapse repeated letters ("fuuuuck" -> "fuck"). Checked as a SECOND form
// alongside the plain one — never instead of it — because collapsing can also
// mangle innocent words (e.g. "assess"), and we only ever compare whole tokens
// against the list (no substring matching), which avoids false-positives on
// words that merely contain a bad word.
function collapseRepeats(s) {
  return s.replace(/(.)\1+/g, '$1');
}

// A symbol or digit stuck inside a word ("f4ck", "sh!t", "a$$hole") is really
// being used as a wildcard for whatever letter it replaced — the writer isn't
// being phonetic, they're dodging the filter. So build a regex from the token
// where each non-letter matches any single optional letter, and test it
// against the word list. Only kicks in for tokens that actually contain
// non-letters, so ordinary words never take this path.
function wildcardRegexFor(token) {
  const lower = String(token).toLowerCase();
  let pattern = '';
  let hasWildcard = false;
  let letterCount = 0;
  for (const ch of lower) {
    if (ch >= 'a' && ch <= 'z') {
      pattern += ch;
      letterCount++;
    } else {
      pattern += '[a-z]?';
      hasWildcard = true;
    }
  }
  // Need at least a couple of real letters, or something like "!!" would match
  // half the list.
  if (!hasWildcard || letterCount < 2) return null;
  return new RegExp('^' + pattern + '$');
}

function isBadToken(token) {
  const plain = lettersOnly(token);
  if (!plain) return false;
  if (badWordSet.has(plain) || badWordSet.has(collapseRepeats(plain))) return true;

  const re = wildcardRegexFor(token);
  if (re) {
    for (const bad of badWordSet) {
      if (re.test(bad)) return true;
    }
  }
  return false;
}

/**
 * Censor a chat message. Two passes: the library cleaner, then a
 * leetspeak/spacing evasion check that fully stars out any token which
 * normalizes into a listed word.
 * @param {string} message
 * @returns {string}
 */
function censorChatMessage(message) {
  let msg = message;

  // Pass 1: the library's own cleaner (replaces listed words with ****).
  if (profanityFilter) {
    try {
      msg = profanityFilter.clean(msg);
    } catch (e) {
      console.error('[chat] profanity filter error:', e);
    }
  }

  // Pass 2: leetspeak/spacing-evasion check, token by token.
  return msg
    .split(' ')
    .map(word => (isBadToken(word) ? '*'.repeat(word.length) : word))
    .join(' ');
}

module.exports = {
  censorChatMessage,
  // Exported for unit testing of the evasion logic.
  lettersOnly,
  collapseRepeats,
  wildcardRegexFor,
  isBadToken,
};
