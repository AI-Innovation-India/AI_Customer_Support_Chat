/**
 * Chat route — AI response proxy (Groq primary, Azure fallback)
 * POST /api/chat
 * Body: { messages: [{role, content}], systemPrompt: string }
 * Returns: { reply: string }
 */
const express = require('express');
const fetch   = require('node-fetch');
const { chatLimiter } = require('../middleware/rateLimiter');
const { sanitizeChat } = require('../middleware/sanitize');

const router = express.Router();

router.post('/', chatLimiter, sanitizeChat, async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!systemPrompt || typeof systemPrompt !== 'string') {
    return res.status(400).json({ error: 'systemPrompt is required.' });
  }

  const useAzure = process.env.USE_AZURE === 'true';

  try {
    let reply = '';

    if (useAzure && process.env.AZURE_ENDPOINT && process.env.AZURE_KEY) {
      // ── Azure OpenAI ────────────────────────────────────────
      reply = await callAzure(systemPrompt, messages);
    } else if (process.env.GROQ_KEY) {
      // ── Groq (primary free backend) ─────────────────────────
      reply = await callGroq(systemPrompt, messages);
    } else {
      return res.status(503).json({ error: 'No AI backend configured on the server.' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('[Chat] Exception:', err.message);
    res.status(502).json({ error: err.message || 'AI service unavailable.' });
  }
});

async function callGroq(systemPrompt, messages) {
  // Prefix a synthetic user turn if history starts with assistant (init greeting case)
  const hist = [...messages];
  if (hist.length && hist[0].role === 'assistant') {
    hist.unshift({ role: 'user', content: '[session started]' });
  }

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'system', content: systemPrompt }, ...hist],
      max_tokens: 300,
      temperature: 0.9,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Groq ${r.status}: ${err}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAzure(systemPrompt, messages) {
  const hist = [...messages];
  if (hist.length && hist[0].role === 'assistant') {
    hist.unshift({ role: 'user', content: '[session started]' });
  }

  const url = `${process.env.AZURE_ENDPOINT}/openai/deployments/${process.env.AZURE_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`;

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.AZURE_KEY,
    },
    body: JSON.stringify({
      messages: [{ role: 'system', content: systemPrompt }, ...hist],
      max_tokens: 300,
      temperature: 0.85,
    }),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Azure OpenAI ${r.status}: ${err}`);
  }

  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = router;
