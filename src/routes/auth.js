/**
 * Auth routes
 * POST /api/login   — returns JWT token
 * GET  /api/me      — returns current agent info
 */
const express = require('express');
const { loginHandler, requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, loginHandler);

router.get('/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

module.exports = router;
