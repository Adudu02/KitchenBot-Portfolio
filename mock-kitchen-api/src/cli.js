#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { createServer } from './server.js';
import { provisioningPayload } from './provisioning.js';
import { KITCHEN_NAME } from './store.js';

const KITCHEN_ID = 'kitchen-demo';
const PRINTER_IDENTIFIER = 'printer-demo';

function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return '127.0.0.1';
}

function pngPathFromArgs(argv) {
  const index = argv.indexOf('--png');
  if (index === -1) return null;
  const path = argv[index + 1];
  if (!path || path.startsWith('--')) {
    console.error('--png requires an output path');
    process.exit(2);
  }
  return path;
}

const port = Number(process.env.PORT ?? 3000);
const token = process.env.PRINTER_TOKEN || randomBytes(16).toString('hex');
const pngPath = pngPathFromArgs(process.argv.slice(2));

const server = createServer({ token, kitchenId: KITCHEN_ID });

server.listen(port, '0.0.0.0', async () => {
  const baseUrl = `http://${lanAddress()}:${server.address().port}`;
  const payload = provisioningPayload({
    baseUrl,
    token,
    kitchenId: KITCHEN_ID,
    printerIdentifier: PRINTER_IDENTIFIER,
    kitchenName: KITCHEN_NAME,
  });

  console.log(`Mock kitchen API listening on ${baseUrl}`);
  console.log('\nProvisioning payload:');
  console.log(payload);
  console.log('\nScan this QR from the printer app:\n');
  console.log(await QRCode.toString(payload, { type: 'terminal', small: true }));

  if (pngPath) {
    await QRCode.toFile(pngPath, payload, { width: 512 });
    console.log(`QR PNG written to ${pngPath}`);
  }
});
