const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

/**
 * GET /api/livekit/health
 * Jednoduchý healthcheck LiveKit konfigurácie (bez autentifikácie).
 * Nekoná žiadne pripojenie na LiveKit; iba kontroluje prítomnosť env premenných.
 */
router.get('/health', (req, res) => {
  const hasKey = !!process.env.LIVEKIT_API_KEY;
  const hasSecret = !!process.env.LIVEKIT_API_SECRET;
  const hasUrl = !!process.env.LIVEKIT_URL; // url používa klient (napr. wss://<proj>.livekit.cloud)

  if (!hasKey || !hasSecret) {
    return res.status(500).json({
      ok: false,
      missing: {
        LIVEKIT_API_KEY: hasKey,
        LIVEKIT_API_SECRET: hasSecret,
        LIVEKIT_URL: hasUrl, // odporúčané mať nastavené
      },
    });
  }

  return res.status(200).json({
    ok: true,
    info: {
      LIVEKIT_URL_present: hasUrl,
    },
  });
});

/**
 * POST /api/livekit/token
 * Body:
 *  - room: string (required)
 *  - role: string (optional)
 *  - metadata: object (optional)
 * Header:
 *  - Authorization: Bearer <JWT> (required)
 */
router.post('/token', requireJwtAuth, async (req, res) => {
  try {
    const { room, role, metadata } = req.body || {};
    if (!room || typeof room !== 'string' || room.trim().length === 0) {
      return res.status(400).json({ error: 'Missing or invalid "room" in request body' });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({
        error:
          'Server misconfiguration: LIVEKIT_API_KEY and/or LIVEKIT_API_SECRET are not set in environment',
      });
    }

    // derive identity and display name from authenticated user
    const identity =
      String(
        req.user?.id ||
          req.user?._id ||
          req.user?.email ||
          req.user?.username ||
          req.user?.name ||
          '',
      ) || `user-${Date.now()}`;

    const displayName = req.user?.name || req.user?.username || req.user?.email || undefined;

    // safe metadata
    let metaPayload = {};
    if (metadata && typeof metadata === 'object') {
      metaPayload = { ...metadata };
    }
    if (req.user?._id || req.user?.id) {
      metaPayload.userId = String(req.user._id || req.user.id);
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      metadata: Object.keys(metaPayload).length ? JSON.stringify(metaPayload) : undefined,
    });

    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      ...(role ? { ingressAdmin: role === 'admin' } : {}),
    });

    const jwt = await Promise.resolve(at.toJwt());

    return res.status(200).json({
      token: jwt,
      url: process.env.LIVEKIT_URL || undefined,
      identity,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate LiveKit token' });
  }
});

module.exports = router;