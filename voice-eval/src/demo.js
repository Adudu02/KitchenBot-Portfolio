import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseOrder } from './parse-order.js';
import { scoreOrder } from './score-order.js';

/**
 * Runs the scorer over hand-written fake transcripts. No audio, no provider,
 * no API key: this is the "scorer correctness" gate made visible.
 */
export function runDemo(cases, { aliases }) {
  const rows = cases.map(({ id, transcript, expected }) => {
    const parsed = parseOrder(transcript, { aliases });
    const score = scoreOrder(parsed, expected, { aliases });

    return {
      id,
      transcript,
      deletions: score.differences.deletions.length,
      substitutions: score.differences.substitutions.length,
      insertions: score.differences.insertions.length,
      correct: score.metrics.order_accuracy === 1
    };
  });

  return {
    rows,
    totals: {
      orders: rows.length,
      correctOrders: rows.filter((row) => row.correct).length,
      ordersWithDeletion: rows.filter((row) => row.deletions > 0).length,
      substitutions: rows.reduce((sum, row) => sum + row.substitutions, 0)
    }
  };
}

const COLUMNS = [
  ['Case', (row) => row.id],
  ['Transcript', (row) => (row.transcript === '' ? '(empty)' : row.transcript)],
  ['Deletions', (row) => String(row.deletions)],
  ['Substitutions', (row) => String(row.substitutions)],
  ['Insertions', (row) => String(row.insertions)],
  ['Correct', (row) => (row.correct ? 'yes' : 'no')]
];

export function formatTable({ rows, totals }) {
  const cells = rows.map((row) => COLUMNS.map(([, read]) => read(row)));
  const widths = COLUMNS.map(([header], index) =>
    Math.max(header.length, ...cells.map((line) => line[index].length))
  );
  const line = (values) =>
    `| ${values.map((value, index) => value.padEnd(widths[index])).join(' | ')} |`;
  const rule = `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`;

  return [
    line(COLUMNS.map(([header]) => header)),
    rule,
    ...cells.map(line),
    '',
    `Orders: ${totals.orders}`,
    `Fully correct orders: ${totals.correctOrders}`,
    `Orders with a deleted item: ${totals.ordersWithDeletion}`,
    `Substitutions: ${totals.substitutions}`,
    '(deletions and substitutions are reported separately on purpose)'
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { aliases, cases } = JSON.parse(
    readFileSync(new URL('../demo/cases.json', import.meta.url), 'utf8')
  );
  console.log(formatTable(runDemo(cases, { aliases })));
}
