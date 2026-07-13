#!/usr/bin/env node
'use strict';

require('../src/cli')
  .run(process.argv.slice(2))
  .then((code) => {
    // The exported app may still hold a listening server open.
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(`jerant: ${err && err.message ? err.message : err}\n`);
    process.exit(1);
  });
