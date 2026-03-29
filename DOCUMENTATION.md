# Trane & ThermoKing — AI Voice Chat Support Agent
## Complete Technical Documentation

---

## 1. Purpose & Overview

This is a production-grade AI-powered customer support platform for **Trane** (HVAC systems) and **ThermoKing** (transport refrigeration). Customers interact via voice or text chat with **Yazhi**, an AI support specialist that:

- Understands speech in 11 Indian languages + English
- Answers technical questions about HVAC systems, fault codes, maintenance, and refrigeration units using a private knowledge base
- Raises support tickets and saves session transcripts
- Falls back to official trane.com / thermoking.com content when the KB has no answer

The system is designed for contact center deployment — agents manage the knowledge base, customers interact with Yazhi, and sessions are logged for CRM integration.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Customer Browser                      │
│         React SPA (Voice + Text Chat Interface)         │
└─────────────────┬───────────────────────────────────────┘
                  │ /api/*
┌─────────────────▼───────────────────────────────────────┐
│            Node.js / Express  (Port 3001)                │
│                                                          │
│  /api/stt    → Sarvam AI (Speech-to-Text)               │
│  /api/tts    → Sarvam AI (Text-to-Speech)               │
│  /api/chat   → Groq / Azure OpenAI (LLM answer)         │
│  /api/ticket → Excel log + Email notification           │
│  /api/session→ JSON export + CRM webhook                │
│  /api/kb/*   → Knowledge Base admin proxy               │
└─────────────────┬───────────────────────────────────────┘
                  │ HTTP (localhost:8000)
┌─────────────────▼───────────────────────────────────────┐
│          Python / FastAPI  (Port 8000)                   │
│          RAG + Knowledge Graph Service                   │
│                                                          │
│  Pinecone ──────── Vector search (fast, always on)      │
│  Neo4j AuraDB ──── Entity graph (relationships, facts)  │
│  Tavily ───────── Web search fallback (optional)        │
└─────────────────────────────────────────────────────────┘
```

**Data flow for a customer question:**
1. Customer speaks or types
2. Voice → Sarvam STT → text
3. Text sent to Node.js `/api/chat`
4. Node.js queries Python RAG service for grounded context
5. RAG: runs Pinecone + KG search in parallel → merges results
6. Node.js injects context into Yazhi's system prompt
7. Groq / Azure generates answer (stays grounded in KB facts)
8. Answer → Sarvam TTS → customer hears the response

---

## 3. Tech Stack

### Frontend
| Technology | Version | Role |
|---|---|---|
| React | 19.2.4 | UI framework |
| Vite | 8.0.1 | Build tool & dev server |
| Lucide React | 1.7.0 | Icons |
| Web Audio API | browser | Waveform visualisation |
| MediaRecorder API | browser | Hold-to-record mic |

### Backend (Node.js)
| Technology | Version | Role |
|---|---|---|
| Node.js | 18+ | Runtime |
| Express | 4.x | HTTP framework |
| helmet | 7.x | Security headers (CSP, HSTS) |
| express-rate-limit | 7.x | Throttling per endpoint |
| jsonwebtoken | 9.x | JWT agent authentication |
| multer | 1.4.x | Audio/file uploads |
| node-fetch | 2.x | External API calls |
| nodemailer | 8.x | Email (Office365 / Gmail) |
| xlsx | 0.18 | Excel ticket generation |

### RAG Service (Python)
| Technology | Version | Role |
|---|---|---|
| Python | 3.11+ | Runtime |
| FastAPI | 0.115 | Async HTTP framework |
| Uvicorn | 0.30 | ASGI server |
| Pinecone | 6.0+ | Vector database |
| Graphiti Core | 0.28.2 | Knowledge graph extraction |
| Neo4j driver | 5.26+ | AuraDB connection |
| OpenAI SDK | 1.91+ | Azure OpenAI / OpenAI calls |
| PyMuPDF | 1.24 | PDF text extraction |
| python-docx | 1.1 | Word document parsing |
| openpyxl | 3.1 | Excel parsing |
| BeautifulSoup4 | 4.12 | HTML scraping |
| langchain-text-splitters | 0.3 | Recursive chunking |
| certifi | latest | Windows CA bundle for Neo4j TLS |

### External Services
| Service | Purpose |
|---|---|
| Sarvam AI | STT (saarika:v2.5) + TTS (bulbul:v2) — 11 Indian languages |
| Groq (llama-3.1-8b-instant) | Primary LLM — fast, free tier |
| Azure OpenAI | LLM fallback + embeddings (optional) |
| Pinecone (serverless) | Vector store — free tier, AWS us-east-1 |
| Neo4j AuraDB | Cloud graph database — free tier |
| Tavily | Web search fallback (optional) |

---

## 4. Project Structure

```
Customer_Voice_Chat_Support/
│
├── src/                        # Node.js backend
│   ├── server.js               # Express app entry point
│   ├── routes/
│   │   ├── auth.js             # JWT login / token verify
│   │   ├── stt.js              # Speech-to-text proxy
│   │   ├── tts.js              # Text-to-speech proxy
│   │   ├── chat.js             # AI chat + RAG injection
│   │   ├── session.js          # Session save + CRM webhook
│   │   ├── ticket.js           # Excel tickets + email
│   │   └── kb.js               # Knowledge base admin proxy
│   ├── middleware/
│   │   ├── auth.js             # JWT middleware
│   │   ├── rateLimiter.js      # Per-endpoint rate limits
│   │   └── sanitize.js         # XSS + injection prevention
│   └── public/                 # Compiled React SPA (auto-generated)
│
├── chat_UI/                    # React frontend (Vite)
│   ├── src/
│   │   ├── App.jsx             # Root: screen routing + auth state
│   │   └── components/
│   │       ├── WelcomeScreen.jsx      # Landing page
│   │       ├── IntakeForm.jsx         # Pre-chat customer form
│   │       ├── VoicePanel.jsx         # Main chat + voice interface
│   │       ├── KnowledgeBaseAdmin.jsx # Agent KB management UI
│   │       ├── FluidVisualizer.jsx    # Audio waveform canvas
│   │       ├── ChatSupport.jsx        # Message bubble renderer
│   │       ├── OptionsGrid.jsx        # Quick-action chips
│   │       └── Transcript.jsx         # Message history
│   ├── public/                 # Static images + icons
│   └── vite.config.js          # Proxy /api → :3001, outDir → src/public
│
├── rag_service/                # Python FastAPI microservice
│   ├── main.py                 # FastAPI app + all endpoints
│   ├── ingestion.py            # Document pipeline + Pinecone
│   ├── kg_graph.py             # Graphiti + Neo4j knowledge graph
│   ├── web_search.py           # Tavily fallback search
│   ├── requirements.txt        # Python dependencies
│   ├── .env                    # RAG service secrets (not committed)
│   └── .env.example            # Secrets template
│
├── exports/                    # Auto-generated session exports
│   ├── session-*.json          # Chat session transcripts
│   └── tickets.xlsx            # Accumulated support tickets
│
├── docs/
│   └── BACKEND.md              # Backend integration guide
│
├── .env                        # Backend secrets (not committed)
├── .env.example                # Backend secrets template
├── package.json                # Backend Node.js dependencies
└── DOCUMENTATION.md            # This file
```

---

## 5. Functionality

### 5.1 Customer Flow

**Step 1 — Welcome Screen**
Customer lands on the branded welcome page showing Trane + ThermoKing logos. Clicks "Start Session".

**Step 2 — Intake Form**
Customer fills in:
- Name (required)
- Phone number with country code
- Email address
- Location / city
- Issue category (AC not cooling, fault code, installation, etc.)

This data is cached in browser session and sent as a `customerContext` note to the backend with every message — so Yazhi knows the customer's name and issue without asking again.

**Step 3 — Voice / Text Chat**
Main interface with Yazhi. Two modes:

- **Voice mode**: Hold the mic button → speak → release → Yazhi answers in voice
- **Text mode**: Type in the chat box → Yazhi replies in text

**Session End**
Yazhi detects farewell phrases ("thank you", "bye", "that's all", etc.) in both voice and text. Shows a 4-second countdown banner, then opens a session summary modal with:
- Full transcript
- Customer details
- Option to download session JSON
- Option to raise a support ticket

---

### 5.2 Knowledge Base (RAG + KG)

#### How it works

Every question goes through a **dual-layer retrieval** before Yazhi answers:

**Layer 1 — Pinecone Vector Search**
- Document chunks are embedded (768-dim or 1536-dim vectors)
- Question is embedded and compared via cosine similarity
- Returns top-K most similar text chunks from uploaded manuals
- Fast (~100ms), always available

**Layer 2 — Neo4j Knowledge Graph**
- Graphiti extracts entities (products, components, fault codes, symptoms) and their relationships from document chunks
- Graph search finds connected facts ("Fault code E5 → caused by → refrigerant leak → which → affects → TK SLXi 400")
- Returns structured facts, not raw text
- Slower (500ms–2s), adds relationship-aware context

**Merged answer**
Both results are combined into a single context block injected into Yazhi's system prompt:
```
## DOCUMENT KNOWLEDGE
[Document: manual.pdf | Category: service]
The E5 fault code indicates refrigerant pressure out of range...

## PRODUCT RELATIONSHIPS & FACTS (Knowledge Graph)
• E5 fault → caused by → refrigerant leak
• TK SLXi 400 → requires refrigerant → R-404A
```

**Fallback hierarchy:**
1. KB + KG results → grounded answer
2. Tavily web search → trane.com / thermoking.com content
3. Nothing found → Yazhi says she doesn't have that information (no hallucination)

#### Embedding strategy (auto-detected at startup)
1. **Azure OpenAI** (`text-embedding-3-small`, 1536-dim) — if `AZURE_ENDPOINT` + `AZURE_KEY` are set and reachable
2. **Pinecone built-in** (`multilingual-e5-large`, 768-dim) — fallback, no external key needed, supports 100+ languages

#### Supported file formats for upload
| Format | Parser |
|---|---|
| PDF | PyMuPDF |
| DOCX (Word) | python-docx |
| XLSX (Excel) | openpyxl |
| TXT | plain read |
| HTML / URLs | BeautifulSoup |

---

### 5.3 Ticketing & Session Export

**Support Ticket** (`POST /api/ticket`)
- Generates a unique ticket ID (format: `TK-YYYYMMDD-XXXX`)
- Appends a row to `exports/tickets.xlsx`
- Sends email notification to the support team inbox (`CS_EMAIL` env var)
- Email includes: customer name, phone, issue, transcript summary

**Session Export** (`POST /api/session`)
- Saves full session as `exports/session-{timestamp}-{name}.json`
- Optionally POSTs to a CRM webhook URL (`CRM_WEBHOOK_URL`) with HMAC authentication
- Payload includes: customer profile, full transcript, issue type, agent username, server timestamp

---

### 5.4 Security

| Layer | What's protected |
|---|---|
| Rate limiting | Login (10/15min), STT (30/min), TTS (60/min), Chat (30/min), Session (20/hr) |
| JWT auth | Agent-only KB admin routes — 8-hour tokens |
| Input sanitization | XSS tag stripping on all text inputs |
| Prompt injection | 13 regex patterns block DAN / jailbreak / "reveal system prompt" attacks |
| KG chunk filtering | Same injection patterns applied to uploaded document chunks before KG ingestion |
| Content Security Policy | Helmet CSP headers prevent XSS in browser |
| Server-owned prompts | System prompt never comes from client — always built server-side |
| File size limits | Audio: 10MB, Documents: 50MB |

---

## 6. API Reference

### Node.js Backend (Port 3001)

#### `GET /health`
Returns server status.
```json
{ "status": "ok", "env": "production", "ragService": true }
```

#### `POST /api/login`
Authenticate as support agent.
- Body: `{ "username": "agent1", "password": "secret" }`
- Returns: `{ "token": "eyJ..." }` (8-hour JWT)

#### `POST /api/stt`
Speech to text.
- Body: `multipart/form-data` — field `audio` (audio blob), field `language` (e.g. `"hi-IN"`)
- Returns: `{ "transcript": "customer said..." }`

#### `POST /api/tts`
Text to speech.
- Body: `{ "text": "Hello, how can I help?", "speaker": "anushka", "language": "hi-IN" }`
- Returns: `{ "audio": "<base64 WAV>" }`

#### `POST /api/chat`
Get AI response from Yazhi.
- Body: `{ "messages": [{role, content}, ...], "customerContext": "optional note" }`
- Returns: `{ "reply": "Yazhi's answer" }`

#### `POST /api/session`
Save session transcript.
- Body: full session object (customer profile + transcript)
- Returns: `{ "success": true, "filename": "session-xxx.json" }`

#### `POST /api/ticket`
Raise support ticket.
- Body: `{ "customer": {...}, "issue": "...", "transcript": [...] }`
- Returns: `{ "success": true, "ticketId": "TK-20250101-0042" }`

#### `GET /api/kb/health`  *(requires JWT)*
Check RAG service status.

#### `GET /api/kb/documents`  *(requires JWT)*
List all indexed documents.

#### `POST /api/kb/ingest`  *(requires JWT)*
Upload document to KB.
- Body: `multipart/form-data` — field `file`, field `category`

#### `POST /api/kb/ingest/url`  *(requires JWT)*
Ingest a web page URL.
- Body: `{ "url": "https://...", "category": "service" }`

#### `DELETE /api/kb/documents/:doc_id`  *(requires JWT)*
Remove document from KB and KG.

---

### Python RAG Service (Port 8000)

#### `GET /health`
```json
{
  "status": "ok",
  "vectors": 41,
  "documents": 1,
  "embed_mode": "azure/text-embedding-3-small",
  "kg_enabled": true,
  "web_search": false
}
```

#### `POST /query`
Dual-layer retrieval.
- Body: `{ "question": "What does fault code E5 mean?", "top_k": 5 }`
- Returns merged context with `grounded`, `source`, `chunks`, `kg_facts`

#### `POST /ingest`
Upload file. KG extraction runs in background — returns immediately after Pinecone ingest.

#### `POST /ingest/url`
Ingest URL content.

#### `GET /documents`
List indexed documents with metadata.

#### `DELETE /documents/{doc_id}`
Delete document from Pinecone + schedule KG cleanup.

---

## 7. Environment Variables

### Backend (`/.env`)

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | API port (default: 3001) |
| `NODE_ENV` | No | `production` or `development` |
| `ALLOWED_ORIGIN` | Yes (prod) | CORS origin whitelist |
| `AGENT_USERS` | Yes | JSON: `[{"user":"x","pass":"y"}]` |
| `JWT_SECRET` | Yes | Min 32-char random string |
| `JWT_EXPIRY` | No | Default: `8h` |
| `SARVAM_KEY` | Yes | Sarvam AI subscription key |
| `GROQ_KEY` | Yes* | Groq API key (primary LLM) |
| `AZURE_ENDPOINT` | Yes* | Azure OpenAI resource URL |
| `AZURE_DEPLOYMENT` | No | Azure chat deployment name |
| `AZURE_KEY` | No | Azure OpenAI key |
| `USE_AZURE` | No | `true` to use Azure instead of Groq |
| `RAG_SERVICE_URL` | No | Default: `http://localhost:8000` |
| `CRM_WEBHOOK_URL` | No | URL to POST session JSON |
| `CRM_WEBHOOK_SECRET` | No | Webhook HMAC secret |
| `EXPORTS_DIR` | No | Default: `./exports` |
| `EMAIL_SMTP_HOST` | No | e.g. `smtp.office365.com` |
| `EMAIL_SMTP_PORT` | No | e.g. `587` |
| `EMAIL_USER` | No | Sender email address |
| `EMAIL_PASSWORD` | No | SMTP password |
| `CS_EMAIL` | No | Support team inbox |

*Either `GROQ_KEY` or Azure credentials required.

### RAG Service (`/rag_service/.env`)

| Variable | Required | Description |
|---|---|---|
| `PINECONE_API_KEY` | Yes | Pinecone API key |
| `PINECONE_INDEX_NAME` | No | Default: `trane-thermoking-kb` |
| `PINECONE_CLOUD` | No | Default: `aws` |
| `PINECONE_REGION` | No | Default: `us-east-1` |
| `AZURE_ENDPOINT` | No | Azure OpenAI URL (for embeddings) |
| `AZURE_KEY` | No | Azure OpenAI key |
| `AZURE_API_VERSION` | No | Default: `2024-02-01` |
| `AZURE_EMBED_DEPLOYMENT` | No | Default: `text-embedding-3-small` |
| `AZURE_DEPLOYMENT` | No | Chat model for Graphiti |
| `NEO4J_URI` | No | `neo4j+s://xxxx.databases.neo4j.io` |
| `NEO4J_USER` | No | Always `neo4j` for AuraDB |
| `NEO4J_PASSWORD` | No | AuraDB instance password |
| `OPENAI_API_KEY` | No | Fallback if no Azure |
| `TAVILY_API_KEY` | No | Tavily web search key |
| `KB_STORAGE_PATH` | No | Default: `./knowledge_base` |
| `TOP_K_RESULTS` | No | Default: `5` |
| `MIN_RELEVANCE_SCORE` | No | Default: `0.25` |
| `CHUNK_SIZE` | No | Default: `800` tokens |
| `CHUNK_OVERLAP` | No | Default: `150` tokens |

---

## 8. Setup & Run

### Prerequisites
- Node.js 18+
- Python 3.11+
- Pinecone account (free tier)
- Sarvam AI account (for voice)
- Groq account (free tier, for LLM)
- Neo4j AuraDB account (free tier, for KG — optional)

### Step 1 — Backend
```bash
# From project root
npm install
cp .env.example .env
# Fill in .env with your keys
npm start
# Server running on http://localhost:3001
```

### Step 2 — Frontend
```bash
cd chat_UI
npm install
npm run build      # Outputs to ../src/public
# OR for development with hot reload:
npm run dev        # http://localhost:5173
```

### Step 3 — RAG Service
```bash
cd rag_service
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Mac/Linux
pip install -r requirements.txt
cp .env.example .env
# Fill in .env (minimum: PINECONE_API_KEY)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Step 4 — Upload Knowledge Base Documents
1. Open the app at `http://localhost:3001`
2. Click the `🔑` button (bottom-right)
3. Log in with agent credentials
4. Upload PDF/DOCX service manuals, fault code guides, product specs
5. Each document is indexed into Pinecone immediately; KG extraction runs in background

---

## 9. Code Deep-Dive

### 9.1 VoicePanel.jsx — Chat Engine

The largest file (~42KB) — handles everything in the main chat interface.

**Key state:**
- `chatMessages` — full transcript array `[{role, content, time}]`
- `isChatTyping` — shows typing indicator while Yazhi thinks
- `isRecording` — mic active
- `wrapPending` — session-end countdown active

**Voice loop:**
```
handleMicDown() → MediaRecorder.start()
handleMicUp()   → MediaRecorder.stop() → audioBlob
                → POST /api/stt → transcript text
                → handleChatSend(transcript)

handleChatSend(text):
  1. Append user message to chatMessages
  2. POST /api/chat with full history + customerContext
  3. Append Yazhi's reply to chatMessages
  4. POST /api/tts → base64 WAV → play()
  5. Check CHAT_DONE_PATTERNS → startWrapCountdown()
```

**Session-end detection:**
```javascript
const CHAT_DONE_PATTERNS = [
  /\b(bye|goodbye|that'?s?\s+all|no\s+more|all\s+good|thank\s+you|thanks)\b/i,
  /\b(i'?m\s+(done|good|fine|set))\b/i,
  // ... 8 more patterns
]
```
Detected in both user messages (text and voice). Triggers a 4-second countdown — customer can cancel. On expiry: `setShowSummary(true)`.

### 9.2 chat.js — RAG Injection

```javascript
// 1. Pull latest user message
const lastUserMsg = messages.reverse().find(m => m.role==='user')?.content

// 2. Query Python RAG service
const rag = await getKBContext(lastUserMsg)  // 8s timeout

// 3. Build system prompt
let systemPrompt = BASE_SYSTEM_PROMPT       // Yazhi's personality + guardrails
if (customerContext) systemPrompt += customerContext

if (rag.grounded) {
  // Inject grounded KB context
  systemPrompt += `--- COMPANY KNOWLEDGE BASE ---\n${rag.context}`
} else {
  // No KB hit — hard no-hallucinate instruction
  systemPrompt += `NO PRODUCT KNOWLEDGE FOUND — do not guess or invent details`
}

// 4. Call LLM (Groq primary, Azure fallback)
reply = await callGroq(systemPrompt, messages)
```

### 9.3 ingestion.py — Document Pipeline

```python
# Auto-detect embedding mode at startup
_try_azure_embeddings() → sets USE_AZURE_EMBED

# Ingest flow
ingest_file(filename, content, category):
  1. Parse content   → extract_text(filename, content)
  2. Chunk text      → RecursiveCharacterTextSplitter(800, 150)
  3. Embed chunks    → Azure embed OR Pinecone inference
  4. Upsert vectors  → pinecone.index.upsert(vectors, namespace="kb")
  5. Save metadata   → knowledge_base/metadata.json
  6. Return {doc_id, chunks, _chunks (raw text for KG)}
```

### 9.4 kg_graph.py — Knowledge Graph

```python
# Build flow
_build_neo4j_driver():
  - Strips "+s" from neo4j+s:// URI to allow custom ssl_context
  - Injects certifi CA bundle → solves Windows SSL verification failure

_build_graphiti():
  - Azure path: AzureOpenAILLMClient + Azure embedder + identity cross-encoder
  - OpenAI path: OpenAIClient + OpenAI embedder
  - Passes graph_driver (our SSL-fixed driver) to Graphiti

ingest_chunks(doc_id, filename, chunks):
  1. Filter injection patterns from chunks
  2. Per chunk: graphiti.add_episode(episode_body=chunk, group_id=doc_id)
  3. Graphiti calls Azure LLM → extracts (entity, relationship, entity) triples
  4. Stores in Neo4j AuraDB as (Entity)-[RELATES_TO]->(Entity) graph

search(question):
  → graphiti.search(query=question, num_results=8)
  → Returns EdgeResult objects with .fact attribute
  → Deduplicates → [{fact, source: "knowledge_graph"}]
```

### 9.5 main.py — Parallel Dual Search

```python
@app.post("/query")
async def query(req):
  # Run both searches in parallel — don't wait for KG before starting Pinecone
  pinecone_task = asyncio.to_thread(kb.query, req.question, req.top_k)
  kg_task       = kg.search(req.question) if kg.ready else async_empty()

  vector_results, kg_facts = await asyncio.gather(pinecone_task, kg_task)

  # Merge into a single context block
  context = "## DOCUMENT KNOWLEDGE\n" + format(vector_results)
           + "\n\n## PRODUCT RELATIONSHIPS & FACTS\n" + format(kg_facts)

  return {context, grounded: True, source: "knowledge_base+knowledge_graph"}
```

---

## 10. Supported Languages

Sarvam AI supports these language codes for STT and TTS:

| Code | Language |
|---|---|
| `en-IN` | English (India) |
| `hi-IN` | Hindi |
| `ta-IN` | Tamil |
| `te-IN` | Telugu |
| `kn-IN` | Kannada |
| `ml-IN` | Malayalam |
| `mr-IN` | Marathi |
| `gu-IN` | Gujarati |
| `bn-IN` | Bengali |
| `od-IN` | Odia |
| `pa-IN` | Punjabi |

Yazhi auto-detects the customer's language from their messages and responds in the same language.

---

## 11. Known Limitations

1. **KG extraction is slow** — Each PDF chunk requires an LLM call to extract entities. A 41-chunk PDF takes ~5–10 minutes in the background. Pinecone search is available immediately; KG enriches search over time.

2. **AuraDB free tier** — Free Neo4j AuraDB instances pause after 3 days of inactivity. Resume from console.neo4j.io before ingesting new documents.

3. **Groq rate limits** — Free Groq tier has token-per-minute limits. Under high load, the fallback is Azure OpenAI.

4. **Audio browser support** — Hold-to-record requires HTTPS in production (browser mic permission policy). Use `localhost` for development.

5. **Chunking splits context** — Very long procedural steps (e.g. 20-step installation guides) may split across chunks. Increasing `CHUNK_SIZE` to 1200 improves coherence at the cost of more tokens per search.

---

## 12. Security Notes

- **Never commit `.env` files.** Both `/.env` and `/rag_service/.env` are in `.gitignore`.
- **Rotate keys if exposed.** If a Pinecone or Neo4j key appears in logs or git history, regenerate it immediately.
- **JWT_SECRET** should be at least 32 random characters. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- **AGENT_USERS passwords** should be hashed in production. Currently stored as plain text in env — replace with bcrypt before production deployment.
- **CRM webhook** uses HMAC-SHA256 signature in `X-Webhook-Signature` header to prevent spoofing.
