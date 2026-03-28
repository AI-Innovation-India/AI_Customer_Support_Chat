# API Reference

## Sarvam AI

Base URL: `https://api.sarvam.ai`
Auth header: `api-subscription-key: <YOUR_KEY>`

### Speech-to-Text — saarika:v2.5

```
POST /speech-to-text
Content-Type: multipart/form-data

FormData fields:
  file          : Blob   (audio/webm or audio/wav)
  model         : "saarika:v2.5"
  language_code : string (see codes below; omit or "unknown" for auto-detect)
```

Response:
```json
{
  "transcript": "नमस्ते मुझे अपने बिल के बारे में जानकारी चाहिए",
  "language_code": "hi-IN",
  "disfluencies": false
}
```

### Text-to-Speech — bulbul:v2

```
POST /text-to-speech
Content-Type: application/json

{
  "inputs": ["text to synthesize"],
  "target_language_code": "hi-IN",
  "speaker": "meera",
  "model": "bulbul:v2",
  "pitch": 0,
  "pace": 1.0,
  "loudness": 1.5,
  "speech_sample_rate": 8000,
  "enable_preprocessing": true,
  "eng_interpolation_wt": 123
}
```

Response:
```json
{
  "audios": ["<base64_encoded_wav>"],
  "request_id": "..."
}
```

Play back: `new Audio("data:audio/wav;base64," + response.audios[0]).play()`

### Supported language codes

| Language        | Code  |
|-----------------|-------|
| Hindi           | hi-IN |
| Bengali         | bn-IN |
| Kannada         | kn-IN |
| Malayalam       | ml-IN |
| Marathi         | mr-IN |
| Odia            | od-IN |
| Punjabi         | pa-IN |
| Tamil           | ta-IN |
| Telugu          | te-IN |
| Gujarati        | gu-IN |
| English (India) | en-IN |

### Speakers available for bulbul:v2
Female: `anushka`, `manisha`, `vidya`, `arya`, `priya`, `neha`, `pooja`, `ishita`, `shreya`, `kavya`, `roopa`, `simran`, `suhani`, `kavitha`, `rupali`, `ritu`, `tanya`, `shruti`
Male: `abhilash`, `karun`, `hitesh`, `aditya`, `rahul`, `rohan`, `amit`, `dev`, `ratan`, `varun`, `manan`, `sumit`, `kabir`, `aayan`, `shubh`, `ashutosh`, `advait`, `tarun`, `sunny`, `mani`, `gokul`, `vijay`, `mohit`, `rehan`, `soham`, `anand`
Neutral: `amelia`, `sophia`

Default for Aria: `anushka` (warm female voice)

---

## Google Gemini (testing / personal laptop)

Use Gemini when Azure OpenAI is not available (e.g., personal laptops, local testing).

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=<GEMINI_API_KEY>
Content-Type: application/json

{
  "systemInstruction": {
    "parts": [{ "text": "You are Aria, a warm support specialist for Trane and Thermoking..." }]
  },
  "contents": [
    { "role": "user",  "parts": [{ "text": "My unit is not cooling." }] },
    { "role": "model", "parts": [{ "text": "I'm sorry to hear that..." }] },
    { "role": "user",  "parts": [{ "text": "It's a Trane XR15." }] }
  ],
  "generationConfig": {
    "maxOutputTokens": 300,
    "temperature": 0.9
  }
}
```

**Important differences from OpenAI format:**
- Assistant role is `"model"` not `"assistant"`
- System prompt goes in `systemInstruction.parts[].text`, NOT in `contents[]`
- History is `contents[]`, not `messages[]`
- No `api-key` header — key is a query parameter: `?key=YOUR_KEY`

Response:
```json
{
  "candidates": [{
    "content": {
      "parts": [{ "text": "Let me help you with that..." }],
      "role": "model"
    }
  }]
}
```

Extract: `response.candidates[0].content.parts[0].text`

### CONFIG pattern (dual-backend toggle)

```js
const CONFIG = {
  // Personal / testing laptop: get a free key at aistudio.google.com
  geminiKey: 'YOUR_GEMINI_KEY_HERE',

  // Office laptop: set useAzure: true and fill in Azure credentials
  useAzure: false,
  azureEndpoint: 'https://YOUR-RESOURCE.openai.azure.com',
  azureDeployment: 'gpt-35-turbo',
  azureKey: 'YOUR_AZURE_KEY_HERE',
};
```

```js
async function getAIResponse(userText) {
  if (CONFIG.useAzure && CONFIG.azureEndpoint && CONFIG.azureKey) {
    // Azure path
    const url = `${CONFIG.azureEndpoint}/openai/deployments/${CONFIG.azureDeployment}/chat/completions?api-version=2024-02-15-preview`;
    const body = { messages: buildOpenAIHistory(userText), max_tokens: 300, temperature: 0.9 };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': CONFIG.azureKey }, body: JSON.stringify(body) });
    const data = await res.json();
    return data.choices[0].message.content;
  } else {
    // Gemini path
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.geminiKey}`;
    const contents = buildGeminiHistory(userText); // role:'user'/'model'
    const body = { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { maxOutputTokens: 300, temperature: 0.9 } };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    return data.candidates[0].content.parts[0].text;
  }
}
```

---

## Azure OpenAI

```
POST https://<RESOURCE_NAME>.openai.azure.com/openai/deployments/<DEPLOYMENT_NAME>/chat/completions?api-version=2024-02-15-preview
Content-Type: application/json
api-key: <AZURE_API_KEY>

{
  "messages": [
    {"role": "system", "content": "You are a helpful customer support agent..."},
    {"role": "user", "content": "..."},
    {"role": "assistant", "content": "..."}
  ],
  "max_tokens": 300,
  "temperature": 0.7
}
```

Response:
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "..."
    }
  }]
}
```

### Default system prompt

Use this as the base, and prepend any domain-specific instructions the user provides:

```
You are a helpful, empathetic customer support agent.
Respond in the SAME LANGUAGE the user writes in.
Keep responses concise (2-4 sentences) since they will be read aloud.
When the user mentions their name, remember it and use it naturally.
Extract and note: customer name, issue type, and any contact information shared.
Do not ask for sensitive data like passwords or OTPs.
```

---

## MediaRecorder API (browser)

```js
// Request mic
const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

// Create recorder (webm/opus preferred; falls back to default)
const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
  ? { mimeType: 'audio/webm;codecs=opus' }
  : {};
const recorder = new MediaRecorder(stream, options);

const chunks = [];
recorder.ondataavailable = e => chunks.push(e.data);
recorder.onstop = async () => {
  const blob = new Blob(chunks, { type: recorder.mimeType });
  // send to Sarvam STT
};

recorder.start();   // on button press
recorder.stop();    // on button release
```

---

## Waveform (Web Audio API)

```js
// Live waveform while recording
const audioCtx = new AudioContext();
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 256;
const source = audioCtx.createMediaStreamSource(stream);
source.connect(analyser);

function drawLiveWaveform(canvas) {
  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // draw bars
  const barW = canvas.width / buf.length * 2.5;
  buf.forEach((v, i) => {
    const h = ((v - 128) / 128) * canvas.height * 0.5;
    ctx.fillStyle = '#25D366';
    ctx.fillRect(i * barW, canvas.height / 2 - Math.abs(h), barW - 1, Math.abs(h) * 2 + 2);
  });
}
```

For static playback waveform in a bubble, sample 40 amplitude values from the blob using `OfflineAudioContext` and draw them as fixed bars.
