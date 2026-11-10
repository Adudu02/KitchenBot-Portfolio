import http from 'node:http';
import { createStore, REMOTE_SETTINGS } from './store.js';

const MAX_BODY_BYTES = 1024 * 1024;
const TOKEN_HEADER = 'x-printer-token';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.trim() === '') return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

/**
 * Mock of the kitchen API used by the printer app. State is in memory and
 * lives as long as the returned server.
 */
export function createServer({ token, kitchenId, orders } = {}) {
  const store = createStore(orders ? { orders } : undefined);

  async function route(req, res) {
    if (req.headers[TOKEN_HEADER] !== token) {
      throw new HttpError(401, 'printer_not_authorized');
    }

    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const [root, id, section, ...rest] = parts;
    if (root !== 'kitchens' || !id) throw new HttpError(404, 'not_found');
    if (id !== kitchenId) throw new HttpError(404, 'kitchen_not_found');

    const { method } = req;

    if (method === 'GET' && section === 'print-queue' && rest.length === 0) {
      return send(res, 200, { ok: true, orders: store.pendingOrders() });
    }

    if (method === 'POST' && section === 'print-queue' && rest.length === 2 && rest[1] === 'ack') {
      const body = await readJson(req);
      const result = store.ack(rest[0], body.printKey);
      if (result === 'not_found') throw new HttpError(404, 'order_not_found');
      if (result === 'print_key_mismatch') throw new HttpError(409, 'print_key_mismatch');
      return send(res, 200, { ok: true });
    }

    if (section === 'printers' && rest.length === 2 && method === 'POST') {
      const [printerIdentifier, action] = rest;

      if (action === 'test-print') {
        return send(res, 200, { ok: true, testJobId: store.enqueueTestPrint() });
      }

      if (action === 'heartbeat') {
        store.recordHeartbeat(printerIdentifier, await readJson(req));
        return send(res, 200, { ok: true });
      }

      if (action === 'sync') {
        const state = store.recordHeartbeat(printerIdentifier, await readJson(req));
        return send(res, 200, {
          ok: true,
          printer: {
            identifier: state.identifier,
            status: state.status,
            connected: true,
            lastHeartbeatAt: state.lastHeartbeatAt,
            lastStatusReason: state.lastStatusReason,
            appVersion: state.appVersion,
            deviceModel: state.deviceModel,
            printerMac: state.printerMac,
            selectedPrinterMac: null,
            bluetoothDevices: state.bluetoothDevices,
            settings: { ...REMOTE_SETTINGS },
          },
        });
      }
    }

    throw new HttpError(404, 'not_found');
  }

  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      if (error instanceof HttpError) {
        send(res, error.status, { ok: false, error: error.code });
      } else {
        send(res, 500, { ok: false, error: 'internal_error' });
      }
    });
  });
}
