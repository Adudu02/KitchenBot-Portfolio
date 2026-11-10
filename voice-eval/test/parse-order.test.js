// Gate-2 gap: this intentionally fails until the shipped aliases.json includes
// "hamburguesas de pollo crispy" as an explicit alias variant.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseOrder } from '../src/parse-order.js';

const aliases = JSON.parse(
  await readFile(new URL('../aliases.json', import.meta.url), 'utf8')
);

function parse(transcript) {
  return parseOrder(transcript, { aliases });
}

test('bare item defaults to quantity 1', () => {
  assert.deepEqual(parse('media orden de alitas').items, [
    {
      item: 'media orden de alitas',
      quantity: 1,
      modifiers: []
    }
  ]);
});

test('longest alias wins when one item name contains another', () => {
  assert.deepEqual(parse('media orden de alitas con papas').items, [
    {
      item: 'media orden de alitas con papas',
      quantity: 1,
      modifiers: []
    }
  ]);
});

test('number plus explicit plural alias variant parses the requested quantity', () => {
  assert.ok(
    aliases['hamburguesa de pollo crispy']?.includes(
      'hamburguesas de pollo crispy'
    ),
    'production aliases must contain the explicit plural variant'
  );

  assert.deepEqual(parse('dos hamburguesas de pollo crispy').items, [
    {
      item: 'hamburguesa de pollo crispy',
      quantity: 2,
      modifiers: []
    }
  ]);
});

test('two bare items remain two separate items', () => {
  assert.deepEqual(
    parse('media orden de alitas hamburguesa clasica').items,
    [
      {
        item: 'media orden de alitas',
        quantity: 1,
        modifiers: []
      },
      {
        item: 'hamburguesa clasica',
        quantity: 1,
        modifiers: []
      }
    ]
  );
});

test('modifiers attach only to their nearest preceding items', () => {
  assert.deepEqual(
    parse(
      'media orden de alitas bbq media orden de boneless buffalo'
    ).items,
    [
      {
        item: 'media orden de alitas',
        quantity: 1,
        modifiers: ['bbq']
      },
      {
        item: 'media orden de boneless',
        quantity: 1,
        modifiers: ['buffalo']
      }
    ]
  );
});

test('leading modifier without a current item remains unparsed', () => {
  const parsed = parse('bbq media orden de alitas');

  assert.deepEqual(parsed.items, [
    {
      item: 'media orden de alitas',
      quantity: 1,
      modifiers: []
    }
  ]);
  assert.ok(parsed.metadata.unparsedTokens.includes('bbq'));
});

test('ambiguous generic item stays unparsed and never becomes another SKU', () => {
  const parsed = parse('hamburguesa con papas');

  assert.deepEqual(
    parsed.items,
    [],
    'an ambiguous mention must not silently become a specific menu item'
  );
  assert.deepEqual(parsed.metadata, {
    normalizedTranscript: 'hamburguesa con papas',
    unparsedText: 'hamburguesa con papas',
    unparsedTokens: ['hamburguesa', 'con', 'papas']
  });
});

test('unos and unas both mean quantity 1', () => {
  assert.deepEqual(
    parse('unos dedos de queso y unas papas clasicas').items,
    [
      {
        item: 'dedos de queso',
        quantity: 1,
        modifiers: []
      },
      {
        item: 'papas clasicas',
        quantity: 1,
        modifiers: []
      }
    ]
  );
});

test('quantity must immediately precede an item', () => {
  assert.deepEqual(parse('un hot dog').items, [
    {
      item: 'hot dog jumbo',
      quantity: 1,
      modifiers: []
    }
  ]);

  const separated = parse('dos por favor hamburguesa clasica');
  assert.equal(separated.items[0].quantity, 1);
  assert.deepEqual(separated.metadata.unparsedTokens, ['dos', 'por', 'favor']);
});

test('bare menu noun resolves only when exactly one canonical owns it', () => {
  assert.deepEqual(
    parseOrder('quiero sopa', {
      aliases: { 'orden de sopa': [] }
    }).items,
    [{ item: 'orden de sopa', quantity: 1, modifiers: [] }]
  );

  assert.deepEqual(
    parseOrder('quiero sopa', {
      aliases: {
        'orden de sopa': [],
        'media orden de sopa': []
      }
    }).items,
    []
  );
});

test('numeric piece count may appear inside a menu item phrase', () => {
  assert.deepEqual(
    parseOrder('una orden de 12 piezas de sopa', {
      aliases: { 'orden de sopa': [] }
    }).items,
    [{ item: 'orden de sopa', quantity: 1, modifiers: [] }]
  );
});

test('postposed package description resolves against the canonical prefix', () => {
  assert.deepEqual(
    parseOrder('sopa una orden de 12 piezas', {
      aliases: {
        'orden de sopa': [],
        'media orden de sopa': [],
        'orden de sopa con pan': []
      }
    }).items,
    [{ item: 'orden de sopa', quantity: 1, modifiers: [] }]
  );
});

test('ambiguous bare item blocks a later modifier from leaking backward', () => {
  const parsed = parseOrder('un hot dog y sopa con sabor bbq', {
    aliases: {
      'hot dog jumbo': ['hot dog'],
      'orden de sopa': [],
      'media orden de sopa': [],
      bbq: []
    }
  });

  assert.deepEqual(parsed.items, [
    { item: 'hot dog jumbo', quantity: 1, modifiers: [] }
  ]);
  assert.ok(parsed.metadata.unparsedTokens.includes('sopa'));
  assert.ok(parsed.metadata.unparsedTokens.includes('bbq'));
});
