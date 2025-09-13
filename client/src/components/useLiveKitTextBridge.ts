import React, { useImperativeHandle, useMemo } from 'react';
import { useLiveKitTextBridge } from '../hooks/useLiveKitTextBridge';

export type LiveKitTextBridgeHandle = {
  sendText: (text: string) => Promise<void>;
};

type Props = {
  room?: string;
  onReceive: (text: string, fromIdentity?: string) => void;
};

// Headless component: no UI, len integrácia k existujúcemu chatu.
const LiveKitTextBridge = React.forwardRef<LiveKitTextBridgeHandle, Props>(
  ({ room, onReceive }, ref) => {
    const bridge = useLiveKitTextBridge(onReceive, { room });
    useImperativeHandle(
      ref,
      () => ({
        sendText: bridge.sendText,
      }),
      [bridge.sendText],
    );

    // Nenútime re-render: nič nevykresľujeme
    return useMemo(() => null, []);
  },
);

export default LiveKitTextBridge;