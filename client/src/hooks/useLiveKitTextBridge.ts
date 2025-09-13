import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connect as livekitConnect,
  Room,
  RoomEvent,
  DataPacket_Kind,
} from 'livekit-client';

type BridgeOptions = {
  room?: string;
};

export type LiveKitTextBridge = {
  isConnecting: boolean;
  isConnected: boolean;
  identity?: string;
  roomName?: string;
  sendText: (text: string) => Promise<void>;
  disconnect: () => Promise<void>;
};

export function useLiveKitTextBridge(
  onReceiveText: (text: string, fromIdentity?: string) => void,
  options?: BridgeOptions,
): LiveKitTextBridge {
  const roomRef = useRef<Room | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const identityRef = useRef<string | undefined>(undefined);
  const roomNameRef = useRef<string | undefined>(undefined);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;
    setIsConnecting(true);
    try {
      const qs = options?.room ? `?room=${encodeURIComponent(options.room)}` : '';
      const res = await fetch(`/api/livekit/token${qs}`);
      if (!res.ok) {
        throw new Error(`Token request failed: ${res.status}`);
      }
      const { token, url, room, identity } = await res.json();
      identityRef.current = identity;
      roomNameRef.current = room;

      const roomClient = await livekitConnect(url, token, {
        // default options OK; low-latency text
      });

      roomClient.on(RoomEvent.DataReceived, (payload, participant, _kind) => {
        try {
          const text = new TextDecoder().decode(payload);
          onReceiveText(text, participant?.identity ?? undefined);
        } catch {
          // ignore malformed payload
        }
      });

      roomRef.current = roomClient;
      setIsConnected(true);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, onReceiveText, options?.room]);

  useEffect(() => {
    // auto-connect on mount
    connect();
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
        roomRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendText = useCallback(async (text: string) => {
    const room = roomRef.current;
    if (!room) throw new Error('LiveKit room is not connected');
    const bytes = new TextEncoder().encode(text);
    await room.localParticipant.publishData(bytes, DataPacket_Kind.RELIABLE);
  }, []);

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      await room.disconnect();
      roomRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return {
    isConnecting,
    isConnected,
    identity: identityRef.current,
    roomName: roomNameRef.current,
    sendText,
    disconnect,
  };
}