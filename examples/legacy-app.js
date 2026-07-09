'use strict';

// Legacy Express app with no validation library at all. jerant discovers
// the routes immediately and learns request/response schemas from live
// traffic (with sensitive fields redacted).
//
// Run:  node examples/legacy-app.js
// Then send some traffic and open http://localhost:3000/docs
//
//   curl -s -X POST localhost:3000/payments -H 'content-type: application/json' \
//     -d '{"amount": 100, "currency": "USD", "card_number": "4111111111111111"}'

const express = require('express');
const { jerant } = require('..');

const app = express();
jerant(app);
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.post('/payments', (req, res) => {
  res.status(201).json({
    id: 'pay_' + Math.random().toString(36).slice(2, 10),
    amount: req.body.amount,
    currency: req.body.currency || 'USD',
    status: 'pending',
  });
});

const admin = express.Router();
admin.get('/stats', (req, res) => res.json({ payments: 12, volume: 3400.5 }));
app.use('/admin', admin);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`App:  http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
});
