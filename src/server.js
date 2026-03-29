/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  Trane & ThermoKing — AI Support Agent · Production Server  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Start:  node src/server.js
 * Dev:    npm run dev   (uses nodemon for auto-reload)
 *
 * Requires .env file — copy .env.example to .env and fill keys.
 */
require('dotenv').config();

// ── Startup env validation ────────────────────────────────────
const REQUIRED_VARS = ['SARVAM_KEY', 'GROQ_KEY'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length) {
  console.error(`\n[FATAL] Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in your values.\n');
  process.exit(1);
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.warn('[WARN] JWT_SECRET is missing or too short — using insecure default. Set a 64+ char secret in .env.');
}

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');
const fs      = require('fs');

const { requireAuth, loginHandler } = require('./middleware/auth');
const { loginLimiter } = require('./middleware/rateLimiter');

const authRouter    = require('./routes/auth');
const sttRouter     = require('./routes/stt');
const ttsRouter     = require('./routes/tts');
const chatRouter    = require('./routes/chat');
const sessionRouter = require('./routes/session');
const ticketRouter  = require('./routes/ticket');
const kbRouter      = require('./routes/kb');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],   // needed for inline JS in single HTML
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      connectSrc:  ["'self'"],
      imgSrc:      ["'self'", 'data:'],
      mediaSrc:    ["'self'", 'data:', 'blob:'],
      workerSrc:   ["'self'", 'blob:'],
    },
  },
}));

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
  origin: allowedOrigin === '*' ? '*' : allowedOrigin.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Body parsers ──────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ── Static — serve production frontend ───────────────────────
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, {
  index: 'index.html',
  etag: true,
  lastModified: true,
}));

// ── Auth routes (login is public, /me is protected) ──────────
app.use('/api', authRouter);

// ── API routes (auth enforced by parent app / reverse proxy) ──
app.use('/api/stt',     sttRouter);
app.use('/api/tts',     ttsRouter);
app.use('/api/chat',    chatRouter);
app.use('/api/session', sessionRouter);
app.use('/api/ticket',  ticketRouter);
app.use('/api/kb',      kbRouter);

// ── Health check (no auth — for load balancers / uptime monitors)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'trane-thermoking-support-agent',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()) + 's',
    backends: {
      groq:  !!process.env.GROQ_KEY,
      azure: process.env.USE_AZURE === 'true' && !!process.env.AZURE_KEY,
      sarvam: !!process.env.SARVAM_KEY,
    },
  });
});

// ── SPA fallback — serve index.html for any unmatched GET ─────
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error.' });
});

// ── Ensure exports directory exists ──────────────────────────
const exportsDir = path.resolve(process.env.EXPORTS_DIR || './exports');
if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Trane & ThermoKing Support Agent  ·  Ready  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  URL     : http://localhost:${PORT}`);
  console.log(`  Health  : http://localhost:${PORT}/health`);
  console.log(`  Mode    : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  AI      : ${process.env.USE_AZURE === 'true' ? 'Azure OpenAI' : 'Groq'}`);
  console.log(`  Sarvam  : ${process.env.SARVAM_KEY ? '✓ configured' : '✗ missing key'}`);
  console.log(`  RAG KB  : ${process.env.RAG_SERVICE_URL || 'http://localhost:8000'}`);
  console.log(`  Exports : ${exportsDir}`);
  console.log('');
});

module.exports = app;
