const SIMPLE_NUMBERS = new Map([
  ['un', 1],
  ['una', 1],
  ['uno', 1],
  ['dos', 2],
  ['tres', 3],
  ['cuatro', 4],
  ['cinco', 5],
  ['seis', 6],
  ['siete', 7],
  ['ocho', 8],
  ['nueve', 9],
  ['diez', 10],
  ['once', 11],
  ['doce', 12],
  ['trece', 13],
  ['catorce', 14],
  ['quince', 15],
  ['dieciseis', 16],
  ['diecisiete', 17],
  ['dieciocho', 18],
  ['diecinueve', 19],
  ['veinte', 20],
  ['veintiuno', 21],
  ['veintiuna', 21],
  ['veintidos', 22],
  ['veintitres', 23],
  ['veinticuatro', 24],
  ['veinticinco', 25],
  ['veintiseis', 26],
  ['veintisiete', 27],
  ['veintiocho', 28],
  ['veintinueve', 29]
]);

const TENS = new Map([
  ['treinta', 30],
  ['cuarenta', 40],
  ['cincuenta', 50],
  ['sesenta', 60],
  ['setenta', 70],
  ['ochenta', 80],
  ['noventa', 90]
]);

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('es-MX')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokenize(value) {
  const normalized = normalizeText(value);
  return normalized === '' ? [] : normalized.split(' ');
}

export function parseSpanishNumberAt(tokens, startIndex) {
  const token = tokens[startIndex];
  if (token === undefined) {
    return null;
  }

  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return value > 0 ? { value, length: 1 } : null;
  }

  const simpleNumber = SIMPLE_NUMBERS.get(token);
  if (simpleNumber !== undefined) {
    return { value: simpleNumber, length: 1 };
  }

  const tens = TENS.get(token);
  if (tens === undefined) {
    return null;
  }

  if (tokens[startIndex + 1] !== 'y') {
    return { value: tens, length: 1 };
  }

  const ones = SIMPLE_NUMBERS.get(tokens[startIndex + 2]);
  if (ones === undefined || ones > 9) {
    return null;
  }

  return { value: tens + ones, length: 3 };
}

export function normalizeQuantity(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  const tokens = tokenize(value);
  const parsed = parseSpanishNumberAt(tokens, 0);
  return parsed && parsed.length === tokens.length ? parsed.value : normalizeText(value);
}

export function buildAliasCatalog(aliases) {
  if (aliases === null || Array.isArray(aliases) || typeof aliases !== 'object') {
    throw new TypeError('aliases must be an object');
  }

  const forms = new Map();
  for (const [canonical, variants] of Object.entries(aliases)) {
    if (!Array.isArray(variants)) {
      throw new TypeError(`aliases.${canonical} must be an array`);
    }

    for (const form of [canonical, ...variants]) {
      const normalizedForm = normalizeText(form);
      if (normalizedForm === '') {
        throw new TypeError(`aliases.${canonical} contains an empty value`);
      }
      const existing = forms.get(normalizedForm);
      if (existing && existing !== canonical) {
        throw new Error(`alias "${form}" maps to both "${existing}" and "${canonical}"`);
      }
      forms.set(normalizedForm, canonical);
    }
  }

  return [...forms.entries()]
    .map(([form, canonical]) => ({ form, canonical, tokens: form.split(' ') }))
    .sort((left, right) => right.tokens.length - left.tokens.length);
}

export function matchAliasAt(tokens, startIndex, catalog) {
  for (const alias of catalog) {
    const matches = alias.tokens.every(
      (token, offset) => tokens[startIndex + offset] === token
    );
    if (matches) {
      return alias;
    }
  }
  return null;
}

export function canonicalizeLexical(value, aliases) {
  const normalized = normalizeText(value);
  const match = buildAliasCatalog(aliases).find((alias) => alias.form === normalized);
  return match?.canonical ?? normalized;
}
