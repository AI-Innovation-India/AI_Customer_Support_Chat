# Trane & Thermoking — AI Voice Customer Support Agent

A single-file AI voice support agent for Trane HVAC and Thermoking transport refrigeration.
Customers can **speak or type** — the AI responds conversationally and **reads every reply aloud**.

---

## Quick Start

1. Open `support-agent.html` in **Chrome** or **Edge**
2. Click ⚙️ in the top-right corner
3. Enter your API keys (see below)
4. Click **Save & Start Session**

Aria (the AI agent) will greet you and you're ready to go.

---

## API Keys

### Sarvam AI — Voice (required)
Powers speech-to-text and text-to-speech for all 11 Indian languages.

- Go to [api.sarvam.ai](https://api.sarvam.ai)
- Sign up → Dashboard → **Subscription Keys**
- Copy the key into `support-agent.html`:
  ```js
  sarvamKey: 'YOUR_SARVAM_KEY_HERE',
  ```

### Google Gemini — AI Chat (testing / personal laptop)
Free tier, works anywhere.

- Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
- Click **Create API Key**
- Paste into `support-agent.html`:
  ```js
  geminiKey: 'AIza...',
  ```

### Azure OpenAI — AI Chat (office laptop / production)
Use your existing Azure subscription.

- Set `useAzure: true` in the CONFIG block
- Fill in:
  ```js
  useAzure: true,
  azureEndpoint: 'https://YOUR-RESOURCE.openai.azure.com',
  azureDeployment: 'gpt-35-turbo',
  azureKey: 'YOUR_AZURE_KEY_HERE',
  ```

---

## Features

| Feature | Details |
|---------|---------|
| 🎤 Voice input | Hold the mic button to speak; auto-transcribes via Sarvam |
| 🔊 Voice output | Every AI reply is spoken aloud (Deloitte interview style) |
| 💬 Text input | Always visible alongside mic |
| 🌐 11 languages | Hindi, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Odia, Punjabi, Gujarati, English |
| 📋 Live customer profile | Name, contact, issue type, product interest captured automatically |
| 🛒 Purchase intent | Detected and flagged for sales team follow-up |
| ⬇ Session export | Download full session as JSON (CRM-ready) |
| ⏹ Stop speaking | Interrupt Aria mid-sentence at any time |
| 🏢 Dual backend | Gemini (free/testing) or Azure OpenAI (office) — one toggle |

---

## How it works

```
Customer speaks/types
        ↓
Sarvam STT (saarika:v2.5) → transcript
        ↓
Gemini / Azure OpenAI → AI reply
        ↓
Sarvam TTS (bulbul:v2) → audio
        ↓
Auto-play + speaking indicator + session data update
```

---

## File structure

```
d:\Customer_Voice_Chat_Support\
├── support-agent.html      ← Open this in Chrome/Edge to use
├── PROGRESS.md             ← Implementation status tracker
├── README.md               ← This file
├── exports/                ← Save downloaded session JSONs here
├── docs/                   ← Integration guides (coming in Phase 7)
└── Skills/
    └── voice-chat-support-agent/
        ├── SKILL.md        ← Claude Code skill (for AI-assisted builds)
        └── references/
            ├── template.html
            └── apis.md
```

---

## Browser support

| Browser | Status |
|---------|--------|
| Chrome (desktop) | ✅ Fully supported |
| Edge (desktop) | ✅ Fully supported |
| Firefox | ⚠️ MediaRecorder works, Opus codec may vary |
| Safari | ❌ MediaRecorder + Opus encoding not supported |
| Chrome (Android) | ✅ Works (touch hold-to-record) |

---

## Session JSON structure

Downloaded from "End Session & Export":

```json
{
  "timestamp": "2026-03-27T10:30:00Z",
  "language": "en-IN",
  "brand": "Trane & Thermoking",
  "customer": {
    "name": "Rajesh Kumar",
    "contact": "9876543210"
  },
  "inquiry": {
    "type": "Purchase Inquiry",
    "product": "Trane (HVAC)",
    "issue": "Looking for a 2-ton split AC for a 500 sqft office",
    "purchaseIntent": true
  },
  "messageCount": 8,
  "transcript": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

---

## Phase 7 — Application Integration (upcoming)

See [PROGRESS.md](PROGRESS.md) → Phase 7 for the roadmap:
- Backend proxy for API keys (security)
- Webhook to CRM / ticketing system on session end
- Authentication for support staff
- Production deployment
