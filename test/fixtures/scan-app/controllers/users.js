'use strict';

// Plain controllers, no validation library anywhere.

async function createUser(req, res) {
  const { email, password, role } = req.body;
  if (!email || !password) {
    return res.status(422).json({ error: 'email and password required' });
  }
  res.status(201).json({ id: 1, email, role: role || 'member' });
}

async function getUser(req, res) {
  const id = req.params.id;
  if (id === '0') return res.status(404).json({ error: 'not found' });
  res.json({ id, email: 'a@b.c' });
}

async function listUsers(req, res) {
  const page = req.query.page;
  const search = req.query.search;
  res.json({ page, search, items: [] });
}

module.exports = { createUser, getUser, listUsers };
