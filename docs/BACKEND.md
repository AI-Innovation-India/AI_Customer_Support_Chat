# Backend Integration Guide — Trane & ThermoKing Voice Support Agent

## Overview

For production deployment, API keys must never be exposed in client-side HTML. This guide shows how to build a lightweight Node.js/Express proxy that:

- Keeps all secrets server-side (env vars, not hardcoded)
- Exposes three clean endpoints that the front-end calls
- Can push session data to CRM / ticketing systems on session end
- Supports authentication so only authorised support staff can access the tool

---

## Architecture

```
Browser (support-agent.html)
       │
       │  POST /api/stt        (audio blob)
       │  POST /api/chat       (message history)
       │  POST /api/tts        (text to speak)
       │  POST /api/session    (on End Session)
       ▼
   Node.js / Express proxy (your company server / Azure App Service / AWS Lambda)
       │
       ├──▶ Sarvam AI  (api.sarvam.ai)  — STT + TTS
       ├──▶ Groq API   (api.groq.com)   — AI chat (free)
       ├──▶ Azure OpenAI (optional)     — AI chat (office)
       └──▶ CRM / Webhook (optional)    — session export
```

---

## Node.js Proxy — Quick Start

### 1. Install

```bash
npm init -y
npm install express cors multer dotenv node-fetch@2
```

### 2. `.env` file (never commit this)

```
SARVAM_KEY=your_sarvam_subscription_key
GROQ_KEY=gsk_your_groq_key
AZURE_ENDPOINT=https://your-resource.openai.azure.com
AZURE_DEPLOYMENT=gpt-35-turbo
AZURE_KEY=your_azure_key
CRM_WEBHOOK_URL=https://your-crm.com/api/tickets   # optional
PORT=3001
```

### 3. `server.js`

```js
require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const multer   = require('multer');
const fetch    = require('node-fetch');
const FormData = require('form-data');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public')); // serve support-agent.html from here

// ── STT — Speech to Text ──────────────────────────────────────
app.post('/api/stt', upload.single('file'), async (req, res) => {
  try {
    const fd = new FormData();
    fd.append('file', req.file.buffer, { filename: 'recording.webm', contentType: 'audio/webm' });
    fd.append('model', 'saarika:v2.5');
    fd.append('language_code', req.body.language_code || 'en-IN');

    const r = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': process.env.SARVAM_KEY, ...fd.getHeaders() },
      body: fd,
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── TTS — Text to Speech ──────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-subscription-key': process.env.SARVAM_KEY },
      body: JSON.stringify({ ...req.body }),
    });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Chat — AI Response ────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, systemPrompt, useAzure } = req.body;

    if (useAzure && process.env.AZURE_ENDPOINT && process.env.AZURE_KEY) {
      const url = `${process.env.AZURE_ENDPOINT}/openai/deployments/${process.env.AZURE_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': process.env.AZURE_KEY },
        body: JSON.stringify({ messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 300, temperature: 0.85 }),
      });
      const data = await r.json();
      return res.json({ reply: data.choices?.[0]?.message?.content || '' });
    }

    // Groq (default)
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_KEY}` },
      body: JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'system', content: systemPrompt }, ...messages], max_tokens: 300, temperature: 0.9 }),
    });
    const data = await r.json();
    res.json({ reply: data.choices?.[0]?.message?.content || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Session export — push to CRM ─────────────────────────────
app.post('/api/session', async (req, res) => {
  try {
    const session = req.body; // full session JSON from front-end

    // Optional: push to CRM webhook
    if (process.env.CRM_WEBHOOK_URL) {
      await fetch(process.env.CRM_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(session),
      });
    }

    // Optional: save to file / database
    // await db.collection('sessions').insertOne(session);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(process.env.PORT || 3001, () =>
  console.log(`Proxy running on port ${process.env.PORT || 3001}`)
);
```

---

## Front-end Changes for Proxy Mode

In `support-agent.html`, change the three API call base URLs from external APIs to your proxy endpoints:

| Current (direct API) | Change to (proxy) |
|----------------------|-------------------|
| `https://api.sarvam.ai/speech-to-text` | `/api/stt` |
| `https://api.sarvam.ai/text-to-speech` | `/api/tts` |
| `https://api.groq.com/openai/v1/chat/completions` | `/api/chat` |

