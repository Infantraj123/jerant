'use strict';

// Service layer: the request payload only becomes concrete at the DB query.
const db = { query: async () => ({}), table: () => ({ update: async () => ({}) }) };

async function insertOrder(payload) {
  return db.query(
    'INSERT INTO orders (customer_id, items, coupon_code) VALUES ($1, $2, $3)',
    [payload.customer_id, JSON.stringify(payload.items), payload.coupon_code || null]
  );
}

async function reviseOrder(id, changes) {
  return db.table('orders').update({
    status: changes.status,
    notes: changes.notes,
    updated_at: new Date(),
  });
}

module.exports = { insertOrder, reviseOrder };
