import { readFileSync } from 'node:fs';
import {
  buildAliasCatalog,
  matchAliasAt,
  normalizeText,
  parseSpanishNumberAt,
  tokenize
} from './normalize-order.js';

const modifierConfig = JSON.parse(
  readFileSync(new URL('../modifiers.json', import.meta.url), 'utf8')
);
if (!Array.isArray(modifierConfig.modifiers)) {
  throw new TypeError('modifiers.json must contain a modifiers array');
}
const modifiers = new Set(modifierConfig.modifiers.map(normalizeText));
const itemPrefixes = [
  ['media', 'orden', 'de'],
  ['orden', 'de'],
  ['kilo', 'de']
];

function matchStructuredAliasAt(tokens, start, catalog) {
  const exact = matchAliasAt(tokens, start, catalog);
  if (exact) {
    return { ...exact, length: exact.tokens.length };
  }

  for (const alias of catalog) {
    let input = start;
    let expected = 0;
    let skippedNumber = false;

    while (expected < alias.tokens.length && input < tokens.length) {
      if (tokens[input] === alias.tokens[expected]) {
        input += 1;
        expected += 1;
        continue;
      }

      const number = !skippedNumber && expected > 0
        && parseSpanishNumberAt(alias.tokens, expected) === null
        ? parseSpanishNumberAt(tokens, input)
        : null;
      if (!number) {
        break;
      }

      input += number.length;
      if (['pieza', 'piezas'].includes(tokens[input])) {
        input += 1;
        if (tokens[input] === 'de') {
          input += 1;
        }
      }
      skippedNumber = true;
    }

    if (expected === alias.tokens.length) {
      return { ...alias, length: input - start };
    }
  }

  return null;
}

function buildItemNouns(aliases) {
  const nouns = new Map();

  for (const canonical of Object.keys(aliases)) {
    if (modifiers.has(normalizeText(canonical))) {
      continue;
    }

    const tokens = tokenize(canonical);
    const prefix = itemPrefixes.find((candidate) => (
      candidate.every((token, index) => tokens[index] === token)
    )) ?? [];
    const root = tokens.slice(prefix.length);
    if (root.length === 0) {
      continue;
    }

    const candidates = nouns.get(root[0]) ?? [];
    candidates.push({ canonical, prefix, root });
    nouns.set(root[0], candidates);
  }

  return nouns;
}

function postposedPackage(tokens, nounIndex, candidates) {
  const matches = [];

  for (const candidate of candidates) {
    if (candidate.prefix.length === 0 || candidate.root.length !== 1) {
      continue;
    }

    let index = nounIndex + 1;
    if (['un', 'una'].includes(tokens[index])) {
      index += 1;
    }
    if (!candidate.prefix.every((token, offset) => tokens[index + offset] === token)) {
      continue;
    }
    index += candidate.prefix.length;

    const number = parseSpanishNumberAt(tokens, index);
    if (!number || !['pieza', 'piezas'].includes(tokens[index + number.length])) {
      continue;
    }
    matches.push({ candidate, end: index + number.length + 1 });
  }

  return matches.length === 1 ? matches[0] : null;
}

function quantityBefore(tokens, itemStart) {
  if (['unos', 'unas'].includes(tokens[itemStart - 1])) {
    return { value: 1, start: itemStart - 1 };
  }

  for (let start = Math.max(0, itemStart - 3); start < itemStart; start += 1) {
    const quantity = parseSpanishNumberAt(tokens, start);
    if (quantity && start + quantity.length === itemStart) {
      return { value: quantity.value, start };
    }
  }

  return null;
}

export function parseOrder(transcript, options) {
  if (typeof transcript !== 'string') {
    throw new TypeError('transcript must be a string');
  }

  const aliases = options?.aliases;
  const catalog = buildAliasCatalog(aliases);
  const itemNouns = buildItemNouns(aliases);
  const tokens = tokenize(transcript);
  const consumed = new Set();
  const items = [];
  let currentItem = null;

  for (let index = 0; index < tokens.length;) {
    const alias = matchStructuredAliasAt(tokens, index, catalog);
    if (!alias) {
      const candidates = itemNouns.get(tokens[index]);
      if (candidates) {
        const packaged = postposedPackage(tokens, index, candidates);
        const bare = candidates.length === 1 && candidates[0].root.length === 1
          ? candidates[0]
          : null;
        const resolved = packaged?.candidate ?? bare;

        if (resolved) {
          const quantity = quantityBefore(tokens, index);
          currentItem = {
            item: resolved.canonical,
            quantity: quantity?.value ?? 1,
            modifiers: []
          };
          items.push(currentItem);
          if (quantity) {
            for (let consumedIndex = quantity.start; consumedIndex < index; consumedIndex += 1) {
              consumed.add(consumedIndex);
            }
          }
          consumed.add(index);
          if (packaged) {
            for (let consumedIndex = index + 1; consumedIndex < packaged.end; consumedIndex += 1) {
              consumed.add(consumedIndex);
            }
            index = packaged.end;
            continue;
          }
        } else {
          currentItem = null;
        }
      }
      index += 1;
      continue;
    }

    const aliasEnd = index + alias.length;
    if (modifiers.has(normalizeText(alias.canonical))) {
      if (currentItem) {
        if (!currentItem.modifiers.includes(alias.canonical)) {
          currentItem.modifiers.push(alias.canonical);
        }
        for (let consumedIndex = index; consumedIndex < aliasEnd; consumedIndex += 1) {
          consumed.add(consumedIndex);
        }
      }
      index = aliasEnd;
      continue;
    }

    const quantity = quantityBefore(tokens, index);
    currentItem = {
      item: alias.canonical,
      quantity: quantity?.value ?? 1,
      modifiers: []
    };
    items.push(currentItem);
    if (quantity) {
      for (let consumedIndex = quantity.start; consumedIndex < index; consumedIndex += 1) {
        consumed.add(consumedIndex);
      }
    }
    for (let consumedIndex = index; consumedIndex < aliasEnd; consumedIndex += 1) {
      consumed.add(consumedIndex);
    }
    index = aliasEnd;
  }

  const unparsedTokens = tokens.filter((_, index) => !consumed.has(index));
  return {
    items,
    metadata: {
      normalizedTranscript: normalizeText(transcript),
      unparsedText: unparsedTokens.join(' '),
      unparsedTokens
    }
  };
}
