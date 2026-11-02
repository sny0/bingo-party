export const TOTAL = 75;
export const SCHEMA = 1;
export const DEFAULT_SETTINGS = Object.freeze({ title: '忘年会ビンゴ', duration: 3400, volume: 0.4, sound: true });

export function cleanSettings(value = {}) {
  return {
    title: typeof value.title === 'string' ? value.title.trim().slice(0, 36) || DEFAULT_SETTINGS.title : DEFAULT_SETTINGS.title,
    duration: [1800, 3400, 5200].includes(value.duration) ? value.duration : DEFAULT_SETTINGS.duration,
    volume: typeof value.volume === 'number' && Number.isFinite(value.volume) ? Math.max(0, Math.min(1, value.volume)) : DEFAULT_SETTINGS.volume,
    sound: typeof value.sound === 'boolean' ? value.sound : DEFAULT_SETTINGS.sound,
  };
}

export function newGame(settings = DEFAULT_SETTINGS) {
  return { schema: SCHEMA, drawn: [], settings: cleanSettings(settings) };
}

export function decodeGame(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || value.schema !== SCHEMA || !Array.isArray(value.drawn)) {
    throw new Error('ビンゴの履歴ファイルではありません。');
  }
  if (value.drawn.length > TOTAL || value.drawn.some(n => !Number.isInteger(n) || n < 1 || n > TOTAL) || new Set(value.drawn).size !== value.drawn.length) {
    throw new Error('履歴に重複した番号、または1〜75以外の番号があります。');
  }
  return { schema: SCHEMA, drawn: [...value.drawn], settings: cleanSettings(value.settings ?? {}) };
}

export function secureIndex(length, fill = values => globalThis.crypto.getRandomValues(values)) {
  if (!Number.isInteger(length) || length < 1 || length > TOTAL) throw new RangeError('抽選対象の数が正しくありません。');
  const limit = Math.floor(0x100000000 / length) * length;
  const values = new Uint32Array(1);
  do { fill(values); } while (values[0] >= limit);
  return values[0] % length;
}

export function chooseNumber(drawn, index = secureIndex) {
  const used = new Set(drawn);
  const remaining = Array.from({ length: TOTAL }, (_, i) => i + 1).filter(n => !used.has(n));
  if (!remaining.length) return null;
  const selected = index(remaining.length);
  if (!Number.isInteger(selected) || selected < 0 || selected >= remaining.length) throw new RangeError('抽選位置が正しくありません。');
  return remaining[selected];
}

export function commitDraw(game, number) {
  if (!Number.isInteger(number) || number < 1 || number > TOTAL || game.drawn.includes(number)) throw new Error('この番号は追加できません。');
  return { ...game, drawn: [...game.drawn, number] };
}

export function bingoLetter(number) {
  return Number.isInteger(number) && number >= 1 && number <= TOTAL ? 'BINGO'[Math.floor((number - 1) / 15)] : 'BINGO';
}
