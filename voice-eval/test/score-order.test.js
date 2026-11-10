import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOrder } from '../src/parse-order.js';
import { scoreOrder } from '../src/score-order.js';

// Fixture vocabulary, intentionally decoupled from the shipped aliases.json:
// the scorer's correctness (deletion vs substitution, etc.) is menu-agnostic, so
// these Gate 2 tests must not break when the real menu/aliases change.
const aliases = {
  'taco al pastor': ['tacos al pastor', 'taco de pastor', 'tacos de pastor'],
  'agua de horchata': ['horchata', 'agua horchata'],
  grande: ['grandes', 'el grande']
};

function order(...items) {
  return { items };
}

function item(name, quantity, modifiers = []) {
  return { item: name, quantity, modifiers };
}

function evaluate(transcript, expected) {
  const parsed = parseOrder(transcript, { aliases });
  return { parsed, score: scoreOrder(parsed, expected, { aliases }) };
}

test('exact match scores a fully correct order', () => {
  const { score } = evaluate(
    '2 tacos al pastor',
    order(item('taco al pastor', 2))
  );

  assert.deepEqual(score.metrics, {
    order_accuracy: 1,
    item_deletion_rate: 0,
    field_error_rate: 0
  });
});

test('Spanish numeric word matches the numeric quantity', () => {
  const { parsed, score } = evaluate(
    'tres tacos al pastor',
    order(item('taco al pastor', 3))
  );

  assert.equal(parsed.items[0].quantity, 3);
  assert.equal(score.metrics.order_accuracy, 1);
});

test('lexical variant matches only through aliases.json', () => {
  const { parsed, score } = evaluate(
    '2 tacos de pastor',
    order(item('taco al pastor', 2))
  );

  assert.equal(parsed.items[0].item, 'taco al pastor');
  assert.equal(score.metrics.order_accuracy, 1);
});

test('wrong recognized item is a substitution, not a deletion', () => {
  const { score } = evaluate(
    '1 agua de horchata',
    order(item('taco al pastor', 1))
  );

  assert.equal(score.differences.deletions.length, 0);
  assert.equal(score.differences.substitutions.length, 1);
  assert.equal(score.differences.substitutions[0].field, 'item');
  assert.equal(score.metrics.item_deletion_rate, 0);
  assert.equal(score.metrics.field_error_rate, 1 / 3);
});

test('missing entire item is a deletion and not a substitution', () => {
  const { score } = evaluate(
    '2 tacos al pastor',
    order(
      item('taco al pastor', 2),
      item('agua de horchata', 1)
    )
  );

  assert.equal(score.differences.deletions.length, 1);
  assert.equal(score.differences.substitutions.length, 0);
  assert.equal(score.metrics.item_deletion_rate, 1);
  assert.equal(score.metrics.field_error_rate, 0);
});

test('extra unsolicited item is an insertion', () => {
  const { score } = evaluate(
    '2 tacos al pastor y 1 agua de horchata',
    order(item('taco al pastor', 2))
  );

  assert.equal(score.differences.insertions.length, 1);
  assert.equal(score.differences.deletions.length, 0);
  assert.equal(score.differences.substitutions.length, 0);
  assert.equal(score.metrics.order_accuracy, 0);
  assert.equal(score.metrics.item_deletion_rate, 0);
  assert.equal(score.metrics.field_error_rate, 0);
});

test('empty transcript reports deletion without a field substitution', () => {
  const { parsed, score } = evaluate(
    '',
    order(item('taco al pastor', 1))
  );

  assert.deepEqual(parsed.items, []);
  assert.equal(score.differences.deletions.length, 1);
  assert.equal(score.differences.substitutions.length, 0);
  assert.equal(score.metrics.item_deletion_rate, 1);
  assert.equal(score.metrics.field_error_rate, 0);
});

test('mixed multi-item order parses quantities, aliases, and modifiers', () => {
  const { parsed, score } = evaluate(
    'tres tacos de pastor grandes y una agua horchata',
    order(
      item('taco al pastor', 3, ['grande']),
      item('agua de horchata', 1)
    )
  );

  assert.deepEqual(parsed.items, [
    item('taco al pastor', 3, ['grande']),
    item('agua de horchata', 1)
  ]);
  assert.equal(score.metrics.order_accuracy, 1);
});

test('deletion and substitution remain separate numbers in the same order', () => {
  const { score } = evaluate(
    '1 taco al pastor',
    order(
      item('taco al pastor', 2),
      item('agua de horchata', 1)
    )
  );

  assert.equal(score.differences.deletions.length, 1);
  assert.equal(score.differences.substitutions.length, 1);
  assert.equal(score.differences.substitutions[0].field, 'quantity');
  assert.equal(score.metrics.item_deletion_rate, 1);
  assert.equal(score.metrics.field_error_rate, 1 / 3);
});

test('duplicate-item pairing minimizes substitutions regardless of expected order', () => {
  const parsed = parseOrder('2 tacos al pastor grandes', { aliases });
  const firstOrder = scoreOrder(
    parsed,
    order(
      item('taco al pastor', 1),
      item('taco al pastor', 3, ['grande'])
    ),
    { aliases }
  );
  const reversedOrder = scoreOrder(
    parsed,
    order(
      item('taco al pastor', 3, ['grande']),
      item('taco al pastor', 1)
    ),
    { aliases }
  );

  assert.equal(firstOrder.metrics.field_error_rate, 1 / 3);
  assert.equal(reversedOrder.metrics.field_error_rate, 1 / 3);
  assert.equal(firstOrder.differences.deletions[0].expected.quantity, 1);
  assert.equal(reversedOrder.differences.deletions[0].expected.quantity, 1);
});

test('pairing preserves available item identities before minimizing other fields', () => {
  const score = scoreOrder(
    order(
      item('taco al pastor', 2, ['grande']),
      item('quesadilla', 1)
    ),
    order(
      item('taco al pastor', 1),
      item('agua de horchata', 2, ['grande'])
    ),
    { aliases }
  );

  assert.equal(
    score.differences.substitutions.filter(({ field }) => field === 'item').length,
    1
  );
  assert.equal(score.metrics.field_error_rate, 5 / 6);
});

test('unrecognized text is retained as diagnostic metadata', () => {
  const parsed = parseOrder('por favor 2 tacos al pastor sin ruido', { aliases });

  assert.deepEqual(parsed.items, [item('taco al pastor', 2)]);
  assert.equal(parsed.metadata.unparsedText, 'por favor sin ruido');
});
