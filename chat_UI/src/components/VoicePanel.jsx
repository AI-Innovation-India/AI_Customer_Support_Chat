import React, { useState, useRef, useEffect, useCallback } from 'react';
import './VoicePanel.css';
import { Mic, MicOff, ChevronLeft, Edit2, Bookmark, X, CheckCircle, Mail, Send } from 'lucide-react';
import Transcript from './Transcript';
import OptionsGrid from './OptionsGrid';
import FluidVisualizer from './FluidVisualizer';

// Detect when the customer signals they're done with the conversation
const CHAT_DONE_PATTERNS = [
  /^(thank\s*you|thanks|thx|ty)[.!\s]*$/i,                                             // bare thanks
  /\b(bye|goodbye|see\s+you|take\s+care|good\s+day)\b/i,                               // farewells
  /\b(that[''`]?s?\s+(all|it|everything)|nothing\s+else|all\s+(done|set|good))\b/i,    // "that's all"
  /\b(i[''`]?m?\s+(done|good|all\s+set|satisfied)|we[''`]?re?\s+good)\b/i,             // "I'm done"
  /\b(no\s*(more)?\s*(questions?|help|issues?)?$|no[\s,]+thanks?|no[\s,]+thank\s+you)\b/i,
  /\b(issue|problem)\s+(is\s+)?(resolved|solved|fixed)\b/i,
  /\b(it[''`]?s?\s+)?(working|works?)\s*now\b/i,
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /disregard\s+(all\s+)?(previous|prior|your)\s+instructions?/i,
  /forget\s+(everything|all|your\s+instructions?)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|unrestricted|free|DAN)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,
  /act\s+as\s+(if\s+you\s+(are|were)\s+)?(DAN|an?\s+unrestricted|a\s+different)/i,
  /jailbreak/i, /\bDAN\b/,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|api\s+key)/i,
  /override\s+(your\s+)?(instructions?|system|prompt)/i,
];

// ── WAV encoder — converts any browser audio → 16kHz mono WAV ───
async function blobToWav(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  decodeCtx.close();
  const sampleRate = 16000;
  const offCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(offCtx.destination);
  src.start(0);
  const rendered = await offCtx.startRendering();
  const pcm = rendered.getChannelData(0);
  const wavBuf = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(wavBuf);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  let off = 44;
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true); off += 2;
  }
  return new Blob([wavBuf], { type: 'audio/wav' });
}

