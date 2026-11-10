export function aggregateResults(results) {
  if (!Array.isArray(results)) {
    throw new TypeError('results must be an array');
  }

  const groups = new Map();
  for (const result of results) {
    const key = JSON.stringify([result.provider, result.condition]);
    const group = groups.get(key) || {
      provider: result.provider,
      condition: result.condition,
      counts: {
        orders: 0,
        correctOrders: 0,
        ordersWithDeletion: 0,
        fieldErrors: 0,
        fieldsCompared: 0
      }
    };

    group.counts.orders += 1;
    group.counts.correctOrders += result.metrics.order_accuracy === 1 ? 1 : 0;
    group.counts.ordersWithDeletion += result.metrics.item_deletion_rate > 0 ? 1 : 0;
    group.counts.fieldErrors += result.counts.fieldErrors;
    group.counts.fieldsCompared += result.counts.fieldsCompared;
    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((left, right) => (
      left.provider.localeCompare(right.provider)
      || left.condition.localeCompare(right.condition)
    ))
    .map((group) => ({
      ...group,
      metrics: {
        order_accuracy: group.counts.correctOrders / group.counts.orders,
        item_deletion_rate: group.counts.ordersWithDeletion / group.counts.orders,
        field_error_rate: group.counts.fieldsCompared === 0
          ? 0
          : group.counts.fieldErrors / group.counts.fieldsCompared
      }
    }));
}
