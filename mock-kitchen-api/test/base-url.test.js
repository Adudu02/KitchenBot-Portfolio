import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBaseUrl } from '../src/base-url.js';

test('uses the detected LAN address and port when no override is set', () => {
  assert.equal(
    resolveBaseUrl({ override: undefined, lanAddress: '192.168.1.10', port: 3000 }),
    'http://192.168.1.10:3000',
  );
});

test('uses PUBLIC_BASE_URL verbatim when set', () => {
  assert.equal(
    resolveBaseUrl({ override: 'http://10.0.0.5:8080', lanAddress: '192.168.1.10', port: 3000 }),
    'http://10.0.0.5:8080',
  );
});

test('treats an empty or blank override as unset', () => {
  for (const override of ['', '   ']) {
    assert.equal(
      resolveBaseUrl({ override, lanAddress: '192.168.1.10', port: 3000 }),
      'http://192.168.1.10:3000',
    );
  }
});