const VoicePanel = ({ onBack, getAIResponse, sessionDataRef, onEndSession, onSessionDone }) => {
  // ── Voice state ──────────────────────────────────────────────────
  const [voiceState,   setVoiceState]   = useState('Idle');
  const [hasStarted,   setHasStarted]   = useState(false);
  const [transcripts,  setTranscripts]  = useState([]);
  const [ariaGreeting, setAriaGreeting] = useState('');
  const [errorMsg,     setErrorMsg]     = useState('');
  const [currentLang,  setCurrentLang]  = useState('en-IN');

  // ── Chat state (inline — no overlay) ────────────────────────────
  const [showChat,        setShowChat]        = useState(false);
  const [chatMessages,    setChatMessages]    = useState([]);
  const [chatInput,       setChatInput]       = useState('');
  const [isChatTyping,    setIsChatTyping]    = useState(false);
  const [chatWrapCountdown, setChatWrapCountdown] = useState(null); // null | 4 | 3 | 2 | 1
  const chatEndRef      = useRef(null);
  const wrapTimerRef    = useRef(null);

  // ── Session / ticket state ───────────────────────────────────────
  const [showSummary,  setShowSummary]  = useState(false);
  const [agentNotes,   setAgentNotes]   = useState('');
  const [priority,     setPriority]     = useState('Normal');
  const [issueSummary, setIssueSummary] = useState('');
  const [ticketStatus, setTicketStatus] = useState(null);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null);
  const currentAudioRef  = useRef(null);
  const isRecordingRef   = useRef(false);
  const voiceStateRef    = useRef('Idle');
  const transcriptEndRef = useRef(null);

  const setVoiceStateSynced = (s) => { voiceStateRef.current = s; setVoiceState(s); };

  // ── TTS ──────────────────────────────────────────────────────────
  const speakText = useCallback(async (text) => {
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: [text], target_language_code: currentLang,
          speaker: 'anushka', model: 'bulbul:v2',
          pitch: 0, pace: 1.0, loudness: 1.5, speech_sample_rate: 8000, enable_preprocessing: true,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.audios?.[0]) return;
      const audio = new Audio(`data:audio/wav;base64,${data.audios[0]}`);
      currentAudioRef.current = audio;
      await new Promise(resolve => { audio.onended = resolve; audio.onerror = resolve; audio.play().catch(resolve); });
    } catch {}
    currentAudioRef.current = null;
  }, [currentLang]);

  // ── STT ──────────────────────────────────────────────────────────
  const transcribeAudio = async (rawBlob) => {
    const wavBlob = await blobToWav(rawBlob);
    const fd = new FormData();
    fd.append('file', wavBlob, 'recording.wav');
    fd.append('language_code', currentLang);
    const res = await fetch('/api/stt', { method: 'POST', body: fd });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `STT ${res.status}`); }
    return (await res.json()).transcript || '';
  };

  // ── Greeting on mount ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setVoiceStateSynced('Processing');
        const greeting = await getAIResponse('__INIT__');
        if (cancelled) return;
        setAriaGreeting(greeting);
        setVoiceStateSynced('Responding');
        await speakText(greeting);
      } catch {}
      if (!cancelled) setVoiceStateSynced('Idle');
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll ──────────────────────────────────────────────────
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [transcripts]);

  useEffect(() => {
    if (chatMessages.length > 0 || isChatTyping) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [chatMessages, isChatTyping]);

  // ── Wrap-up countdown ────────────────────────────────────────────
  const startWrapCountdown = () => {
    clearInterval(wrapTimerRef.current);
    setChatWrapCountdown(4);
    let count = 4;
    wrapTimerRef.current = setInterval(() => {
      count -= 1;
      if (count <= 0) {
        clearInterval(wrapTimerRef.current);
        setChatWrapCountdown(null);
        setShowChat(false);
        setShowSummary(true);
      } else {
        setChatWrapCountdown(count);
      }
    }, 1000);
  };

  const cancelWrap = () => {
    clearInterval(wrapTimerRef.current);
    setChatWrapCountdown(null);
  };

  // ── Chat send ────────────────────────────────────────────────────
  const handleChatSend = async (textOverride) => {
    const text = (textOverride !== undefined ? textOverride : chatInput).trim();
    if (!text || isChatTyping) return;
    if (text.length > 1000) { setChatInput(''); return; }
    cancelWrap(); // reset any pending countdown if user sends a new message
    if (INJECTION_PATTERNS.some(p => p.test(text))) {
      setChatMessages(prev => [...prev,
        { id: Date.now(),     sender: 'user', text },
        { id: Date.now() + 1, sender: 'ai',   text: "I'm here to help with Trane and ThermoKing support only." },
      ]);
      setChatInput('');
      return;
    }
    const isDone = CHAT_DONE_PATTERNS.some(p => p.test(text));
    setChatMessages(prev => [...prev, { id: Date.now(), sender: 'user', text }]);
    setChatInput('');
    setIsChatTyping(true);
    try {
      const aiText = await getAIResponse(text);
      setIsChatTyping(false);
      setChatMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ai', text: aiText }]);
      speakText(aiText).catch(() => {});
      if (isDone) startWrapCountdown();
    } catch {
      setIsChatTyping(false);
      setChatMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ai', text: 'Error. Please try again.' }]);
    }
  };

  const handleChatKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  };

  // ── Option card selected ─────────────────────────────────────────
  const handleOptionSelect = async (option) => {
    if (voiceStateRef.current === 'Listening' || voiceStateRef.current === 'Processing') return;
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
    setHasStarted(true);
    setVoiceStateSynced('Processing');
    setErrorMsg('');
    sessionDataRef.current = { ...sessionDataRef.current, type: option.value, issue: option.value, purchaseIntent: option.value === 'Purchase Inquiry' };
    try {
      const aiText = await getAIResponse(option.aiText);
      setTranscripts(prev => [...prev, { user: option.title, ai: aiText }]);
      setVoiceStateSynced('Responding');
      await speakText(aiText);
    } catch (err) { setErrorMsg(err.message); }
    setVoiceStateSynced('Idle');
  };

  // ── Mic ──────────────────────────────────────────────────────────
  const handleMicClick = async () => {
    if (isRecordingRef.current) { stopRecording(); return; }
    const state = voiceStateRef.current;
    if (state === 'Processing') return;
    if (state === 'Responding') {
      if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
      setVoiceStateSynced('Idle');
    }
    await startRecording();
  };

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    setErrorMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm')             ? 'audio/webm' :
        MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')  ? 'audio/ogg;codecs=opus' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size) audioChunksRef.current.push(e.data); };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      isRecordingRef.current = true;
      setVoiceStateSynced('Listening');
    } catch { setErrorMsg('Microphone access denied. Use text chat instead.'); }
  };

  const stopRecording = () => {
    if (!isRecordingRef.current || !mediaRecorderRef.current) return;
    isRecordingRef.current = false;
    mediaRecorderRef.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    setVoiceStateSynced('Processing');
    mediaRecorderRef.current.onstop = async () => {
      const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
      const rawBlob = new Blob(audioChunksRef.current, { type: mimeType });
      if (rawBlob.size < 500) { setVoiceStateSynced('Idle'); return; }
      try {
        const userText = await transcribeAudio(rawBlob);
        if (!userText?.trim()) { setVoiceStateSynced('Idle'); return; }
        if (INJECTION_PATTERNS.some(p => p.test(userText))) {
          setTranscripts(prev => [...prev, { user: userText, ai: "I'm here to help with Trane and ThermoKing support only." }]);
          setHasStarted(true); setVoiceStateSynced('Idle'); return;
        }
        if (!sessionDataRef.current.product) {
          if (/thermoking|thermo king|reefer|truck|van/i.test(userText))
            sessionDataRef.current = { ...sessionDataRef.current, product: 'ThermoKing' };
          else if (/trane|hvac|ac|air condition|chiller/i.test(userText))
            sessionDataRef.current = { ...sessionDataRef.current, product: 'Trane HVAC' };
        }
        const isDone = CHAT_DONE_PATTERNS.some(p => p.test(userText));
        const aiText = await getAIResponse(userText);
        setTranscripts(prev => [...prev, { user: userText, ai: aiText }]);
        setHasStarted(true);
        setVoiceStateSynced('Responding');
        await speakText(aiText);
        if (isDone) {
          // Small pause so the farewell audio finishes, then auto-go to summary
          setTimeout(() => setShowSummary(true), 1500);
          return;
        }
      } catch (err) { setErrorMsg(err.message); }
      setVoiceStateSynced('Idle');
    };
  };

  // ── End session ──────────────────────────────────────────────────
  const handleEndSession = async () => {
    setTicketStatus({ loading: true });
    try {
      const result = await onEndSession({ agentNotes, priority, currentLang, issueSummary });
      setTicketStatus({ ...result, loading: false });
    } catch {
      setTicketStatus({ ticketId: null, emailSent: false, customerEmailed: false, loading: false });
    }
  };

  const getStatusText = () => {
    switch (voiceStateRef.current) {
      case 'Idle':       return 'Tap 🎤 to speak';
      case 'Listening':  return 'Listening… tap 🎤 again to send';
      case 'Processing': return 'Processing your message…';
      case 'Responding': return 'Yazhi is responding… tap 🎤 to interrupt';
      default: return '';
    }
  };

  const sd = sessionDataRef.current;
  const isBusy = voiceState === 'Processing';
  const isListening = voiceState === 'Listening';

  // ── CHAT MODE ────────────────────────────────────────────────────
  if (showChat) {
    return (
      <div className="voice-panel-container">

        {/* ── Chat header ── */}
        <div className="voice-header fade-in-up" style={{ marginBottom: 16 }}>
          <button className="icon-glass-button back-btn" onClick={() => setShowChat(false)} title="Back to Voice">
            <Mic size={17} color="#A970FF" />
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2 className="header-title" style={{ fontSize: 16, marginBottom: 2 }}>Text Support</h2>
            <span style={{ fontSize: 10, color: '#5EDCFF', letterSpacing: 1, opacity: 0.9, fontWeight: 600 }}>YAZHI · ONLINE</span>
          </div>
          <button
            onClick={() => { setShowChat(false); setShowSummary(true); }}
            style={{
              fontSize: 11, fontWeight: 700, color: '#fca5a5',
              background: 'rgba(227, 24, 55, 0.15)', border: '1px solid rgba(227, 24, 55, 0.4)',
              borderRadius: 20, padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
              transition: 'all 0.2s',
            }}
          >End Session</button>
        </div>

        {/* ── Messages area ── */}
        <div className="dynamic-content-area" style={{ padding: '12px 16px 4px' }}>
        {/* Inner wrapper: min-height 100% + flex column so messages always pin to bottom */}
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', minHeight: '100%' }}>

          {/* Empty state — vertically centred, takes all available space */}
          {chatMessages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', paddingBottom: 24 }}>
              <div className="glass-panel fade-in-up delay-2" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '32px 24px', maxWidth: 380, width: '100%', background: 'rgba(255,255,255,0.03)' }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(169,112,255,0.2), rgba(94,220,255,0.1))',
                  border: '1px solid rgba(169,112,255,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 0 30px rgba(169,112,255,0.25)',
                }}>
                  <span style={{ fontSize: 26 }}>🤖</span>
                </div>
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                  <h3 className="neon-text-primary" style={{ fontSize: 18, fontWeight: 700, margin: '0 0 6px 0' }}>Hi! I'm Yazhi</h3>
                  <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, margin: 0, lineHeight: 1.4 }}>Ask me anything about Trane or ThermoKing</p>
                </div>
                {/* Quick prompts */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
                  {['My AC is not cooling', 'ThermoKing fault code', 'Schedule a service'].map(q => (
                    <button key={q} onClick={() => handleChatSend(q)}
                      style={{
                        background: 'rgba(169,112,255,0.08)', border: '1px solid rgba(169,112,255,0.2)',
                        borderRadius: 12, padding: '10px 14px', color: 'rgba(255,255,255,0.85)',
                        fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.2s', width: '100%', textAlign: 'center',
                      }} onMouseOver={e => e.currentTarget.style.background = 'rgba(169,112,255,0.2)'} onMouseOut={e => e.currentTarget.style.background = 'rgba(169,112,255,0.08)'}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Spacer — pushes messages to bottom when fewer than fill the panel */}
          {chatMessages.length > 0 && <div style={{ flex: 1 }} />}

          {/* Messages */}
          {chatMessages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', width: '100%', alignItems: 'flex-end', gap: 8, justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
              {msg.sender === 'ai' && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(169,112,255,0.4),rgba(94,220,255,0.2))', border: '1px solid rgba(169,112,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>🤖</div>
              )}
              <div style={{
                maxWidth: '72%', padding: '10px 14px', fontSize: 13, lineHeight: 1.6, borderRadius: 18,
                ...(msg.sender === 'user'
                  ? { background: 'linear-gradient(135deg,#7c3aed,#A970FF)', color: '#fff', borderBottomRightRadius: 4, boxShadow: '0 4px 16px rgba(169,112,255,0.35)' }
                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.88)', borderBottomLeftRadius: 4 }
                ),
              }}>{msg.text}</div>
            </div>
          ))}

          {/* Typing indicator */}
          {isChatTyping && (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,rgba(169,112,255,0.4),rgba(94,220,255,0.2))', border: '1px solid rgba(169,112,255,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 13 }}>🤖</div>
              <div style={{ display: 'flex', gap: 4, padding: '12px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 18, borderBottomLeftRadius: 4 }}>
                {['-0.32s','-0.16s','0s'].map((d,i) => (
                  <span key={i} style={{ display: 'block', width: 7, height: 7, background: '#5EDCFF', borderRadius: '50%', animation: 'bounceDots 1.4s infinite ease-in-out', animationDelay: d }} />
                ))}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>{/* end inner wrapper */}
        </div>

        {/* ── Wrap-up countdown banner ── */}
        {chatWrapCountdown !== null && (
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '8px 16px', gap: 8,
            background: 'linear-gradient(90deg, rgba(124,58,237,0.25), rgba(94,220,255,0.1))',
            borderTop: '1px solid rgba(169,112,255,0.3)',
          }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)' }}>
              Session ending in <strong style={{ color: '#A970FF' }}>{chatWrapCountdown}s</strong>…
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={cancelWrap} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                color: 'rgba(255,255,255,0.8)', fontFamily: 'inherit',
              }}>Keep Chatting</button>
              <button onClick={() => { cancelWrap(); setShowChat(false); setShowSummary(true); }} style={{
                fontSize: 11, padding: '4px 10px', borderRadius: 20, cursor: 'pointer',
                background: 'rgba(220,38,38,0.2)', border: '1px solid rgba(220,38,38,0.4)',
                color: '#fca5a5', fontFamily: 'inherit',
              }}>End Now</button>
            </div>
          </div>
        )}

        {/* ── Input bar (Floating Container) ── */}
        <div className="fade-in-up delay-3" style={{
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
          margin: '10px 16px 20px', padding: '8px',
          background: 'rgba(255, 255, 255, 0.05)', backdropFilter: 'blur(16px)',
          border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 100,
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', width: 'calc(100% - 32px)', maxWidth: 600,
          alignSelf: 'center',
        }}>
          {/* Switch to voice button */}
          <button onClick={() => setShowChat(false)} title="Switch to Voice"
            style={{ width: 44, height: 44, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(169,112,255,0.15)', border: '1px solid rgba(169,112,255,0.3)', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseOver={e => { e.currentTarget.style.background='rgba(169,112,255,0.3)'; e.currentTarget.style.transform='scale(1.05)'; }}
            onMouseOut={e => { e.currentTarget.style.background='rgba(169,112,255,0.15)'; e.currentTarget.style.transform='scale(1)'; }}
          >
            <Mic size={18} color="#A970FF" />
          </button>
          
          <input
            type="text" placeholder="Type your message to Yazhi…"
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={handleChatKey}
            autoFocus
            style={{
              flex: 1, minWidth: 0, background: 'transparent',
              border: 'none', color: '#fff',
              padding: '10px 8px', outline: 'none',
              fontFamily: 'inherit', fontSize: 14,
            }}
          />
          
          <button onClick={handleChatSend} disabled={isChatTyping}
            style={{
              width: 44, height: 44, flexShrink: 0, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: chatInput.trim() ? 'linear-gradient(135deg,#7c3aed,#A970FF)' : 'rgba(255,255,255,0.06)',
              border: chatInput.trim() ? 'none' : '1px solid rgba(255,255,255,0.1)',
              cursor: isChatTyping ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              transform: chatInput.trim() ? 'scale(1.05)' : 'scale(1)',
              boxShadow: chatInput.trim() ? '0 4px 15px rgba(169,112,255,0.5)' : 'none',
            }}>
            <Send size={16} color={chatInput.trim() ? "#fff" : "rgba(255,255,255,0.3)"} style={{ marginLeft: chatInput.trim() ? 2 : 0, transition: 'all 0.2s' }} />
          </button>
        </div>

        {/* Summary overlay (accessible from End Session) */}
        {showSummary && (
          <div className="vp-overlay vp-overlay-summary">
            {ticketStatus && !ticketStatus.loading && ticketStatus.ticketId && (
              <div className="ticket-confirm">
                <CheckCircle size={52} color="#22c55e" style={{ marginBottom: 16 }} />
                <h3 style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>Ticket Raised!</h3>
                <div className="ticket-id-box">
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }}>TICKET ID</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', letterSpacing: 1.5, fontFamily: 'monospace' }}>{ticketStatus.ticketId}</span>
                </div>
                <div className="ticket-status-rows">
                  <div className="ticket-status-row"><span>📊 Excel</span><span style={{ color: '#22c55e' }}>✓ Saved</span></div>
                  {ticketStatus.emailSent && <div className="ticket-status-row"><span><Mail size={14} style={{ verticalAlign: 'middle' }} /> CS Team</span><span style={{ color: '#22c55e' }}>✓ Email sent</span></div>}
                  {ticketStatus.customerEmailed && <div className="ticket-status-row"><span>👤 Customer</span><span style={{ color: '#22c55e' }}>✓ Notified</span></div>}
                </div>
                <button onClick={onSessionDone} style={{ marginTop: 20, padding: '12px 32px', borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#4c1d95)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Done — Start New Session
                </button>
              </div>
            )}
            {ticketStatus?.loading && (
              <div className="ticket-confirm">
                <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
                <p style={{ color: 'rgba(255,255,255,0.7)' }}>Raising ticket & sending email…</p>
              </div>
            )}
            {!ticketStatus && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, width: '100%', maxWidth: 420 }}>
                  <h3 className="neon-text-primary" style={{ fontSize: 16, fontWeight: 700 }}>Session Summary</h3>
                  <button className="icon-close-btn" onClick={() => setShowSummary(false)}><X size={20} color="#fff" /></button>
                </div>
                <div style={{ width: '100%', maxWidth: 420, maxHeight: '100%', overflowY: 'auto' }}>
                  <div className="summary-info-grid" style={{ marginBottom: 12 }}>
                    {[{ label: 'Name', value: sd.name }, { label: 'Contact', value: sd.contact }, { label: 'Location', value: sd.location }, { label: 'Issue', value: sd.type || sd.issue }, { label: 'Product', value: sd.product }].map(({ label, value }) => value ? (
                      <div key={label} className="summary-info-row"><span className="summary-info-label">{label}</span><span className="summary-info-value">{value}</span></div>
                    ) : null)}
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>ISSUE SUMMARY <span style={{ color: '#a78bfa' }}>→ Excel & Email</span></label>
                    <textarea value={issueSummary} onChange={e => setIssueSummary(e.target.value)} placeholder="Brief description of the customer's issue…" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(169,112,255,0.1)', border: '1px solid rgba(169,112,255,0.35)', color: 'white', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', minHeight: 56, outline: 'none' }} />
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>PRIORITY</label>
                    <select value={priority} onChange={e => setPriority(e.target.value)} style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.35)', color: 'white', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', cursor: 'pointer' }}>
                      <option value="Normal">Normal</option>
                      <option value="High">High</option>
                      <option value="Urgent">Urgent</option>
                    </select>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>INTERNAL NOTES</label>
                    <textarea value={agentNotes} onChange={e => setAgentNotes(e.target.value)} placeholder="Internal notes — not shared with customer…" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', minHeight: 56, outline: 'none' }} />
                  </div>
                  <button onClick={handleEndSession} style={{ width: '100%', padding: '13px 0', borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#E31837,#9b1226)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(227,24,55,0.45)' }}>
                    🎫 Raise Ticket & Send Email
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── VOICE MODE ───────────────────────────────────────────────────
  return (
    <div className="voice-panel-container">

      <div className="voice-header fade-in-up">
        <button className="icon-glass-button back-btn" onClick={onBack}>
          <ChevronLeft size={20} color="#FFF" />
        </button>
        <h2 className="header-title">Voice Support</h2>
        <div className="header-spacer"></div>
      </div>

      <div style={{ paddingBottom: 4, width: '100%', paddingLeft: 20, paddingRight: 20, flexShrink: 0 }}>
        <select value={currentLang} onChange={e => setCurrentLang(e.target.value)} style={{ background: 'rgba(169,112,255,0.12)', border: '1px solid rgba(169,112,255,0.3)', color: 'rgba(255,255,255,0.7)', borderRadius: 20, padding: '4px 12px', fontSize: 11, fontFamily: 'inherit', outline: 'none', cursor: 'pointer' }}>
          <option value="en-IN">English (India)</option>
          <option value="hi-IN">हिन्दी (Hindi)</option>
          <option value="ta-IN">தமிழ் (Tamil)</option>
          <option value="te-IN">తెలుగు (Telugu)</option>
          <option value="kn-IN">ಕನ್ನಡ (Kannada)</option>
          <option value="ml-IN">മലയാളം (Malayalam)</option>
          <option value="mr-IN">मराठी (Marathi)</option>
          <option value="bn-IN">বাংলা (Bengali)</option>
          <option value="gu-IN">ગుజरাতী (Gujarati)</option>
        </select>
      </div>

      <p className="status-text neon-text-secondary">{getStatusText()}</p>
      <FluidVisualizer isActive={isListening} />

      {errorMsg && (
        <p style={{ color: '#fca5a5', fontSize: 12, textAlign: 'center', padding: '0 24px', marginBottom: 8 }}>
          ⚠️ {errorMsg}
        </p>
      )}

      <div className="dynamic-content-area fade-in-up delay-2">
        {voiceState === 'Idle' && !hasStarted && (
          <>
            {ariaGreeting && (
              <div className="aria-greeting-box glass-panel">
                <span className="aria-label neon-text-primary">Yazhi</span>
                <p className="aria-greeting-text">{ariaGreeting}</p>
              </div>
            )}
            <OptionsGrid onOptionSelect={handleOptionSelect} />
          </>
        )}
        {isListening && <div className="abstract-description"><p>Listening… speak clearly, then tap the mic to send.</p></div>}
        {isBusy && <div className="abstract-description"><p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>Processing…</p></div>}
        {hasStarted && transcripts.length > 0 && (
          <div className="transcript-history">
            {transcripts.map((t, i) => <Transcript key={i} userSpeech={t.user} AIResponse={t.ai} />)}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      <div className="bottom-controls fade-in-up delay-3">
        <button className="control-btn" onClick={() => setShowChat(true)} title="Text Chat">
          <Edit2 size={20} color="#E5E7EB" />
        </button>
        <div className="microphone-container">
          <div className={`mic-rings ${isListening ? 'mic-rings-active' : ''}`}></div>
          <button className={`mic-button ${isListening ? 'mic-active' : ''} ${isBusy ? 'mic-disabled' : ''}`} onClick={handleMicClick} disabled={isBusy} title={isListening ? 'Tap to send' : 'Tap to speak'}>
            {isListening ? <MicOff size={28} color="#A970FF" /> : <Mic size={28} color={isBusy ? 'rgba(255,255,255,0.3)' : '#FFFFFF'} />}
          </button>
          {isListening && <div className="mic-ripple" />}
        </div>
        <button className="control-btn" onClick={() => setShowSummary(true)} title="Session Summary">
          <Bookmark size={20} color="#E5E7EB" />
        </button>
      </div>

      {showSummary && (
        <div className="vp-overlay vp-overlay-summary">
          {ticketStatus && !ticketStatus.loading && ticketStatus.ticketId && (
            <div className="ticket-confirm">
              <CheckCircle size={52} color="#22c55e" style={{ marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>Ticket Raised!</h3>
              <div className="ticket-id-box">
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 }}>TICKET ID</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: '#a78bfa', letterSpacing: 1.5, fontFamily: 'monospace' }}>{ticketStatus.ticketId}</span>
              </div>
              <div className="ticket-status-rows">
                <div className="ticket-status-row"><span>📊 Excel</span><span style={{ color: '#22c55e' }}>✓ Saved to tickets.xlsx</span></div>
                {ticketStatus.emailSent ? (
                  <div className="ticket-status-row"><span><Mail size={14} style={{ verticalAlign: 'middle' }} /> CS Team</span><span style={{ color: '#22c55e' }}>✓ Email sent</span></div>
                ) : (
                  <div className="ticket-status-row"><span><Mail size={14} style={{ verticalAlign: 'middle' }} /> CS Team</span><span style={{ color: '#fbbf24' }}>Configure CS_EMAIL in .env</span></div>
                )}
                {ticketStatus.customerEmailed && <div className="ticket-status-row"><span>👤 Customer CC</span><span style={{ color: '#22c55e' }}>✓ Notified</span></div>}
              </div>
              <button onClick={onSessionDone} style={{ marginTop: 20, padding: '12px 32px', borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#4c1d95)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(124,58,237,0.5)' }}>
                Done — Start New Session
              </button>
            </div>
          )}
          {ticketStatus?.loading && (
            <div className="ticket-confirm">
              <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
              <p style={{ color: 'rgba(255,255,255,0.7)' }}>Raising ticket & sending email…</p>
            </div>
          )}
          {!ticketStatus && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="neon-text-primary" style={{ fontSize: 16, fontWeight: 700 }}>Session Summary</h3>
                <button className="icon-close-btn" onClick={() => setShowSummary(false)}><X size={20} color="#fff" /></button>
              </div>
              <div className="summary-info-grid">
                {[{ label: 'Name', value: sd.name }, { label: 'Contact', value: sd.contact }, { label: 'Location', value: sd.location }, { label: 'Issue', value: sd.type || sd.issue }, { label: 'Product', value: sd.product }].map(({ label, value }) => value ? (
                  <div key={label} className="summary-info-row"><span className="summary-info-label">{label}</span><span className="summary-info-value">{value}</span></div>
                ) : null)}
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>ISSUE SUMMARY <span style={{ color: '#a78bfa' }}>→ Excel & Email</span></label>
                <textarea value={issueSummary} onChange={e => setIssueSummary(e.target.value)} placeholder="Brief description of the customer's issue (e.g. AC not cooling, fault code E5)…" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(169,112,255,0.1)', border: '1px solid rgba(169,112,255,0.35)', color: 'white', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', minHeight: 56, outline: 'none' }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>PRIORITY</label>
                <select value={priority} onChange={e => setPriority(e.target.value)} style={{ background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.35)', color: 'white', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', width: '100%', cursor: 'pointer' }}>
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'block', marginBottom: 5 }}>INTERNAL NOTES (not in email)</label>
                <textarea value={agentNotes} onChange={e => setAgentNotes(e.target.value)} placeholder="Internal notes — not shared with customer…" style={{ width: '100%', padding: '9px 12px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)', color: 'white', fontFamily: 'inherit', fontSize: 12, resize: 'vertical', minHeight: 56, outline: 'none' }} />
              </div>
              <button onClick={handleEndSession} style={{ width: '100%', padding: '13px 0', borderRadius: 100, border: 'none', background: 'linear-gradient(135deg,#E31837,#9b1226)', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(227,24,55,0.45)' }}>
                🎫 Raise Ticket & Send Email
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default VoicePanel;
