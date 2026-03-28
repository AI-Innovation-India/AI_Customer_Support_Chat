---
name: voice-chat-support-agent
description: Build an AI-powered voice chat customer support agent as a single self-contained HTML file. Use this skill whenever the user asks to build a voice chatbot, voice customer support agent, multilingual voice assistant, or any voice-enabled chat UI — especially when Sarvam AI, Indian language support, WhatsApp-style chat UI, or voice note bubbles are mentioned. Also trigger for requests like "customer support with voice", "voice bot for Indian languages", "speech-to-text chat interface", or "build a support agent HTML page". This skill handles all the complexity: Sarvam AI saarika:v2.5 (speech-to-text), bulbul:v2 (text-to-speech), Google Gemini or Azure OpenAI as the chat backend (Gemini for personal/testing, Azure for office), MediaRecorder API, waveform visualization, speaking indicator, session summary extraction with purchase intent tracking, and JSON export for CRM handoff.
---

# AI Voice Chat Customer Support Agent

Build a **single self-contained HTML file** that is a fully functional AI voice chat customer support agent. No external frameworks, no npm, no build step — just one HTML file the user can open in a browser or deploy anywhere.

Read `references/apis.md` for the complete Sarvam AI, Google Gemini, and Azure OpenAI API reference before coding.
Read `references/template.html` for the complete working reference implementation. You can use it as-is or adapt it to the user's specific requirements.

---

## What to build

The artifact is a single HTML/JS file with:

- **Language selector** — 11 Indian languages (Hindi, Bengali, Kannada, Malayalam, Marathi, Odia, Punjabi, Tamil, Telugu, Gujarati, English-IN)
- **Voice recording** — hold-to-record button using the MediaRecorder API; audio sent to Sarvam AI for transcription
- **WhatsApp-style chat bubbles** — user messages on the right (blue/green), AI responses on the left (white/grey); voice messages show a waveform + duration, not a text bubble
- **Auto-play AI voice responses** — every AI reply is synthesized via Sarvam AI TTS and plays automatically
- **Text fallback mode** — a typed input row always available; user can type instead of (or in addition to) speaking
- **Session summary panel** — a collapsible sidebar/panel that silently extracts customer name, issue description, and contact info from the conversation as it progresses
- **Hardcoded API config** — a `CONFIG` object at the very top of the `<script>` block where credentials are set directly in code (no runtime modal). The user edits the file once before deploying. Default backend is **Google Gemini** (free, works on personal laptops — get a key at aistudio.google.com); set `useAzure: true` with Azure credentials for office deployment.

---

## Architecture

Everything lives in one file. Use this structure inside the `<script>` tag:

```
CONFIG           → API keys, endpoints, default language, system prompt
STATE            → messages[], mediaRecorder, audioChunks[], isRecording, currentLanguage, sessionData
UI helpers       → createBubble(), renderWaveform(), updateSessionPanel()
API layer        → transcribeAudio(), getAIResponse(), synthesizeSpeech()
Event handlers   → setupRecordButton(), setupTextInput(), setupLanguageSelector()
init()           → wire everything up, show settings modal if keys are missing
```

Keep CSS in a `<style>` block. Use CSS custom properties for theming.

---

## Key implementation details

### Recording flow
1. User presses and holds record button → `mediaRecorder.start()`
2. Release → `mediaRecorder.stop()` → `ondataavailable` fires with audio blob
3. Show a "processing" bubble while waiting
4. POST the blob to Sarvam STT → get transcript
5. POST transcript + history to Gemini (or Azure OpenAI if `useAzure: true`) → get reply text
6. POST reply text to Sarvam TTS → get base64 audio
7. Render both bubbles (user voice bubble + AI voice bubble) and auto-play
8. Show speaking indicator (animated avatar ring + waveform bar) while audio plays

**Text input flow is identical from step 5 onward** — every AI response is spoken aloud regardless of whether the user typed or spoke.

### Waveform visualization
Use the Web Audio API `AnalyserNode` to draw a live waveform while recording onto a `<canvas>`. For played-back bubbles, draw a static bars visualization from sampled amplitude data. Keep it minimal — 40–60 bars, 3px wide, rounded. Match WhatsApp's style: grey bars that fill with the accent color as the audio plays.

