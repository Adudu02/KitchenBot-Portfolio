// In-memory state for the mock kitchen API. Nothing is persisted.

export const KITCHEN_NAME = 'KitchenBot Demo';

export const REMOTE_SETTINGS = Object.freeze({
  headerTitle: KITCHEN_NAME,
  footer: 'Thanks!',
  paperSize: '58mm',
});

/** Three fictitious pending orders with generic dishes. Prices are MXN. */
export function seedOrders() {
  return [
    order('demo-1001', [
      ['Tacos al pastor', 3, 18],
      ['Agua de horchata', 1, 25],
    ]),
    order('demo-1002', [
      ['Quesadilla de queso', 2, 45],
      ['Refresco', 2, 22],
    ]),
    order('demo-1003', [
      ['Tacos de bistec', 4, 20],
      ['Guacamole con totopos', 1, 60],
      ['Agua de jamaica', 2, 25],
    ]),
  ];
}

function order(id, items) {
  return {
    id,
    printKey: `pk-${id}`,
    status: 'pending',
    items: items.map(([nameSnapshot, quantity, unitPriceSnapshot]) => ({
      nameSnapshot,
      quantity,
      unitPriceSnapshot,
    })),
  };
}

export function createStore({ orders = seedOrders() } = {}) {
  const queue = orders.map((o) => structuredClone(o));
  const printers = new Map();
  let testJobCounter = 0;

  return {
    pendingOrders() {
      return queue.filter((o) => o.status === 'pending');
    },

    /** Returns 'ok', 'not_found' or 'print_key_mismatch'. */
    ack(orderId, printKey) {
      const found = queue.find((o) => o.id === orderId && o.status === 'pending');
      if (!found) return 'not_found';
      if (found.printKey !== printKey) return 'print_key_mismatch';
      found.status = 'printed';
      return 'ok';
    },

    enqueueTestPrint() {
      testJobCounter += 1;
      const id = `test-${testJobCounter}`;
      queue.push(order(id, [['Test print', 1, 0]]));
      return id;
    },

    recordHeartbeat(identifier, report) {
      const previous = printers.get(identifier) ?? {};
      const state = {
        ...previous,
        identifier,
        status: report.status ?? previous.status ?? 'OFF',
        lastStatusReason: report.statusReason ?? null,
        appVersion: report.appVersion ?? previous.appVersion ?? null,
        deviceModel: report.deviceModel ?? previous.deviceModel ?? null,
        printerMac: report.printerMac ?? previous.printerMac ?? null,
        bluetoothDevices: report.bluetoothDevices ?? previous.bluetoothDevices ?? [],
        lastHeartbeatAt: new Date().toISOString(),
      };
      printers.set(identifier, state);
      return state;
    },
  };
}
