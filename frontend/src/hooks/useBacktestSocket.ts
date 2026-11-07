import { useEffect, useRef, useState, useCallback } from 'react';

// WebSocket URL Configuration
// Adjust the port if necessary. In production this should be environment driven.
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const WS_URL = `${wsProtocol}//${window.location.host}/ws/backtest`;

interface SocketMessage {
    type: 'BACKTEST' | 'DOWNLOAD' | 'OPTIMIZE' | 'BATCH' | 'Task';
    task_id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'Revoked' | 'REVOKED';
    progress: number;
    payload?: any;
    data?: any; // To support both payload and data keys just in case
}

export const useBacktestSocket = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<SocketMessage | null>(null);
    const socketRef = useRef<WebSocket | null>(null);
    const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
    const isUnmountedRef = useRef(false);

    // Connection Logic
    const connect = useCallback(() => {
        if (isUnmountedRef.current) return;
        // Prevent multiple connections
        if (
            socketRef.current &&
            (socketRef.current.readyState === WebSocket.OPEN ||
                socketRef.current.readyState === WebSocket.CONNECTING)
        ) {
            return;
        }

        console.log("🔌 Connecting to Backtest WebSocket...");
        const ws = new WebSocket(WS_URL);
        socketRef.current = ws;

        ws.onopen = () => {
            if (isUnmountedRef.current) {
                ws.close();
                return;
            }
            console.log('✅ Backtest WS Connected');
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            if (isUnmountedRef.current) return;
            try {
                const data: SocketMessage = JSON.parse(event.data);
                // Payload might be in 'data' or 'payload' key based on backend implementation
                // Our backend sends "data", but frontend spec had "payload". Let's normalize.
                if (data.data && !data.payload) {
                    data.payload = data.data;
                }
                setLastMessage(data);
            } catch (e) {
                console.error('WS Parse Error:', e);
            }
        };

        ws.onclose = () => {
            if (socketRef.current === ws) {
                socketRef.current = null;
            }
            if (isUnmountedRef.current) return;
            console.log('❌ Backtest WS Disconnected. Reconnecting in 3s...');
            setIsConnected(false);

            // Clear existing timeout if any
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            reconnectTimeout.current = setTimeout(connect, 3000);
        };

        ws.onerror = (err) => {
            if (isUnmountedRef.current) return;
            console.error("Backtest WS Error:", err);
            if (ws.readyState === WebSocket.OPEN) {
                ws.close(); // Trigger onclose
            }
        };
    }, []);

    useEffect(() => {
        isUnmountedRef.current = false;
        connect();
        return () => {
            isUnmountedRef.current = true;
            if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
            const ws = socketRef.current;
            socketRef.current = null;
            if (ws) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.close();
                } else if (ws.readyState === WebSocket.CONNECTING) {
                    ws.onopen = () => ws.close();
                    ws.onmessage = null;
                    ws.onerror = null;
                    ws.onclose = null;
                }
            }
        };
    }, [connect]);

    return { isConnected, lastMessage };
};
