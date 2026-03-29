import React, { useState, useRef } from 'react';
import './App.css';
import WelcomeScreen from './components/WelcomeScreen';
import IntakeForm from './components/IntakeForm';
import VoicePanel from './components/VoicePanel';
import KnowledgeBaseAdmin from './components/KnowledgeBaseAdmin';

// ── Session cache ─────────────────────────────────────────────
const CACHE_KEY = 'trane_session_v1';
const saveCache  = d => { try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {} };
const loadCache  = ()  => { try { const r = sessionStorage.getItem(CACHE_KEY); return r ? JSON.parse(r) : null; } catch { return null; } };
const clearCache = ()  => { try { sessionStorage.removeItem(CACHE_KEY); } catch {} };

// ── Build customer context note (injected server-side into system prompt) ─
function buildCustomerContext(name, phone, cc, email, location) {
  return [
    `SYSTEM NOTE — Customer already completed a pre-chat intake form.`,
    `DO NOT ask for name or phone — you already have them:`,
    `  Name    : ${name}`,
    `  Phone   : ${cc} ${phone}`,
    email    ? `  Email   : ${email}`    : null,
    location ? `  Location: ${location}` : null,
    ``,
    `YOUR FIRST MESSAGE: greet "${name}" warmly by name, introduce yourself as Yazhni, and tell them you're ready to help. Keep it to 1-2 sentences. Do NOT ask for name or contact info.`,
  ].filter(Boolean).join('\n');
}

