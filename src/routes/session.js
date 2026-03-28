/**
 * Session route — save session JSON and optionally push to CRM
 * POST /api/session
 * Body: full session JSON from the frontend
 * Returns: { ok: true, filename }
 */
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const fetch    = require('node-fetch');
const { sessionLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/', sessionLimiter, async (req, res) => {
  const session = req.body;

  if (!session || typeof session !== 'object') {
    return res.status(400).json({ error: 'Invalid session data.' });
  }

  // Add server-side metadata
  session.savedAt   = new Date().toISOString();
  session.savedBy   = req.user?.username || 'unknown';
  session.serverEnv = process.env.NODE_ENV || 'development';

  // ── Save to exports/ directory ───────────────────────────────
  const exportsDir = path.resolve(process.env.EXPORTS_DIR || './exports');
  let filename = null;

  try {
    if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

    const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = (session.customer?.name || 'unknown').replace(/[^a-z0-9]/gi, '_').slice(0, 20);
    filename   = `session-${ts}-${name}.json`;
    const dest = path.join(exportsDir, filename);

    fs.writeFileSync(dest, JSON.stringify(session, null, 2), 'utf8');
    console.log(`[Session] Saved: ${filename}`);
  } catch (err) {
    console.error('[Session] File save error:', err.message);
    // Non-fatal — continue to CRM push even if file save fails
  }

  // ── Push to CRM webhook (optional) ───────────────────────────
  const webhookUrl    = process.env.CRM_WEBHOOK_URL;
  const webhookSecret = process.env.CRM_WEBHOOK_SECRET;

  if (webhookUrl) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(webhookSecret ? { 'X-Webhook-Secret': webhookSecret } : {}),
      };
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(session),
        timeout: 10000,
      });
      if (!r.ok) console.warn(`[Session] CRM webhook returned ${r.status}`);
      else console.log('[Session] CRM webhook delivered');
    } catch (err) {
      console.error('[Session] CRM webhook error:', err.message);
      // Non-fatal
    }
  }

  res.json({ ok: true, filename });
});

module.exports = router;
