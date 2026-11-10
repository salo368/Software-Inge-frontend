/**
 * Ranking for the search-as-you-type selects: given what the user typed,
 * orders the options from most to least likely and says which part matched,
 * so it can be highlighted.
 *
 * Matching ignores case and accents ("bogota" finds "Bogotá D.C.", "narino"
 * finds "Nariño") because people rarely type tildes.
 */

/**
 * Lower-cases and strips accents keeping the SAME length as the input, so a
 * match position found in the folded text points at the same place in the
 * original label ("Nariño" -> "narino", both 6 characters).
 */
export function fold(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const base = text[i].normalize('NFD')[0] ?? text[i];
    out += base.toLowerCase()[0] ?? base;
  }
  return out;
}

const isWordChar = (c: string) => /[\p{L}\p{N}]/u.test(c);

/** Indexes where a word starts: after any non-letter/digit ("san andres" -> 0 and 4). */
function wordStarts(folded: string): number[] {
  const starts: number[] = [];
  for (let i = 0; i < folded.length; i++) {
    if (isWordChar(folded[i]) && (i === 0 || !isWordChar(folded[i - 1]))) starts.push(i);
  }
  return starts;
}

export interface Match {
  /** Higher is better. 0 for an empty query. */
  score: number;
  /** Range of the original label to highlight. */
  start: number;
  end: number;
}

/**
 * Scores one label against the query, or `null` when it doesn't match:
 *
 *   1000  exactly the label
 *    900  label starts with the query            ("col"  -> "Colombia")
 *    700  query starts a word inside the label   ("paz"  -> "La Paz")
 *    500  query appears inside a word            ("bia"  -> "Colombia")
 *    600  every typed word starts a word         ("san an" -> "San Andrés")
 *    300  every typed word appears somewhere
 */
export function scoreLabel(label: string, query: string): Match | null {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (!q) return { score: 0, start: 0, end: 0 };

  const f = fold(label);
  if (f === q) return { score: 1000, start: 0, end: f.length };
  if (f.startsWith(q)) return { score: 900 - (f.length - q.length) * 0.01, start: 0, end: q.length };

  const starts = wordStarts(f);
  const at = f.indexOf(q);
  if (at >= 0) {
    return {
      score: (starts.includes(at) ? 700 : 500) - at * 0.5,
      start: at,
      end: at + q.length,
    };
  }

  const tokens = q.split(' ');
  if (tokens.length > 1) {
    const hits = tokens.map((t) => f.indexOf(t));
    if (hits.every((i) => i >= 0)) {
      const allAtWordStart = hits.every((i) => starts.includes(i));
      return { score: allAtWordStart ? 600 : 300, start: hits[0], end: hits[0] + tokens[0].length };
    }
  }
  return null;
}

export interface Ranked<T> extends Match {
  item: T;
}

/**
 * Match against extra search text that isn't shown (a dial code, an alias). An exact
 * word beats a prefix so "1" finds +1 before +1242; a number only matches the start of
 * a code. Nothing is highlighted because the text isn't in the label.
 */
function scoreKeywords(keywords: string, query: string): Match | null {
  const q = fold(query).trim().replace(/^\+/, '');
  if (!q) return null;
  const words = fold(keywords).split(/\s+/).map((w) => w.replace(/^\+/, ''));
  if (words.some((w) => w === q)) return { score: 650, start: 0, end: 0 };
  // A number is typed from the start of a code: "57" must not find +257 or +357.
  if (/^\d+$/.test(q)) return words.some((w) => w.startsWith(q)) ? { score: 450, start: 0, end: 0 } : null;
  const m = scoreLabel(keywords, query);
  return m ? { score: m.score * 0.5, start: 0, end: 0 } : null;
}

/**
 * Options that match, best first. Ties go to the higher `priority` (e.g. the usual
 * country of a shared dial code), then the shorter label (the more specific one),
 * then alphabetical. An empty query keeps the given order.
 */
export function rankOptions<T extends { label: string; keywords?: string; priority?: number }>(
  options: readonly T[],
  query: string,
): Ranked<T>[] {
  const ranked: Ranked<T>[] = [];
  for (const item of options) {
    const m = scoreLabel(item.label, query) ?? (item.keywords ? scoreKeywords(item.keywords, query) : null);
    if (m) ranked.push({ item, ...m });
  }
  if (!fold(query).trim()) return ranked;
  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      (b.item.priority ?? 0) - (a.item.priority ?? 0) ||
      a.item.label.length - b.item.label.length ||
      a.item.label.localeCompare(b.item.label, 'es'),
  );
}