### Session summary extraction
After every AI response, run a lightweight extraction call (or parse the AI response) to identify mentions of:
- Customer name (any self-introduction: "I'm Priya", "मेरा नाम राज है")
- Issue type (billing, delivery, technical, complaint, etc.)
- Contact info (phone number, email)

Store in `STATE.sessionData`. Display in a collapsible panel on the right side, updating live. On "End Session", show a modal with the full summary and a copy-to-clipboard button.

### Language handling
The selected language code (e.g., `hi-IN`) is passed to both the STT `language_code` field and TTS `target_language_code` field. The system prompt should instruct the model to respond in the same language the user is speaking.

### Speaking indicator
Every AI audio response must visually indicate playback — animate the agent avatar ring, show a waveform animation bar below the header, and display a "⏹ Stop" button. This makes the experience feel like a live virtual interview (Deloitte-style), not a chatbot playing audio silently. See `references/template.html` for the `setAgentSpeaking()` implementation.

### Error handling
- Mic permission denied → show friendly message, switch to text-only mode automatically
- API errors → show an error bubble inline in the chat (don't use alert())
- Network timeout → retry once, then show error bubble

---

## Default domain: Thermoking & Trane

Unless the user specifies a different domain, the agent is for **Thermoking and Trane** (transport refrigeration + commercial HVAC equipment). The default persona is **"Aria"** — a warm, conversational support specialist who sounds like a helpful human colleague, not a FAQ bot.

Use this as the default system prompt:

```
You are Aria, a warm and knowledgeable virtual support specialist for Trane and Thermoking —
manufacturers of commercial HVAC systems and transport refrigeration units.

You help customers with: cooling or heating failures, fault codes and diagnostics,
maintenance schedules, warranty queries, parts availability, dealer/service center
locator, installation questions, and product purchase inquiries.

Speak naturally and warmly — like a knowledgeable colleague who genuinely cares.
Show empathy when customers are frustrated. Use the customer's name once you learn it.
Ask one focused follow-up question at a time to diagnose the issue.
Keep each response to 2-3 sentences max — it will be read aloud.
Respond in the SAME LANGUAGE the customer speaks.
When someone is interested in buying, ask about their application (building size, use case)
and note their contact details for the sales team.
Never ask for payment details, passwords, or OTPs.
```

When the user specifies a different domain (banking, telecom, e-commerce, healthcare), adapt the system prompt accordingly while keeping the same structure.

## Session summary — auto-extraction and export

Session data should be extracted automatically from the conversation:
- **Name**: detect self-introductions in any language ("I'm Raj", "मेरा नाम है", "என் பெயர்")
- **Issue type**: categorize from keywords (cooling failure, fault code, maintenance, warranty, parts, dealer, installation, purchase inquiry)
- **Contact**: phone number (Indian mobile: 10 digits starting 6-9) or email address
- **Purchase intent**: detect buying signals ("buy", "purchase", "price", "quote", "interested in", "खरीदना") — flag for sales team
- **Product interest**: detect whether it's a Trane (HVAC/chiller/air handler) or Thermoking (refrigerated transport/reefer) inquiry

On "End Session", show the summary card AND offer to **download as JSON** (`sessionData.json`). This is what the customer support / sales team uses to follow up — importable into any CRM or ticketing system.

JSON structure:
```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "language": "hi-IN",
  "customerName": "Rajesh Kumar",
  "issueType": "Purchase Inquiry",
  "productLine": "Trane",
  "purchaseIntent": true,
  "contact": "9876543210",
  "messageCount": 12,
  "transcript": [
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ]
}
```

## Text input

Keep the text input field **always visible** alongside the record button. Both modes work at all times — voice is primary but typing is never hidden. This matters because: mic may not work in all browsers, some users prefer typing for sensitive info (contact details), and it allows mixed-mode conversations.

## Customization the user may ask for

- **Business domain** — adapt system prompt to the specified industry; Thermoking/Trane is the default
- **Agent name/avatar** — an emoji or uploaded image for the AI bubble avatar
- **Webhook on session end** — POST `sessionData` JSON to a URL when clicking "End Session"
- **Dark mode** — toggle via CSS class on `<body>`
- **Additional languages** — Sarvam supports the 11 listed; don't add languages outside that list

---

## Output

Write the complete, working HTML file to the path the user specifies (e.g., `support-agent.html`). The file should work when opened directly in Chrome/Edge (not Safari — MediaRecorder + Opus encoding has limitations there). Include a brief comment block at the top explaining how to configure the API keys.
