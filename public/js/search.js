import { categories, verification } from './places.js';

export const normalize = (text) => text.toLocaleLowerCase('en')
  .replaceAll('ø', 'o').normalize('NFD').replace(/\p{Diacritic}/gu, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function edits(a, b) {
  const rows = [Array.from({length: b.length + 1}, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j-1]+1, rows[i-1][j]+1, rows[i-1][j-1]+(a[i-1] === b[j-1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) row[j] = Math.min(row[j], rows[i-2][j-2]+1);
    }
    rows.push(row);
  }
  return rows.at(-1).at(-1);
}
const words = (text) => normalize(text).split(' ').filter(Boolean);
const categoryNames = new Map(categories.map((c) => [c.id, c.fullName || c.name]));

function scoreToken(token, targets) {
  let score = 0;
  for (const [word, weight] of targets) {
    if (word === token) score = Math.max(score, weight * 2);
    else if (word.startsWith(token)) score = Math.max(score, weight * 1.4);
    else if (token.length > 2 && word.includes(token)) score = Math.max(score, weight);
    else if (token.length >= 4 && Math.abs(token.length-word.length) <= 2) {
      const distance = edits(token, word);
      if (distance <= (token.length >= 7 ? 2 : 1)) score = Math.max(score, weight * 0.66);
    }
  }
  return score;
}

export function searchPlaces(places, { query = '', category = '', english = '', tags = [] } = {}) {
  const tokens = words(query);
  const phrase = normalize(query);
  return places.flatMap((place) => {
    if (category && !place.categories.includes(category)) return [];
    if (english && place.english.kind !== english) return [];
    if (!tags.every((tag) => place.tags.includes(tag))) return [];
    if (!tokens.length) return [{ place, score: 0 }];
    const groups = [[place.name, 9], [place.subtitle, 6], [place.tags.join(' '), 5],
      [place.categories.map((id) => categoryNames.get(id)).join(' '), 4], [place.address, 3],
      [verification[place.english.kind].name, 3]];
    const targets = groups.flatMap(([value, weight]) => words(value).map((word) => [word, weight]));
    const results = tokens.map((token) => scoreToken(token, targets));
    if (results.includes(0)) return [];
    return [{ place, score: results.reduce((sum, score) => sum + score, 0) + (normalize(place.name).includes(phrase) ? 14 : 0) }];
  }).sort((a, b) => b.score - a.score).map(({ place }) => place);
}
