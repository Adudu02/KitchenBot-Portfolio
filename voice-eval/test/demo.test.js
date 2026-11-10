import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatTable, runDemo } from '../src/demo.js';

const { aliases, cases } = JSON.parse(
  readFileSync(new URL('../demo/cases.json', import.meta.url), 'utf8')
);
const result = runDemo(cases, { aliases });
const row = (id) => result.rows.find((candidate) => candidate.id === id);

test('demo reports deletion and substitution as separate counts', () => {
  assert.equal(row('deletion').deletions, 1);
  assert.equal(row('deletion').substitutions, 0);
  assert.ok(row('substitution').substitutions >= 1);
  assert.equal(row('substitution').deletions, 0);
});

test('demo totals over the seven gate-2 cases', () => {
  assert.equal(result.totals.orders, 7);
  assert.equal(result.totals.correctOrders, 3);
  assert.equal(result.totals.ordersWithDeletion, 2);
  assert.deepEqual(
    result.rows.filter((r) => r.correct).map((r) => r.id),
    ['exact-match', 'numeric-variant', 'alias-variant']
  );
  assert.equal(result.totals.substitutions, 1);
  assert.equal(row('insertion').insertions, 1);
  assert.equal(row('insertion').correct, false);
  assert.equal(row('empty-transcript').deletions, 1);
  assert.equal(row('empty-transcript').substitutions, 0);
  for (const r of result.rows.filter(({ id }) => id !== 'insertion')) {
    assert.equal(r.insertions, 0, `${r.id} has no insertions`);
  }
});

test('table has separate Deletions and Substitutions columns', () => {
  const header = formatTable(result)
    .split('\n')
    .find((line) => line.includes('Deletions'));

  assert.ok(header, 'a header line with Deletions exists');
  const columns = header.split('|').map((cell) => cell.trim());
  assert.ok(columns.includes('Deletions'));
  assert.ok(columns.includes('Substitutions'));
});
