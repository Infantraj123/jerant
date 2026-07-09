'use strict';

const express = require('express');
const orders = require('../controllers/orders');

const router = express.Router();

router.post('/', orders.createOrder);
router.put('/:id', orders.updateOrder);

module.exports = router;
