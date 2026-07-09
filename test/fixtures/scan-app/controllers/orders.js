'use strict';

// Controllers hand the whole payload to the service — no field names here.
const orders = require('../services/orders');

async function createOrder(req, res) {
  const order = await orders.insertOrder(req.body);
  res.status(201).json(order);
}

async function updateOrder(req, res) {
  const order = await orders.reviseOrder(req.params.id, req.body);
  res.json(order);
}

module.exports = { createOrder, updateOrder };
