# mock-kitchen-api

A small in-memory stand-in for the kitchen API that the thermal-printer
Android app talks to. It exists so the app can be paired, exercised and
demonstrated without the real backend: it serves three fictitious pending
orders, accepts print acknowledgements, and prints a provisioning QR code that
the app can scan.

It has one runtime dependency (`qrcode`, for the terminal and PNG QR output)
and keeps all state in memory, so restarting it resets everything.

## Run

```bash
npm install                          # from the repository root
npm start -w mock-kitchen-api        # listens on 0.0.0.0:3000
```

Options:

- `PORT` sets the listening port (default `3000`).
- `PRINTER_TOKEN` fixes the printer token; otherwise a random one is generated
  on every start.
- `PUBLIC_BASE_URL` overrides the base URL put in the provisioning QR, used
  verbatim (for example `PUBLIC_BASE_URL=http://192.168.1.10:3000`). Set it
  when the detected address is the wrong interface, such as a VPN or virtual
  adapter.
- `--png <path>` also writes the QR as a PNG, e.g.
  `npm start -w mock-kitchen-api -- --png /tmp/pair.png`. Nothing is written
  to disk unless you pass it.

Unless `PUBLIC_BASE_URL` is set, the CLI detects the first non-internal IPv4
address and uses it as the base URL, so the phone and the computer must be on
the same network. If that picks the wrong interface, set `PUBLIC_BASE_URL`.

## Pairing the app

1. Start the server and wait for the QR code to appear in the terminal.
2. In the printer app, open the provisioning scanner and scan the QR.
3. The app fills in base URL, printer token, kitchen id, printer identifier and
   kitchen name. Pick the Bluetooth printer locally as usual.

The QR encodes this JSON:

```json
{"v":1,"baseUrl":"http://192.168.1.10:3000","printerToken":"...","kitchenId":"kitchen-demo","printerIdentifier":"printer-demo","kitchenName":"KitchenBot Demo"}
```

## Endpoints

Every request needs the header `x-printer-token: <token>`; otherwise the
response is `401 {"ok":false,"error":"printer_not_authorized"}`. A kitchen id
other than the configured one returns `404 {"ok":false,"error":"kitchen_not_found"}`.
All errors have the shape `{"ok":false,"error":"<code>"}`.

| Method and path | Purpose | Success body |
| --- | --- | --- |
| `GET /kitchens/:kitchenId/print-queue` | Pending orders | `{ok, orders:[{id, printKey, status, items:[{nameSnapshot, quantity, unitPriceSnapshot}]}]}` |
| `POST /kitchens/:kitchenId/print-queue/:orderId/ack` | Mark an order printed (body: `printerIdentifier`, `printKey`, `printStatus`, `printedAt`) | `{ok:true}`; `409 print_key_mismatch` if the key differs, `404` if the order is unknown |
| `POST /kitchens/:kitchenId/printers/:printerIdentifier/test-print` | Enqueue a test order | `{ok:true, testJobId}` |
| `POST /kitchens/:kitchenId/printers/:printerIdentifier/heartbeat` | Report printer status | `{ok:true}` |
| `POST /kitchens/:kitchenId/printers/:printerIdentifier/sync` | Report status and Bluetooth devices, receive remote settings | `{ok:true, printer:{identifier, status, connected, lastHeartbeatAt, appVersion, deviceModel, printerMac, selectedPrinterMac, bluetoothDevices, settings}}` |

A body that is not valid JSON returns `400 {"ok":false,"error":"invalid_json"}`.
Prices are plain numbers in MXN. Remote settings are fixed:
`headerTitle: "KitchenBot Demo"`, `footer: "Thanks!"`, `paperSize: "58mm"`.

## Tests

```bash
npm test -w mock-kitchen-api
```
