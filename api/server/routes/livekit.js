const express = require('express');
const { AccessToken } = require('livekit-server-sdk');
const { requireJwtAuth } = require('~/server/middleware');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const DEV_SECRET = process.env.LIVEKIT_DEV_SECRET;

/**
 * DEV-ONLY: rýchla testovacia stránka bez JWT.
 * Použitie: /api/livekit/dev-quick?room=calmbridge-test
 * - V dev režime vloží do HTML aj dev secret a urobí fetch na /api/livekit/dev-token.
 */
router.get('/dev-quick', (req, res) => {
  if (isProd || !DEV_SECRET) {
    return res
      .status(403)
      .send('Disabled. Set NODE_ENV !== production and LIVEKIT_DEV_SECRET to enable.');
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>LiveKit Dev Quick Join</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 16px; }
      .row { margin-bottom: 10px; }
      input, button { font-size: 14px; padding: 6px 10px; }
      .log { white-space: pre-wrap; background:#f7f7f7; border:1px solid #ddd; padding:8px; height:140px; overflow:auto; }
    </style>
  </head>
  <body>
    <h1>LiveKit Dev Quick Join</h1>
    <div class="row">
      <label>Room:&nbsp;<input id="room" placeholder="calmbridge-test"/></label>
      <button id="join">Join & Publish Mic</button>
      <button id="leave" disabled>Leave</button>
    </div>
    <div class="row"><strong>Dev-only</strong>: V produkcii je toto vypnuté.</div>
    <div class="row"><strong>Status / Log</strong></div>
    <div id="log" class="log"></div>

    <script src="https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/dist/livekit-client.min.js"></script>
    <script>
      const DEV_SECRET = ${JSON.stringify(DEV_SECRET)};
      const logEl = document.getElementById('log');
      const roomInput = document.getElementById('room');
      const joinBtn = document.getElementById('join');
      const leaveBtn = document.getElementById('leave');

      const params = new URLSearchParams(location.search);
      roomInput.value = params.get('room') || 'calmbridge-test';

      let room;
      let localAudioTrack;

      function log(...args) {
        const line = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        logEl.textContent += line + '\\n';
        logEl.scrollTop = logEl.scrollHeight;
        console.log(...args);
      }

      async function getDevToken(roomName) {
        const resp = await fetch('/api/livekit/dev-token?room=' + encodeURIComponent(roomName), {
          method: 'GET',
          headers: { 'X-Dev-Secret': DEV_SECRET },
          credentials: 'omit',
        });
        if (!resp.ok) throw new Error('Dev token failed: ' + resp.status);
        return resp.json(); // { token, url, identity }
      }

      async function join() {
        try {
          const roomName = roomInput.value.trim();
          if (!roomName) { alert('Enter room name'); return; }
          joinBtn.disabled = true;
          log('Fetching dev token for room:', roomName);
          const { token, url } = await getDevToken(roomName);
          if (!url) { log('Warning: LIVEKIT_URL not set on server'); }
          log('Connecting to:', url);

          room = new window.livekit.Room({ adaptiveStream: true, dynacast: true });
          room
            .on(window.livekit.RoomEvent.Connected, () => log('Connected'))
            .on(window.livekit.RoomEvent.Disconnected, () => log('Disconnected'))
            .on(window.livekit.RoomEvent.ParticipantConnected, p => log('Participant connected:', p.identity))
            .on(window.livekit.RoomEvent.ParticipantDisconnected, p => log('Participant disconnected:', p.identity))
            .on(window.livekit.RoomEvent.TrackSubscribed, (track, pub, participant) => {
              if (track.kind === 'audio') {
                const el = track.attach();
                el.autoplay = true;
                el.controls = false;
                document.body.appendChild(el);
                log('Audio subscribed from', participant.identity);
              }
            });

          await room.connect(url, token);
          log('Connected, requesting microphone...');
          localAudioTrack = await window.livekit.createLocalAudioTrack();
          await room.localParticipant.publishTrack(localAudioTrack);
          log('Microphone published.');
          leaveBtn.disabled = false;
        } catch (e) {
          log('Error:', e.message || e);
          joinBtn.disabled = false;
        }
      }

      async function leave() {
        try {
          if (localAudioTrack) {
            localAudioTrack.stop();
            localAudioTrack = undefined;
          }
          if (room) {
            await room.disconnect();
            room = undefined;
          }
          log('Left room.');
        } catch (e) {
          log('Error on leave:', e.message || e);
        } finally {
          leaveBtn.disabled = true;
          joinBtn.disabled = false;
        }
      }

      joinBtn.addEventListener('click', join);
      leaveBtn.addEventListener('click', leave);
    </script>
  </body>
</html>`;
  res.type('html').send(html);
});

/**
 * DEV-ONLY: vygeneruje LiveKit token bez JWT, chránené jednoduchým shared secretom.
 * Použitie: GET /api/livekit/dev-token?room=<name> s hlavičkou X-Dev-Secret: <LIVEKIT_DEV_SECRET>
 */
router.all('/dev-token', async (req, res) => {
  try {
    if (isProd || !DEV_SECRET) {
      return res
        .status(403)
        .json({ error: 'Disabled. Set NODE_ENV !== production and LIVEKIT_DEV_SECRET to enable.' });
    }
    const provided = req.get('x-dev-secret');
    if (!provided || provided !== DEV_SECRET) {
      return res.status(403).json({ error: 'Forbidden: invalid X-Dev-Secret' });
    }

    const room = (req.query.room || req.body?.room || '').toString().trim();
    if (!room) {
      return res.status(400).json({ error: 'Missing "room" (query or body)' });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiKey || !apiSecret) {
      return res.status(500).json({ error: 'LIVEKIT_API_KEY/SECRET not set on server' });
    }

    const identity = `dev-${Date.now()}`;
    const at = new AccessToken(apiKey, apiSecret, { identity });
    at.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
    });
    const jwt = await Promise.resolve(at.toJwt());

    return res.status(200).json({
      token: jwt,
      url: process.env.LIVEKIT_URL || undefined,
      identity,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate dev token' });
  }
});

/**
 * EXISTUJÚCI CHRÁNENÝ ENDPOINT (ponechaný bezo zmeny):
 * POST /api/livekit/token
 * - vyžaduje Authorization: Bearer <JWT> (requireJwtAuth)
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

/**
 * HEALTH (ponechané)
 */
router.get('/health', (req, res) => {
  const hasKey = !!process.env.LIVEKIT_API_KEY;
  const hasSecret = !!process.env.LIVEKIT_API_SECRET;
  const hasUrl = !!process.env.LIVEKIT_URL;

  if (!hasKey || !hasSecret) {
    return res.status(500).json({
      ok: false,
      missing: {
        LIVEKIT_API_KEY: hasKey,
        LIVEKIT_API_SECRET: hasSecret,
        LIVEKIT_URL: hasUrl,
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

module.exports = router;