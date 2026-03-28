/**
 * Ticket route — raise support ticket, save to Excel, send email
 * POST /api/ticket
 * Body: { customer, inquiry, transcript, priority, agentNotes, language, messageCount }
 * Returns: { ok: true, ticketId, emailSent }
 */
const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const nodemailer = require('nodemailer');
const XLSX       = require('xlsx');

const router = express.Router();

// ── Ticket ID generator ───────────────────────────────────────────
function generateTicketId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `TKT-${date}-${rand}`;
}

// ── Append row to Excel file ──────────────────────────────────────
function saveToExcel(row, exportsDir) {
  const xlsxPath = path.join(exportsDir, 'tickets.xlsx');
  const HEADERS  = [
    'Ticket ID', 'Date/Time', 'Customer Name', 'Phone / Email',
    'Location', 'Issue Type', 'Product', 'Issue Details',
    'Purchase Intent', 'Priority', 'Language', 'Messages', 'Agent Notes', 'Status',
  ];

  let wb;
  try {
    if (fs.existsSync(xlsxPath)) {
      wb = XLSX.readFile(xlsxPath);
    } else {
      wb = XLSX.utils.book_new();
    }
  } catch {
    wb = XLSX.utils.book_new();
  }

  let ws = wb.Sheets['Tickets'];
  if (!ws) {
    ws = XLSX.utils.aoa_to_sheet([HEADERS]);
    XLSX.utils.book_append_sheet(wb, ws, 'Tickets');
    // Style header row width
    ws['!cols'] = HEADERS.map(() => ({ wch: 22 }));
  }

  XLSX.utils.sheet_add_aoa(ws, [row], { origin: -1 });
  XLSX.writeFile(wb, xlsxPath);
}

// ── Email transporter (lazy, only if config present) ─────────────
function getTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) return null;
  return nodemailer.createTransport({
    host:   process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
    port:   parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    secure: process.env.EMAIL_SMTP_PORT === '465',
    auth:   { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
  });
}

// ── Extract customer email from contact string ────────────────────
function extractEmail(contactStr = '') {
  const m = contactStr.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-z]{2,}/i);
  return m ? m[0] : null;
}

// ── POST /api/ticket ──────────────────────────────────────────────
router.post('/', async (req, res) => {
  const {
    customer = {}, inquiry = {}, transcript = [],
    priority = 'Normal', agentNotes = '', language = 'en-IN', messageCount = 0,
  } = req.body;

  const ticketId   = generateTicketId();
  const timestamp  = new Date().toLocaleString();
  const exportsDir = path.resolve(process.env.EXPORTS_DIR || './exports');

  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });

  // ── Excel ──────────────────────────────────────────────────────
  const excelRow = [
    ticketId,
    timestamp,
    customer.name    || '',
    customer.contact || '',
    customer.location || '',
    inquiry.type    || 'General',
    inquiry.product  || '',
    inquiry.issue    || '',
    inquiry.purchaseIntent ? 'YES' : 'No',
    priority,
    language,
    messageCount,
    agentNotes,
    'Open',
  ];
  try {
    saveToExcel(excelRow, exportsDir);
    console.log(`[Ticket] Excel updated: ${ticketId}`);
  } catch (err) {
    console.error('[Ticket] Excel error:', err.message);
  }

  // ── Email ──────────────────────────────────────────────────────
  let emailSent = false;
  const csEmail       = process.env.CS_EMAIL;
  const customerEmail = extractEmail(customer.contact || '');
  const transporter   = getTransporter();

  if (transporter && csEmail) {
    const transcriptText = transcript.length
      ? transcript.map(m => `[${(m.role || 'user').toUpperCase()}]: ${m.content}`).join('\n\n')
      : '(no transcript available)';

    const emailBody = `
TRANE & THERMOKING — SUPPORT TICKET
═════════════════════════════════════════════
Ticket ID  : ${ticketId}
Date/Time  : ${timestamp}
Priority   : ${priority}
Language   : ${language}

CUSTOMER DETAILS
─────────────────────────────────────────────
Name       : ${customer.name    || 'Not provided'}
Contact    : ${customer.contact || 'Not provided'}
Location   : ${customer.location || '—'}

ISSUE DETAILS
─────────────────────────────────────────────
Type       : ${inquiry.type    || 'General'}
Product    : ${inquiry.product || 'Not specified'}
Details    : ${inquiry.issue   || 'See conversation transcript below'}
Purchase?  : ${inquiry.purchaseIntent ? 'YES — Sales follow-up required' : 'No'}

AGENT NOTES
─────────────────────────────────────────────
${agentNotes || '(none)'}

CONVERSATION TRANSCRIPT (${messageCount} messages)
─────────────────────────────────────────────
${transcriptText}

─────────────────────────────────────────────
This ticket was auto-raised by the Trane & ThermoKing AI Support Agent.
Please respond to the customer at: ${customer.contact || 'N/A'}
    `.trim();

    const ccList   = customerEmail ? [customerEmail] : [];
    const subject  = `[${ticketId}] ${inquiry.type || 'Support Request'} — ${customer.name || 'Customer'}`;

    try {
      await transporter.sendMail({
        from:    `"Trane & ThermoKing Support" <${process.env.EMAIL_USER}>`,
        to:      csEmail,
        cc:      ccList,
        subject,
        text:    emailBody,
        html:    `<pre style="font-family:monospace;font-size:13px;line-height:1.8">${emailBody.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre>`,
      });
      emailSent = true;
      console.log(`[Ticket] Email → ${csEmail}${customerEmail ? ` (CC: ${customerEmail})` : ''} | ${ticketId}`);
    } catch (err) {
      console.error('[Ticket] Email error:', err.message);
    }
  } else {
    if (!csEmail)      console.warn('[Ticket] CS_EMAIL not set — email skipped');
    if (!transporter)  console.warn('[Ticket] EMAIL_USER/EMAIL_PASSWORD not set — email skipped');
  }

  res.json({ ok: true, ticketId, emailSent, customerEmailed: emailSent && !!customerEmail });
});

module.exports = router;
