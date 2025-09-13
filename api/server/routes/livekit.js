const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { AccessToken } = require('livekit-server-sdk');

/**
 * GET /api/livekit/token
 * Vygeneruje krátko‑žijúci LiveKit AccessToken pre klienta.
 * Dodržiava oficiálnu dokumentáciu LiveKit (server SDK).
 *
 * Query params (voliteľné):
 * - room: názov miestnosti (default z LIVEKIT_DEFAULT_ROOM alebo 'calmbridge')
 * - identity: identita používateľa (inak sa vygeneruje UUID)
 */
router.get('/token', async (req, res) => {
  try {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const url = process.env.LIVEKIT_URL;
    const defaultRoom = process.env.LIVEKIT_DEFAULT_ROOM || 'calmbridge';

    if (!apiKey || !apiSecret || !url) {
      return res.status(500).json({
        error: 'LiveKit environment variables are not configured (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)',
      });
    }

    const room = (req.query.room || defaultRoom).toString();
    // identity: preferujte prihláseného užívateľa, inak fallback na UUID
    const identity =
      (req.user && (req.user.id || req.user._id || req.user.email || req.user.username))?.toString() ||
      req.query.identity?.toString() ||
      crypto.randomUUID();

    // TTL krátky – minimalizuje riziko zneužitia, stačí na klientsky connect
    const ttl = '10m';

    const at = new AccessToken(apiKey, apiSecret, { identity, ttl });

    // Minimálne povolenia:
    // - roomJoin: pripojenie do miestnosti
    // - room: konkrétna miestnosť
    // Pridávame aj canPublishData/canSubscribe pre text (Fáza 2)
    // a canPublish pre budúci mikrofón (Fáza 3), nech token netreba meniť
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,       // audio vstup (Fáza 3)
      canPublishData: true,   // text cez DataChannel (Fáza 2)
      canSubscribe: true,     // odber audio a text výstupu agenta
    });

    const token = await at.toJwt();

    return res.status(200).json({
      token,
      url,
      room,
      identity,
      ttl,
    });
  } catch (err) {
    // Zámerne nevraciame interné detaily chyby
    console.error('[LiveKit] Token generation error:', err);
    return res.status(500).json({ error: 'Failed to generate LiveKit token' });
  }
});

module.exports = router;