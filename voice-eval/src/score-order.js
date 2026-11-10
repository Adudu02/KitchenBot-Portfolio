import {
  canonicalizeLexical,
  normalizeQuantity
} from './normalize-order.js';

function requireOrder(value, label) {
  if (!value || !Array.isArray(value.items)) {
    throw new TypeError(`${label}.items must be an array`);
  }
}

function normalizeItem(item, aliases) {
  if (!item || typeof item.item !== 'string' || !Array.isArray(item.modifiers)) {
    throw new TypeError('each order item must contain item, quantity, and modifiers');
  }

  return {
    item: canonicalizeLexical(item.item, aliases),
    quantity: normalizeQuantity(item.quantity),
    modifiers: [...new Set(
      item.modifiers.map((modifier) => canonicalizeLexical(modifier, aliases))
    )].sort()
  };
}

function sameModifiers(left, right) {
  return left.length === right.length
    && left.every((modifier, index) => modifier === right[index]);
}

function pairingCost(expected, actual) {
  const itemMismatch = expected.item === actual.item ? 0 : 1;
  return {
    itemMismatches: itemMismatch,
    fieldErrors: itemMismatch
      + (expected.quantity === actual.quantity ? 0 : 1)
      + (sameModifiers(expected.modifiers, actual.modifiers) ? 0 : 1)
  };
}

function isBetterPairing(candidate, best) {
  return !best
    || candidate.itemMismatches < best.itemMismatches
    || (
      candidate.itemMismatches === best.itemMismatches
      && candidate.fieldErrors < best.fieldErrors
    );
}

function minimumCostPairs(expected, actual, expectedIndices, actualIndices) {
  if (expectedIndices.length === 0 || actualIndices.length === 0) {
    return { itemMismatches: 0, fieldErrors: 0, pairs: [] };
  }

  let best = null;
  if (expectedIndices.length <= actualIndices.length) {
    const [expectedIndex, ...remainingExpected] = expectedIndices;
    actualIndices.forEach((actualIndex, actualPosition) => {
      const remainingActual = actualIndices.filter((_, index) => index !== actualPosition);
      const rest = minimumCostPairs(expected, actual, remainingExpected, remainingActual);
      const cost = pairingCost(expected[expectedIndex], actual[actualIndex]);
      const candidate = {
        itemMismatches: cost.itemMismatches + rest.itemMismatches,
        fieldErrors: cost.fieldErrors + rest.fieldErrors,
        pairs: [{ expectedIndex, actualIndex }, ...rest.pairs]
      };
      if (isBetterPairing(candidate, best)) {
        best = candidate;
      }
    });
  } else {
    const [actualIndex, ...remainingActual] = actualIndices;
    expectedIndices.forEach((expectedIndex, expectedPosition) => {
      const remainingExpected = expectedIndices.filter((_, index) => index !== expectedPosition);
      const rest = minimumCostPairs(expected, actual, remainingExpected, remainingActual);
      const cost = pairingCost(expected[expectedIndex], actual[actualIndex]);
      const candidate = {
        itemMismatches: cost.itemMismatches + rest.itemMismatches,
        fieldErrors: cost.fieldErrors + rest.fieldErrors,
        pairs: [{ expectedIndex, actualIndex }, ...rest.pairs]
      };
      if (isBetterPairing(candidate, best)) {
        best = candidate;
      }
    });
  }

  // ponytail: exhaustive matching is fine for tiny POC orders; use an assignment
  // algorithm if real order sizes make this measurably slow.
  return best;
}

export function scoreOrder(parsedOrder, expectedOrder, options) {
  requireOrder(parsedOrder, 'parsedOrder');
  requireOrder(expectedOrder, 'expectedOrder');

  const aliases = options?.aliases;
  const expected = expectedOrder.items.map((item) => normalizeItem(item, aliases));
  const actual = parsedOrder.items.map((item) => normalizeItem(item, aliases));
  const pairing = minimumCostPairs(
    expected,
    actual,
    expected.map((_, index) => index),
    actual.map((_, index) => index)
  );
  const pairs = pairing.pairs;
  const pairedExpected = new Set(pairs.map(({ expectedIndex }) => expectedIndex));
  const pairedActual = new Set(pairs.map(({ actualIndex }) => actualIndex));

  const substitutions = new Array();
  for (const { expectedIndex, actualIndex } of pairs) {
    const expectedItem = expected[expectedIndex];
    const actualItem = actual[actualIndex];
    for (const field of ['item', 'quantity', 'modifiers']) {
      const matches = field === 'modifiers'
        ? sameModifiers(expectedItem.modifiers, actualItem.modifiers)
        : expectedItem[field] === actualItem[field];
      if (!matches) {
        substitutions.push({
          expectedIndex,
          actualIndex,
          field,
          expected: expectedItem[field],
          actual: actualItem[field]
        });
      }
    }
  }

  const deletions = expected
    .map((_, expectedIndex) => expectedIndex)
    .filter((expectedIndex) => !pairedExpected.has(expectedIndex))
    .map((expectedIndex) => ({
    expectedIndex,
    expected: expected[expectedIndex]
  }));
  const insertions = actual
    .map((_, actualIndex) => actualIndex)
    .filter((actualIndex) => !pairedActual.has(actualIndex))
    .map((actualIndex) => ({
    actualIndex,
    actual: actual[actualIndex]
  }));
  const fieldsCompared = pairs.length * 3;
  const isCorrect = deletions.length === 0
    && substitutions.length === 0
    && insertions.length === 0;

  return {
    metrics: {
      order_accuracy: isCorrect ? 1 : 0,
      item_deletion_rate: deletions.length > 0 ? 1 : 0,
      field_error_rate: fieldsCompared === 0 ? 0 : substitutions.length / fieldsCompared
    },
    differences: {
      deletions,
      substitutions,
      insertions
    },
    counts: {
      fieldsCompared,
      fieldErrors: substitutions.length
    }
  };
}
