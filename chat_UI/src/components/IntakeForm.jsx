import React, { useState } from 'react';
import './IntakeForm.css';
import { ChevronLeft } from 'lucide-react';

const COUNTRY_CODES = [
  { code: '+91', flag: '🇮🇳', label: 'India' },
  { code: '+1',  flag: '🇺🇸', label: 'USA/Canada' },
  { code: '+44', flag: '🇬🇧', label: 'UK' },
  { code: '+61', flag: '🇦🇺', label: 'Australia' },
  { code: '+971',flag: '🇦🇪', label: 'UAE' },
  { code: '+65', flag: '🇸🇬', label: 'Singapore' },
  { code: '+60', flag: '🇲🇾', label: 'Malaysia' },
  { code: '+49', flag: '🇩🇪', label: 'Germany' },
  { code: '+81', flag: '🇯🇵', label: 'Japan' },
  { code: '+86', flag: '🇨🇳', label: 'China' },
];

const IntakeForm = ({ onSubmit, onBack }) => {
  const [name,     setName]     = useState('');
  const [phone,    setPhone]    = useState('');
  const [cc,       setCc]       = useState('+91');
  const [email,    setEmail]    = useState('');
  const [location, setLocation] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!name.trim())  { setError('Full name is required.'); return; }
    if (!phone.trim()) { setError('Phone number is required.'); return; }
    if (!/^\d{7,15}$/.test(phone.replace(/[\s\-()]/g, ''))) {
      setError('Please enter a valid phone number.'); return;
    }

    setLoading(true);

    // Unlock audio context in this user gesture
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.1), ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.connect(ctx.destination); src.start();
      src.onended = () => ctx.close();
    } catch {}

    onSubmit({ name: name.trim(), phone: phone.trim(), cc, email: email.trim(), location: location.trim() });
  };

  return (
    <div className="intake-screen-container">
      <div className="intake-card glass-panel">
        {/* Header */}
        <div className="intake-header">
          <button className="intake-back-btn" onClick={onBack}>
            <ChevronLeft size={20} color="rgba(255,255,255,0.7)" />
          </button>
          <div className="intake-brand-strip">
            <span className="brand-trane">TRANE</span>
            <span className="brand-sep">·</span>
            <span className="brand-tk">THERMOKING</span>
          </div>
        </div>

        <h2 className="intake-title neon-text-primary">👋 Welcome</h2>
        <p className="intake-subtitle">Share your details so Yazhi can assist you right away.</p>

        {/* Name */}
        <div className="intake-field">
          <label className="intake-label">Full Name <span className="req">*</span></label>
          <input
            className="intake-input glass-panel"
            type="text"
            placeholder="e.g. Rajesh Kumar"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoComplete="name"
          />
        </div>

        {/* Phone */}
        <div className="intake-field">
          <label className="intake-label">Phone Number <span className="req">*</span></label>
          <div className="phone-row">
            <select
              className="intake-select glass-panel"
              value={cc}
              onChange={e => setCc(e.target.value)}
            >
              {COUNTRY_CODES.map(c => (
                <option key={c.code} value={c.code}>{c.flag} {c.code} {c.label}</option>
              ))}
            </select>
            <input
              className="intake-input glass-panel"
              type="tel"
              placeholder="9876543210"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoComplete="tel"
            />
          </div>
        </div>

        {/* Email */}
        <div className="intake-field">
          <label className="intake-label">Email <span className="optional">(optional)</span></label>
          <input
            className="intake-input glass-panel"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>

        {/* Location */}
        <div className="intake-field">
          <label className="intake-label">City / Location <span className="optional">(optional)</span></label>
          <input
            className="intake-input glass-panel"
            type="text"
            placeholder="e.g. Mumbai, India"
            value={location}
            onChange={e => setLocation(e.target.value)}
            autoComplete="address-level2"
          />
        </div>

        {error && <div className="intake-error">{error}</div>}

        <button
          className="intake-submit-btn glass-button"
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Connecting…' : 'Start Chat with Yazhi →'}
        </button>

        <p className="intake-note">
          <span className="req">*</span> Required · Your info is used only for this support session
        </p>
      </div>
    </div>
  );
};

export default IntakeForm;
