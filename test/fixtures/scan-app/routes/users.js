'use strict';

const express = require('express');
const users = require('../controllers/users');

// Wrapper closures hide the handler from Function.prototype.toString.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const router = express.Router();

router.post('/', users.createUser); // named controller reference
router.get('/:id', users.getUser);
router.get('/', users.listUsers);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { displayName, bio } = req.body;
    res.json({ id: req.params.id, displayName, bio });
  })
);

module.exports = router;