Remove `CONFIG.sarvamKey`, `CONFIG.groqKey`, etc. from the HTML entirely. The settings modal can be simplified to just language / persona options.

On "End Session", add a POST to `/api/session` with the full JSON to trigger CRM push.

---

## Authentication — Agent Login

Add JWT auth so only support staff can open the tool:

```js
const jwt = require('jsonwebtoken');

// Login endpoint
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  // validate against LDAP / Active Directory / your user store
  if (username === process.env.AGENT_USER && password === process.env.AGENT_PASS) {
    const token = jwt.sign({ username }, process.env.JWT_SECRET, { expiresIn: '8h' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

// Middleware for protected endpoints
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Apply to all /api routes
app.use('/api', authMiddleware);
```

The front-end stores the JWT in `sessionStorage` and sends it as `Authorization: Bearer <token>`.

---

## Deployment Options

| Option | Best for | Notes |
|--------|----------|-------|
| **Azure App Service** | Office deployment | Use Managed Identity to read secrets from Key Vault — no `.env` file needed |
| **AWS Lambda + API Gateway** | Serverless / low traffic | Deploy each endpoint as a separate function |
| **Docker container** | On-premise / private cloud | `docker build -t trane-support .` |
| **PM2 on a VPS** | Simple, cheap | `pm2 start server.js --name trane-support` |

---

## CRM Integration

The `/api/session` endpoint receives the session JSON and forwards it to your CRM. Common integrations:

### Salesforce
```js
// Create a Case in Salesforce
const sfToken = await getSalesforceToken();
await fetch(`${SF_INSTANCE}/services/data/v58.0/sobjects/Case`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${sfToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    Subject: `${session.customer.name} — ${session.inquiry.type}`,
    Description: session.transcript.map(m => `${m.role}: ${m.content}`).join('\n'),
    Phone: session.customer.contact,
    Status: 'New',
    Priority: session.priority === 'urgent' ? 'High' : 'Medium',
  }),
});
```

### ServiceNow
```js
await fetch(`${SN_INSTANCE}/api/now/table/incident`, {
  method: 'POST',
  headers: { 'Authorization': 'Basic ' + Buffer.from(`${SN_USER}:${SN_PASS}`).toString('base64'), 'Content-Type': 'application/json' },
  body: JSON.stringify({
    short_description: `${session.inquiry.type} — ${session.customer.name}`,
    description: JSON.stringify(session, null, 2),
    caller_id: session.customer.name,
    urgency: session.priority === 'urgent' ? '1' : '3',
  }),
});
```

### Generic webhook (Zapier, Make.com, n8n)
Just `POST` the session JSON to the webhook URL — then connect to any downstream app.

---

## Security Checklist

- [ ] All API keys in `.env` / Azure Key Vault — never in HTML
- [ ] CORS restricted to your app's domain only (`ALLOWED_ORIGIN`)
- [ ] JWT auth on all `/api/*` routes
- [ ] HTTPS only in production (use SSL cert / Azure App Service default)
- [ ] Rate limit endpoints (`express-rate-limit`) — 60 req/min per IP
- [ ] Validate/sanitize all inputs server-side (file size, content type for audio, max text length)
- [ ] Log session IDs only — no PII in server logs

---

## Integration with Existing App (Phase 7.1)

Three ways to embed the support agent in your existing web application:

### Option A — iframe embed (fastest)
```html
<!-- In your existing app -->
<iframe src="https://support.yourcompany.com/support-agent.html"
        style="width:100%;height:700px;border:none;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,0.12)">
</iframe>
```

### Option B — New tab / popup
```js
// In your existing app's "Contact Support" button
document.getElementById('support-btn').addEventListener('click', () => {
  window.open('https://support.yourcompany.com/support-agent.html', '_blank', 'width=1100,height=800');
});
```

### Option C — Full integration
Copy `support-agent.html` into your existing app's frontend codebase, update API URLs to your proxy, and include it as a route (e.g. `/support`). This allows passing auth tokens and customer data from the parent app into the support page via URL params or `sessionStorage`.
