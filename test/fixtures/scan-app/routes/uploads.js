'use strict';

const express = require('express');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// The field names below live in multer's closures — only the source shows them.
router.post('/avatar', upload.single('avatar'), (req, res) => {
  res.json({ ok: true, size: req.file && req.file.size, caption: req.body.caption });
});

router.post(
  '/kyc',
  upload.fields([{ name: 'id_front', maxCount: 1 }, { name: 'id_back', maxCount: 1 }]),
  (req, res) => {
    res.status(201).json({ received: Object.keys(req.files || {}) });
  }
);

router.post('/gallery', upload.array('photos', 5), (req, res) => {
  res.json({ count: (req.files || []).length });
});

module.exports = router;
