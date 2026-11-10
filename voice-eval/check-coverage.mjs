// Dev helper (not part of the test suite): run transcripts through the parser to
// inspect coverage — which items get recognized vs left in unparsed diagnostics.
// Use it while annotating to spot missing alias variants before the real run.
//
// Usage:
//   node check-coverage.mjs <transcripts.json>
//
// transcripts.json is an array of { "id": "...", "text": "<literal transcript>" }.
// Keep that file OUT of git: it holds real order text (treat like the corpus).
//
// It uses the live voice-eval/aliases.json and voice-eval/modifiers.json, so what you see here
// is exactly what the run harness will parse.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseOrder } from './src/parse-order.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const input = process.argv[2];
if (!input) {
  console.error('Usage: node check-coverage.mjs <transcripts.json>');
  process.exit(1);
}

const aliases = JSON.parse(await readFile(path.join(here, 'aliases.json'), 'utf8'));
const transcripts = JSON.parse(await readFile(input, 'utf8'));

for (const { id, text } of transcripts) {
  const parsed = parseOrder(text, { aliases });
  console.log(`==== ${id ?? '(sin id)'} ====`);
  console.log('  RECONOCIDO:', parsed.items.length ? JSON.stringify(parsed.items) : '(nada)');
  console.log('  UNPARSED  :', parsed.metadata.unparsedText);
  console.log();
}
