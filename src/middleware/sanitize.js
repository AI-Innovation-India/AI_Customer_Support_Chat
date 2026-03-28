/**
 * Input sanitization middleware
 * Strips XSS, checks for prompt injection, enforces length limits
 */

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|your)\s+instructions?/i,
  /forget\s+(everything|all|your\s+instructions?)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|unrestricted|free|DAN)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(DAN|an?\s+unrestricted|a\s+different)/i,
  /jailbreak/i,
  /\bDAN\b/,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|api\s+key|config)/i,
  /what\s+(are|is)\s+your\s+(system\s+prompt|instructions?|prompt)/i,
  /override\s+(your\s+)?(instructions?|system|prompt)/i,
  /do\s+anything\s+now/i,
  /no\s+restrictions?\s+(mode|enabled)/i,
];

/**
 * Strip HTML/script tags (XSS prevention)
 */
function stripHtml(text) {
  return String(text).replace(/<[^>]*>/g, '').trim();
}

/**
 * Check a single string for injection patterns
 */
function hasInjection(text) {
  const clean = stripHtml(text);
  return INJECTION_PATTERNS.some(p => p.test(clean));
}

/**
 * Sanitize an array of chat messages
 * Returns { ok: true, messages } or { ok: false, reason }
 */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return { ok: false, reason: 'messages must be an array' };
  if (messages.length > 100) return { ok: false, reason: 'too many messages' };

  const clean = [];
  for (const m of messages) {
    if (!m || typeof m.content !== 'string' || !['user', 'assistant'].includes(m.role)) {
      return { ok: false, reason: 'invalid message format' };
    }
    const content = stripHtml(m.content);
    if (content.length > 2000) return { ok: false, reason: 'message too long' };
    if (m.role === 'user' && hasInjection(content)) {
      return { ok: false, reason: 'injection detected' };
    }
    clean.push({ role: m.role, content });
  }
  return { ok: true, messages: clean };
}

/**
 * Express middleware: sanitize req.body.messages for chat endpoint
 */
function sanitizeChat(req, res, next) {
  const result = sanitizeMessages(req.body?.messages);
  if (!result.ok) {
    return res.status(400).json({ error: `Invalid input: ${result.reason}` });
  }
  req.body.messages = result.messages;
  next();
}

module.exports = { sanitizeChat, sanitizeMessages, stripHtml, hasInjection };
