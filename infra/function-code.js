'use strict';

// `${file(...)}` executes .js files as modules instead of inlining them, so the
// edge function source is loaded as text through here. Keeping it in its own
// .js file means it stays lintable and testable.
const fs = require('fs');
const path = require('path');

module.exports.spaRouter = () =>
  fs.readFileSync(path.join(__dirname, 'spa-router.js'), 'utf8');