function App() {
  const cached = loadCache();
  const [currentScreen, setCurrentScreen] = useState(
    cached?.name ? 'voice' : 'welcome'
  );
  const [showKBAdmin,  setShowKBAdmin]  = useState(false);
  const [agentToken,   setAgentToken]   = useState(() => sessionStorage.getItem('agent_token') || '');
  const [loginModal,   setLoginModal]   = useState(false);
  const [loginErr,     setLoginErr]     = useState('');
  const [loginForm,    setLoginForm]    = useState({ user: '', pass: '' });

  const handleAgentLogin = async () => {
    setLoginErr('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.user, password: loginForm.pass }),
      });
      const d = await r.json();
      if (!r.ok) { setLoginErr(d.error || 'Login failed'); return; }
      sessionStorage.setItem('agent_token', d.token);
      setAgentToken(d.token);
      setLoginModal(false);
      setShowKBAdmin(true);
    } catch { setLoginErr('Network error'); }
  };

  const openKBAdmin = () => {
    if (agentToken) { setShowKBAdmin(true); }
    else { setLoginModal(true); }
  };

  const messagesRef      = useRef([]);
  const customerCtxRef   = useRef(cached?.name
    ? buildCustomerContext(cached.name, cached.phone, cached.cc || '+91', cached.email || '', cached.location || '')
    : null
  );
  const sessionDataRef   = useRef({
    name: cached?.name || '',
    contact: cached ? `${cached.cc || '+91'} ${cached.phone}${cached.email ? ' / ' + cached.email : ''}` : '',
    location: cached?.location || '',
    type: '', product: '', issue: '', purchaseIntent: false,
  });

  // ── Intake form submit ────────────────────────────────────────
  const handleIntakeSubmit = ({ name, phone, cc, email, location }) => {
    const ctx = buildCustomerContext(name, phone, cc, email, location);
    customerCtxRef.current = ctx;
    sessionDataRef.current = {
      ...sessionDataRef.current,
      name,
      contact: `${cc} ${phone}${email ? ' / ' + email : ''}`,
      location: location || '',
    };
    saveCache({ name, phone, cc, email, location });
    setCurrentScreen('voice');
  };

  // ── getAIResponse — sends customerContext to backend (not full system prompt) ─
  const getAIResponse = async (userText) => {
    const ctx = customerCtxRef.current;
    const isInit = userText === '__INIT__';

    if (!isInit) {
      messagesRef.current = [...messagesRef.current, { role: 'user', content: userText }];
    }

    // customerContext: only the customer note (stripped of first-message directive for follow-ups)
    const customerContext = ctx
      ? (isInit ? ctx : ctx.split('YOUR FIRST MESSAGE')[0].trim())
      : null;

    const apiMessages = isInit
      ? [{ role: 'user', content: ctx || 'Greet the customer warmly, introduce yourself as Yazhni, and ask for their name. Keep it to 1-2 sentences.' }]
      : (() => {
          const hist = messagesRef.current.map(m => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          }));
          if (hist.length && hist[0].role === 'assistant') hist.unshift({ role: 'user', content: '[session started]' });
          return hist;
        })();

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, customerContext }),
    });
    if (!res.ok) throw new Error(`Chat API ${res.status}: ${await res.text()}`);
    const reply = (await res.json()).reply || '';
    messagesRef.current = [...messagesRef.current, { role: 'assistant', content: reply }];
    return reply;
  };

  // ── End session — saves JSON, raises ticket ─────────────────
  const handleEndSession = async ({ agentNotes = '', priority = 'Normal', currentLang = 'en-IN', issueSummary = '' } = {}) => {
    const sd = sessionDataRef.current;
    const transcript = messagesRef.current;
    const messageCount = transcript.filter(m => m.role === 'user').length;

    // Use agent-provided issueSummary if available, else fall back to session type
    const issueDetails = issueSummary.trim() || sd.issue || sd.type || 'See transcript';

    const payload = {
      timestamp: new Date().toISOString(),
      brand: 'Trane & ThermoKing',
      customer: { name: sd.name, contact: sd.contact, location: sd.location },
      inquiry: {
        type: sd.type || 'General',
        product: sd.product,
        issue: issueDetails,
        purchaseIntent: sd.purchaseIntent,
      },
      priority, agentNotes, language: currentLang,
      messageCount, transcript,
    };

    fetch('/api/session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});

    let ticketResult = { ticketId: null, emailSent: false, customerEmailed: false };
    try {
      const r = await fetch('/api/ticket', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) ticketResult = await r.json();
    } catch {}

    return ticketResult;
  };

  const handleSessionDone = () => {
    clearCache();
    messagesRef.current = [];
    customerCtxRef.current = null;
    sessionDataRef.current = { name: '', contact: '', location: '', type: '', product: '', issue: '', purchaseIntent: false };
    setCurrentScreen('welcome');
  };

  return (
    <div className="app-container">
      <div className="ambient-orb orb-1"></div>
      <div className="ambient-orb orb-2"></div>
      <div className="ambient-orb orb-3"></div>

      {/* ── Agent KB Admin button (bottom-right, always visible) ── */}
      <button onClick={openKBAdmin} title="Knowledge Base Admin" style={{
        position: 'fixed', bottom: 18, right: 18, zIndex: 300,
        width: 40, height: 40, borderRadius: '50%',
        background: 'rgba(169,112,255,0.12)', border: '1px solid rgba(169,112,255,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        fontSize: 17, color: 'rgba(255,255,255,0.5)', transition: 'all 0.2s',
      }}>🔑</button>

      {/* ── Agent login modal ── */}
      {loginModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#0e0822', border: '1px solid rgba(169,112,255,0.3)', borderRadius: 18, padding: 28, width: 320 }}>
            <h3 style={{ color: '#fff', marginBottom: 16, fontSize: 15 }}>Agent Login</h3>
            <input placeholder="Username" value={loginForm.user}
              onChange={e => setLoginForm(p => ({ ...p, user: e.target.value }))}
              style={{ width: '100%', marginBottom: 10, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(169,112,255,0.25)', color: '#fff', outline: 'none', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
            <input type="password" placeholder="Password" value={loginForm.pass}
              onChange={e => setLoginForm(p => ({ ...p, pass: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAgentLogin()}
              style={{ width: '100%', marginBottom: 12, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(169,112,255,0.25)', color: '#fff', outline: 'none', fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box' }} />
            {loginErr && <p style={{ color: '#fca5a5', fontSize: 12, marginBottom: 10 }}>{loginErr}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAgentLogin} style={{ flex: 1, padding: '9px', background: 'linear-gradient(135deg,#7c3aed,#A970FF)', border: 'none', borderRadius: 10, color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Login</button>
              <button onClick={() => { setLoginModal(false); setLoginErr(''); }} style={{ padding: '9px 14px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 10, color: 'rgba(255,255,255,0.7)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── KB Admin panel ── */}
      {showKBAdmin && <KnowledgeBaseAdmin authToken={agentToken} onClose={() => setShowKBAdmin(false)} />}

      {currentScreen === 'welcome' && (
        <div className="screen-wrapper fade-in-screen">
          <WelcomeScreen onStart={() => setCurrentScreen('intake')} />
        </div>
      )}

      {currentScreen === 'intake' && (
        <div className="screen-wrapper fade-in-screen">
          <IntakeForm
            onSubmit={handleIntakeSubmit}
            onBack={() => setCurrentScreen('welcome')}
          />
        </div>
      )}

      {currentScreen === 'voice' && (
        <div className="screen-wrapper fade-in-screen">
          <VoicePanel
            onBack={() => { clearCache(); setCurrentScreen('welcome'); }}
            getAIResponse={getAIResponse}
            sessionDataRef={sessionDataRef}
            onEndSession={handleEndSession}
            onSessionDone={handleSessionDone}
          />
        </div>
      )}
    </div>
  );
}

export default App;
