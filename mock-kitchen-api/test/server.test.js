import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { provisioningPayload } from '../src/provisioning.js';

const TOKEN = 'test-token';
const KITCHEN = 'kitchen-demo';
const PRINTER = 'printer-1';

let server;
let base;

async function listen() {
  server = createServer({ token: TOKEN, kitchenId: KITCHEN });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

before(listen);
after(() => new Promise((resolve) => server.close(resolve)));
// Fresh state per test: restart the server.
beforeEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await listen();
});

function call(path, { method = 'GET', body, token = TOKEN, raw } = {}) {
  const headers = {};
  if (token !== null) headers['x-printer-token'] = token;
  if (body !== undefined || raw !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const queuePath = `/kitchens/${KITCHEN}/print-queue`;

test('rejects requests without the printer token', async () => {
  const res = await call(queuePath, { token: null });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false, error: 'printer_not_authorized' });
  const wrong = await call(queuePath, { token: 'nope' });
  assert.equal(wrong.status, 401);
});

test('unknown kitchen returns 404', async () => {
  const res = await call('/kitchens/other/print-queue');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { ok: false, error: 'kitchen_not_found' });
});

test("queue returns seeded pending orders with the client's field names", async () => {
  const res = await call(`${queuePath}?printerIdentifier=${PRINTER}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.orders.length, 3);
  for (const order of body.orders) {
    assert.equal(typeof order.id, 'string');
    assert.equal(typeof order.printKey, 'string');
    assert.equal(order.status, 'pending');
    assert.ok(order.items.length > 0);
    for (const item of order.items) {
      assert.equal(typeof item.nameSnapshot, 'string');
      assert.ok(Number.isInteger(item.quantity));
      assert.equal(typeof item.unitPriceSnapshot, 'number');
    }
  }
});

test('ack removes the order from the queue', async () => {
  const { orders } = await (await call(queuePath)).json();
  const [first] = orders;
  const ack = await call(`${queuePath}/${first.id}/ack`, {
    method: 'POST',
    body: {
      printerIdentifier: PRINTER,
      printKey: first.printKey,
      printStatus: 'PRINTED',
      printedAt: new Date().toISOString(),
    },
  });
  assert.equal(ack.status, 200);
  assert.deepEqual(await ack.json(), { ok: true });
  const after = await (await call(queuePath)).json();
  assert.equal(after.orders.length, 2);
  assert.ok(!after.orders.some((o) => o.id === first.id));
});

test('ack with wrong printKey returns 409 and keeps the order', async () => {
  const { orders } = await (await call(queuePath)).json();
  const [first] = orders;
  const ack = await call(`${queuePath}/${first.id}/ack`, {
    method: 'POST',
    body: { printerIdentifier: PRINTER, printKey: 'stale', printStatus: 'PRINTED', printedAt: 'x' },
  });
  assert.equal(ack.status, 409);
  assert.deepEqual(await ack.json(), { ok: false, error: 'print_key_mismatch' });
  const after = await (await call(queuePath)).json();
  assert.equal(after.orders.length, 3);
});

test('ack for an unknown order returns 404', async () => {
  const ack = await call(`${queuePath}/missing/ack`, {
    method: 'POST',
    body: { printerIdentifier: PRINTER, printKey: 'k', printStatus: 'PRINTED', printedAt: 'x' },
  });
  assert.equal(ack.status, 404);
  assert.equal((await ack.json()).ok, false);
});

test('test-print enqueues a printable order', async () => {
  const res = await call(`/kitchens/${KITCHEN}/printers/${PRINTER}/test-print`, { method: 'POST' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.testJobId, 'string');
  const queue = await (await call(queuePath)).json();
  assert.equal(queue.orders.length, 4);
  const job = queue.orders.find((o) => o.id === body.testJobId);
  assert.ok(job);
  assert.ok(job.items.length > 0);
});

test('heartbeat is acknowledged', async () => {
  const res = await call(`/kitchens/${KITCHEN}/printers/${PRINTER}/heartbeat`, {
    method: 'POST',
    body: { status: 'ON', appVersion: '1.0.0' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('sync echoes reported devices and returns remote settings', async () => {
  const devices = [{ name: 'Demo Printer', address: '00:11:22:33:44:55' }];
  const res = await call(`/kitchens/${KITCHEN}/printers/${PRINTER}/sync`, {
    method: 'POST',
    body: {
      status: 'ON',
      appVersion: '1.0.0',
      deviceModel: 'Pixel',
      printerMac: '00:11:22:33:44:55',
      bluetoothDevices: devices,
    },
  });
  assert.equal(res.status, 200);
  const { ok, printer } = await res.json();
  assert.equal(ok, true);
  assert.equal(printer.identifier, PRINTER);
  assert.equal(printer.status, 'ON');
  assert.equal(printer.connected, true);
  assert.equal(printer.appVersion, '1.0.0');
  assert.equal(printer.deviceModel, 'Pixel');
  assert.equal(printer.printerMac, '00:11:22:33:44:55');
  assert.equal(printer.selectedPrinterMac, null);
  assert.deepEqual(printer.bluetoothDevices, devices);
  assert.equal(typeof printer.lastHeartbeatAt, 'string');
  assert.deepEqual(printer.settings, {
    headerTitle: 'KitchenBot Demo',
    footer: 'Thanks!',
    paperSize: '58mm',
  });
});

test('invalid JSON body returns 400', async () => {
  const res = await call(`/kitchens/${KITCHEN}/printers/${PRINTER}/heartbeat`, {
    method: 'POST',
    raw: '{not json',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { ok: false, error: 'invalid_json' });
});

test('unknown route returns a parseable 404 error body', async () => {
  const res = await call(`/kitchens/${KITCHEN}/nope`);
  assert.equal(res.status, 404);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
});

test('provisioning payload has exactly the fields ProvisioningPayload.kt reads', () => {
  const raw = provisioningPayload({
    baseUrl: 'http://192.168.1.10:3000',
    token: 'tok',
    kitchenId: KITCHEN,
    printerIdentifier: PRINTER,
    kitchenName: 'KitchenBot Demo',
  });
  const parsed = JSON.parse(raw);
  assert.deepEqual(Object.keys(parsed).sort(), [
    'baseUrl',
    'kitchenId',
    'kitchenName',
    'printerIdentifier',
    'printerToken',
    'v',
  ]);
  assert.equal(parsed.v, 1);
  assert.equal(parsed.printerToken, 'tok');
  for (const key of ['baseUrl', 'kitchenId', 'kitchenName', 'printerIdentifier', 'printerToken']) {
    assert.equal(typeof parsed[key], 'string');
    assert.ok(parsed[key].length > 0);
  }
});
