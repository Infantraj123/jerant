'use strict';

const express = require('express');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', require('./routes/users'));
  app.use('/api/uploads', require('./routes/uploads'));
  app.use('/api/orders', require('./routes/orders'));
  return app;
}

module.exports = { createApp };
