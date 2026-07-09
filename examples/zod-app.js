'use strict';

// Modern Express app using Zod schemas via jerant's validate() helper.
// Run:  node examples/zod-app.js
// Docs: http://localhost:3000/docs

const express = require('express');
const { z } = require('zod');
const { jerant, validate } = require('..');

const app = express();
jerant(app, { title: 'Users API', storage: { mode: 'file', path: '.jerant/zod-app.json' } });
app.use(express.json());

const users = [];

app.post(
  '/users',
  validate({
    summary: 'Create a user',
    tags: ['users'],
    body: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().int().min(0).optional(),
    }),
    responses: {
      201: z.object({ id: z.number(), name: z.string(), email: z.string().email() }),
    },
  }),
  (req, res) => {
    const user = { id: users.length + 1, ...req.body };
    users.push(user);
    res.status(201).json(user);
  }
);

app.get(
  '/users',
  validate({
    summary: 'List users',
    tags: ['users'],
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  }),
  (req, res) => res.json(users.slice(0, Number(req.query.limit) || 20))
);

app.get('/users/:id', (req, res) => {
  const user = users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`App:  http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
});
