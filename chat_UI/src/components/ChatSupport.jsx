import React, { useState, useRef, useEffect } from 'react';
import { X, Send } from 'lucide-react';
import './ChatSupport.css';

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions?/i,
  /jailbreak/i, /\bDAN\b/,
  /reveal\s+(your\s+)?(system\s+prompt|instructions?|api\s+key)/i,
];

const ChatSupport = ({ onClose, getAIResponse, speakText }) => {
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

    // Guard rails
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
    } catch (err) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now() + 1, sender: 'ai',
        text: 'Sorry, I encountered an error. Please try again.',
      }]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="chat-support-panel">
      <div className="chat-header">
        <h3 className="neon-text-primary">Text Support</h3>
        <button className="icon-close-btn" onClick={onClose}>
          <X size={20} color="#fff" />
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="message-wrapper ai">
            <div className="message-bubble ai-bubble glass-panel" style={{ fontSize: 13, opacity: 0.7 }}>
              Type your question and I'll respond here.
            </div>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`message-wrapper ${msg.sender}`}>
            <div className={`message-bubble ${msg.sender}-bubble glass-panel`}>
              {msg.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="message-wrapper ai">
            <div className="message-bubble ai-bubble glass-panel typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <input
          type="text"
          placeholder="Type your message..."
          className="chat-input glass-panel"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button className="chat-send-btn glass-panel" onClick={handleSend} disabled={isTyping}>
          <Send size={18} color="#A970FF" />
        </button>
      </div>
    </div>
  );
};

export default ChatSupport;
