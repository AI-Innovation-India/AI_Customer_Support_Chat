/**
 * Rate Limiters — different thresholds per endpoint type
 */
const rateLimit = require('express-rate-limit');

// Login: strict — 10 attempts per 15 min per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  skipSuccessfulRequests: false,
});

// STT: 30 requests per minute per IP (voice messages)
const sttLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many voice requests. Please slow down.' },
});

// TTS: 60 requests per minute per IP (AI responses)
const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many speech requests. Please slow down.' },
});

// Chat: 30 messages per minute per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages. Please slow down.' },
});

// Session export: 20 per hour per IP
const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many session exports.' },
});

module.exports = { loginLimiter, sttLimiter, ttsLimiter, chatLimiter, sessionLimiter };
