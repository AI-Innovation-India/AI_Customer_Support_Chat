import React, { useState, useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';
import './ChatSupport.css';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /jailbreak/i, /\bDAN\b/,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|api\s+key)/i,
];

const ChatSupport = ({ onClose, onEndSession, getAIResponse, speakText }) => {
  const [messages, setMessages] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async () => {
    const text = inputVal.trim();
    if (!text || isTyping) return;

    if (INJECTION_PATTERNS.some(p => p.test(text))) {
      setMessages(prev => [...prev,
        { id: Date.now(),     sender: 'user', text },
        { id: Date.now() + 1, sender: 'ai',   text: "I'm here to help with Trane and ThermoKing support only." },
      ]);
      setInputVal('');
      return;
    }
    if (text.length > 1000) { setInputVal(''); return; }

    setMessages(prev => [...prev, { id: Date.now(), sender: 'user', text }]);
    setInputVal('');
    setIsTyping(true);

    try {
      const aiText = await getAIResponse(text);
      setIsTyping(false);
      setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ai', text: aiText }]);
      if (speakText) speakText(aiText).catch(() => {});
    } catch {
      setIsTyping(false);
      setMessages(prev => [...prev, { id: Date.now() + 1, sender: 'ai', text: 'Sorry, I encountered an error. Please try again.' }]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    /* Outer: fill the parent flex container */
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', width: '100%', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        flexShrink: 0, height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px',
        borderBottom: '1px solid rgba(169,112,255,0.3)',
        background: 'rgba(169,112,255,0.08)',
      }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: 15, letterSpacing: 0.3 }}>
          Text Support
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onEndSession && (
            <button
              onClick={() => { onClose(); onEndSession(); }}
              style={{
                fontSize: 11, fontWeight: 600, color: '#fca5a5',
                background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
                borderRadius: 20, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              End Session
            </button>
          )}
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fff', opacity: 0.7, display: 'flex', alignItems: 'center', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Messages ── */}
      <div style={{
        flex: 1, minHeight: 0, overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 14,
        padding: '16px 20px',
      }}>
        {messages.length === 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div className="cs-bubble cs-bubble-ai" style={{ fontSize: 12, opacity: 0.6 }}>
              Type your question and I'll respond here.
            </div>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start' }}>
            <div className={msg.sender === 'user' ? 'cs-bubble cs-bubble-user' : 'cs-bubble cs-bubble-ai'}>
              {msg.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div className="cs-bubble cs-bubble-ai cs-typing">
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div style={{
        flexShrink: 0, height: 74,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 20px',
        borderTop: '1px solid rgba(169,112,255,0.15)',
      }}>
        <input
          type="text"
          placeholder="Type your message..."
          className="cs-input"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={{ flex: 1, minWidth: 0 }}
        />
        <button
          onClick={handleSend}
          disabled={isTyping}
          className="cs-send-btn"
        >
          <Send size={16} color="#A970FF" />
        </button>
      </div>
    </div>
  );
};

export default ChatSupport;
