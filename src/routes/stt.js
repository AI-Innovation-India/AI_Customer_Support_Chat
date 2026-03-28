/**
 * STT route — Speech-to-Text proxy via Sarvam AI
 * POST /api/stt
 * Body: multipart/form-data — file (audio/webm), language_code
 * Returns: { transcript: string }
 */
const express = require('express');
const multer  = require('multer');
const fetch   = require('node-fetch');
const FormData = require('form-data');
const { sttLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    // Accept audio files only
    if (file.mimetype.startsWith('audio/')) cb(null, true);
    else cb(new Error('Only audio files are accepted.'));
  },
});

router.post('/', sttLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Audio file is required.' });
  }

  const languageCode = req.body?.language_code || 'en-IN';

  // Use the actual mimetype and extension from the upload
  const mime = req.file.mimetype || 'audio/wav';
  const ext  = mime.includes('wav') ? 'wav' : mime.includes('ogg') ? 'ogg' : mime.includes('mp3') ? 'mp3' : 'wav';

  const fd = new FormData();
  fd.append('file', req.file.buffer, {
    filename: `recording.${ext}`,
    contentType: mime,
  });
  fd.append('model', 'saarika:v2.5');
  fd.append('language_code', languageCode);

  try {
    const r = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': process.env.SARVAM_KEY,
        ...fd.getHeaders(),
      },
      body: fd,
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('[STT] Sarvam error:', data);
      return res.status(r.status).json({ error: data?.error?.message || 'STT failed' });
    }

    res.json({ transcript: data.transcript || '' });
  } catch (err) {
    console.error('[STT] Exception:', err.message);
    res.status(500).json({ error: 'Speech recognition service unavailable.' });
  }
});

module.exports = router;
