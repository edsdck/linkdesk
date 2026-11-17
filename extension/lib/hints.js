// Jump letters (as in AceJump and Vimium): every target gets a short code of letters.

// Home row first, so the most common codes are the easiest to type.
export const HINT_KEYS = 'asdfghjklqwertyuiopzxcvbnm';

// `n` codes, none a prefix of another, so a code is complete as soon as it is typed.
// Single letters while they last, then two letters, and so on; earlier targets get the
// shorter codes.
export function hintCodes(n, keys = HINT_KEYS) {
  if (n <= 0) return [];
  const codes = [''];
  let used = 0; // codes[0..used) became prefixes of longer ones
  while (codes.length - used < n) {
    const prefix = codes[used];
    used += 1;
    for (const key of keys) codes.push(prefix + key);
  }
  const result = codes.slice(used, used + n);
  // Shorter first, so the first targets (reading order) keep single letters where possible.
  return result.sort((a, b) => a.length - b.length);
}
