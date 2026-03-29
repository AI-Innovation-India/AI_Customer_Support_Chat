import React, { useState, useEffect, useRef } from 'react';
import { Upload, Trash2, FileText, Globe, RefreshCw, CheckCircle, AlertCircle, X } from 'lucide-react';

const CATEGORY_OPTIONS = ['general', 'trane-hvac', 'thermoking', 'fault-codes', 'maintenance', 'warranty', 'parts', 'installation'];

const fmt = (ts) => new Date(ts * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function KnowledgeBaseAdmin({ authToken, onClose }) {
  const [docs,       setDocs]       = useState([]);
  const [health,     setHealth]     = useState(null);   // null | {status,vectors,documents}
  const [loading,    setLoading]    = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [urlInput,   setUrlInput]   = useState('');
  const [category,   setCategory]   = useState('general');
  const [toast,      setToast]      = useState(null);   // {type:'ok'|'err', msg}
  const fileRef = useRef();

  const headers = { Authorization: `Bearer ${authToken}` };

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchHealth = async () => {
    try {
      const r = await fetch('/api/kb/health', { headers });
      setHealth(await r.json());
    } catch { setHealth({ status: 'unavailable' }); }
  };

  const fetchDocs = async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/kb/documents', { headers });
      const d = await r.json();
      setDocs(d.documents || []);
    } catch { showToast('err', 'Could not load documents'); }
    setLoading(false);
  };

  useEffect(() => { fetchHealth(); fetchDocs(); }, []); // eslint-disable-line

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('category', category);
    try {
      const r = await fetch('/api/kb/ingest', { method: 'POST', headers, body: form });
      const d = await r.json();
      if (r.ok) { showToast('ok', `"${file.name}" indexed — ${d.chunks} chunks`); fetchDocs(); fetchHealth(); }
      else showToast('err', d.error || 'Upload failed');
    } catch { showToast('err', 'Upload failed'); }
    setUploading(false);
  };

  const handleUrlIngest = async () => {
    if (!urlInput.trim()) return;
    setUploading(true);
    try {
      const r = await fetch('/api/kb/ingest/url', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim(), category }),
      });
      const d = await r.json();
      if (r.ok) { showToast('ok', `URL indexed — ${d.chunks} chunks`); setUrlInput(''); fetchDocs(); fetchHealth(); }
      else showToast('err', d.error || 'URL ingest failed');
    } catch { showToast('err', 'URL ingest failed'); }
    setUploading(false);
  };

  const handleDelete = async (doc_id, filename) => {
    if (!window.confirm(`Remove "${filename}" from the knowledge base?`)) return;
    try {
      const r = await fetch(`/api/kb/documents/${doc_id}`, { method: 'DELETE', headers });
      if (r.ok) { showToast('ok', `"${filename}" removed`); fetchDocs(); fetchHealth(); }
      else showToast('err', 'Delete failed');
    } catch { showToast('err', 'Delete failed'); }
  };

  // ── Styles ──────────────────────────────────────────────────────────────────
  const S = {
    overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
    panel:   { background: '#0e0822', border: '1px solid rgba(169,112,255,0.25)', borderRadius: 20, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    header:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 24px', borderBottom: '1px solid rgba(169,112,255,0.15)', flexShrink: 0 },
    body:    { flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 },
    card:    { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: '16px 18px' },
    label:   { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'rgba(255,255,255,0.4)', marginBottom: 10, display: 'block' },
    input:   { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(169,112,255,0.25)', color: '#fff', padding: '10px 14px', borderRadius: 10, outline: 'none', fontFamily: 'inherit', fontSize: 13, width: '100%', boxSizing: 'border-box' },
    select:  { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(169,112,255,0.25)', color: '#fff', padding: '10px 14px', borderRadius: 10, outline: 'none', fontFamily: 'inherit', fontSize: 13 },
    btn:     { padding: '9px 18px', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 },
    btnPurple: { background: 'linear-gradient(135deg,#7c3aed,#A970FF)', border: 'none', color: '#fff' },
    btnGhost:  { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.8)' },
    btnRed:    { background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)', color: '#fca5a5', padding: '6px 10px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' },
  };

  const healthColor = health?.status === 'ok' ? '#4ade80' : '#f87171';

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.panel}>

        {/* Header */}
        <div style={S.header}>
          <div>
            <h2 style={{ color: '#fff', fontSize: 16, fontWeight: 700, margin: 0 }}>Knowledge Base</h2>
            {health && (
              <span style={{ fontSize: 11, color: healthColor, marginTop: 2, display: 'block' }}>
                {health.status === 'ok'
                  ? `● Online — ${health.vectors} vectors · ${health.documents} docs`
                  : '● RAG service offline — start rag_service/main.py'}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.btn, ...S.btnGhost }} onClick={() => { fetchHealth(); fetchDocs(); }}>
              <RefreshCw size={14} />
            </button>
            <button style={{ ...S.btn, ...S.btnGhost }} onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div style={S.body}>

          {/* Category selector */}
          <div>
            <span style={S.label}>Category (applied to next upload)</span>
            <select style={S.select} value={category} onChange={e => setCategory(e.target.value)}>
              {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* File upload */}
          <div style={S.card}>
            <span style={S.label}>Upload Document</span>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 12 }}>
              Supports PDF, Excel (.xlsx), Word (.docx), plain text (.txt), CSV
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input ref={fileRef} type="file" style={{ display: 'none' }}
                accept=".pdf,.xlsx,.xls,.docx,.doc,.txt,.csv,.md"
                onChange={handleFileUpload} />
              <button style={{ ...S.btn, ...S.btnPurple, opacity: uploading ? 0.6 : 1 }}
                disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Upload size={15} />
                {uploading ? 'Uploading…' : 'Choose File'}
              </button>
            </div>
          </div>

          {/* URL ingest */}
          <div style={S.card}>
            <span style={S.label}>Index a Web URL</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={S.input} type="url" placeholder="https://example.com/product-manual"
                value={urlInput} onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleUrlIngest()} />
              <button style={{ ...S.btn, ...S.btnPurple, flexShrink: 0, opacity: uploading ? 0.6 : 1 }}
                disabled={uploading || !urlInput.trim()} onClick={handleUrlIngest}>
                <Globe size={15} />
                {uploading ? '…' : 'Index'}
              </button>
            </div>
          </div>

          {/* Document list */}
          <div>
            <span style={S.label}>Indexed Documents ({docs.length})</span>
            {loading && <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>Loading…</p>}
            {!loading && docs.length === 0 && (
              <div style={{ ...S.card, textAlign: 'center', padding: 32 }}>
                <FileText size={32} color="rgba(169,112,255,0.3)" style={{ margin: '0 auto 10px' }} />
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No documents yet. Upload a file or index a URL above.</p>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {docs.map(doc => (
                <div key={doc.doc_id} style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px' }}>
                  <FileText size={18} color="#A970FF" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ color: '#fff', fontSize: 13, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.filename}
                    </p>
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, margin: '2px 0 0' }}>
                      {doc.chunks} chunks · {doc.category} · {fmt(doc.ingested_at)}
                    </p>
                  </div>
                  <button style={S.btnRed} onClick={() => handleDelete(doc.doc_id, doc.filename)} title="Remove">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: toast.type === 'ok' ? 'rgba(74,222,128,0.15)' : 'rgba(220,38,38,0.15)',
            border: `1px solid ${toast.type === 'ok' ? 'rgba(74,222,128,0.4)' : 'rgba(220,38,38,0.4)'}`,
            color: toast.type === 'ok' ? '#4ade80' : '#fca5a5',
            padding: '10px 20px', borderRadius: 12, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
            whiteSpace: 'nowrap', zIndex: 10,
          }}>
            {toast.type === 'ok' ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
            {toast.msg}
          </div>
        )}
      </div>
    </div>
  );
}
