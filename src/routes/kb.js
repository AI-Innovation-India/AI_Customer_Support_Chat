/**
 * Knowledge Base admin proxy
 * All routes require a valid agent JWT (same auth as other protected routes)
 *
 * GET    /api/kb/documents           — list all indexed documents
 * POST   /api/kb/ingest              — upload a file (multipart/form-data)
 * POST   /api/kb/ingest/url          — ingest a URL { url, category }
 * DELETE /api/kb/documents/:doc_id   — remove a document
 * GET    /api/kb/health              — RAG service health
 */
const express = require('express');
const fetch   = require('node-fetch');
const multer  = require('multer');
const FormData = require('form-data');
const { requireAuth } = require('../middleware/auth');

const router  = express.Router();
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const RAG_URL = process.env.RAG_SERVICE_URL || 'http://localhost:8000';

// All KB routes require agent authentication
router.use(requireAuth);

// ── Health ────────────────────────────────────────────────────────────────────
router.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${RAG_URL}/health`, { signal: AbortSignal.timeout(5000) });
    res.status(r.status).json(await r.json());
  } catch {
    res.status(503).json({ status: 'unavailable', message: 'RAG service is not running' });
  }
});

// ── List documents ────────────────────────────────────────────────────────────
router.get('/documents', async (_req, res) => {
  try {
    const r = await fetch(`${RAG_URL}/documents`, { signal: AbortSignal.timeout(8000) });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'RAG service unavailable', detail: err.message });
  }
});

// ── Upload file ────────────────────────────────────────────────────────────────
router.post('/ingest', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const category = req.body.category || 'general';
  const form = new FormData();
  form.append('file', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
  form.append('category', category);

  try {
    const r = await fetch(`${RAG_URL}/ingest`, {
      method: 'POST', body: form,
      signal: AbortSignal.timeout(120000),  // large files can take a while
    });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'Ingestion failed', detail: err.message });
  }
});

// ── Ingest URL ────────────────────────────────────────────────────────────────
router.post('/ingest/url', async (req, res) => {
  const { url, category = 'general' } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  try {
    const r = await fetch(`${RAG_URL}/ingest/url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, category }),
      signal: AbortSignal.timeout(60000),
    });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'URL ingestion failed', detail: err.message });
  }
});

// ── Delete document ────────────────────────────────────────────────────────────
router.delete('/documents/:doc_id', async (req, res) => {
  try {
    const r = await fetch(`${RAG_URL}/documents/${req.params.doc_id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(60000),   // rebuild index can take time on large KBs
    });
    res.status(r.status).json(await r.json());
  } catch (err) {
    res.status(502).json({ error: 'Delete failed', detail: err.message });
  }
});

module.exports = router;
