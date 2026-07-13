'use strict';

// Fixture for the `jerant export` CLI test.

const express = require('express');
const { jerant } = require('../../src/index');

const app = express();
jerant(app, { title: 'CLI Fixture API', version: '1.2.3' });
app.use(express.json());

app.get('/things', (req, res) => res.json([]));
app.post('/things', (req, res) => res.status(201).json({ id: 1, name: req.body.name }));

if (!process.env.JERANT_EXPORT) {
  app.listen(0);
}

module.exports = app;
