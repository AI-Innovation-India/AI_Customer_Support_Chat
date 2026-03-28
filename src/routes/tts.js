/**
 * TTS route — Text-to-Speech proxy via Sarvam AI
 * POST /api/tts
 * Body: JSON — same shape as Sarvam bulbul:v2 request
 * Returns: { audios: [base64_wav_string] }
 */
const express = require('express');
const fetch   = require('node-fetch');
const { ttsLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Valid Sarvam TTS speakers
const VALID_SPEAKERS = [
  'anushka', 'priya', 'neha', 'ishita', 'kavya', // female
  'arya', 'rahul', 'rohan', 'kabir',               // male
];

router.post('/', ttsLimiter, async (req, res) => {
  const {
    inputs,
    target_language_code = 'en-IN',
    speaker = 'anushka',
    model = 'bulbul:v2',
    pitch = 0,
    pace = 1.0,
    loudness = 1.5,
    speech_sample_rate = 8000,
    enable_preprocessing = true,
  } = req.body || {};

  if (!inputs || !Array.isArray(inputs) || !inputs[0]) {
    return res.status(400).json({ error: 'inputs array is required.' });
  }

  // Validate text length
  const text = String(inputs[0]);
  if (text.length > 2000) {
    return res.status(400).json({ error: 'Text too long for TTS (max 2000 chars).' });
  }

  // Validate speaker — default to anushka if unknown
  const safeSpeaker = VALID_SPEAKERS.includes(speaker) ? speaker : 'anushka';

  try {
    const r = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-subscription-key': process.env.SARVAM_KEY,
      },
      body: JSON.stringify({
        inputs: [text],
        target_language_code,
        speaker: safeSpeaker,
        model,
        pitch,
        pace,
        loudness,
        speech_sample_rate,
        enable_preprocessing,
      }),
    });

    const data = await r.json();

    if (!r.ok) {
      console.error('[TTS] Sarvam error:', data);
      return res.status(r.status).json({ error: data?.error?.message || 'TTS failed' });
    }

    res.json({ audios: data.audios || [] });
  } catch (err) {
    console.error('[TTS] Exception:', err.message);
    res.status(500).json({ error: 'Text-to-speech service unavailable.' });
  }
});

module.exports = router;
