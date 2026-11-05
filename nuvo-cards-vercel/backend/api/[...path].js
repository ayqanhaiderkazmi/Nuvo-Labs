'use strict';
// Vercel entry point: every /api/... request lands here.
const { handler } = require('../server');
module.exports = handler;
