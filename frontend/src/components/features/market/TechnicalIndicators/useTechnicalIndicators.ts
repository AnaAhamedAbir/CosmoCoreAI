import { useState, useEffect, useMemo, useCallback } from 'react';
import { IndicatorConfig, SignalType, TECHNICAL_INDICATORS } from './indicatorConfig';

export interface IndicatorData extends IndicatorConfig {
  value: number | string;
  signal: SignalType;
}

export interface OverallSentiment {
  score: number; // 0 (Strong Sell) to 100 (Strong Buy)
  signal: SignalType;
}

// Helper to determine signal based on numeric value
const determineSignal = (score: number): SignalType => {
  if (score >= 80) return 'STRONG_BUY';
  if (score >= 60) return 'BUY';
  if (score <= 20) return 'STRONG_SELL';
  if (score <= 40) return 'SELL';
  return 'NEUTRAL';
};

export const useTechnicalIndicators = (symbol: string, isModalOpen: boolean) => {
  const [indicators, setIndicators] = useState<IndicatorData[]>([]);
  const [overallSentiment, setOverallSentiment] = useState<OverallSentiment>({ score: 50, signal: 'NEUTRAL' });

  // Fetch real data via WebSocket
  useEffect(() => {
    if (!isModalOpen || !symbol) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout;

    const connect = () => {
      const host = window.location.hostname === 'localhost' ? 'localhost:8000' : window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const formattedSymbol = symbol.replace('/', '-');
      const wsUrl = `${protocol}//${host}/api/v1/indicators/ws/stream/${formattedSymbol}`;
      
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`Connected to Indicator Stream for ${symbol}`);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (Array.isArray(data)) {
            // Merge backend data with static config
            const updatedIndicators = TECHNICAL_INDICATORS.map(config => {
              const backendData = data.find((d: any) => d.id === config.id);
              if (backendData) {
                return { ...config, value: backendData.value, signal: backendData.signal };
              }
              return { ...config, value: '-', signal: 'NEUTRAL' as SignalType };
            });
            setIndicators(updatedIndicators);
          }
        } catch (e) {
          console.error("Error parsing indicator stream data", e);
        }
      };

      ws.onerror = (error) => {
        console.error("Indicator WebSocket Error", error);
      };

      ws.onclose = () => {
        console.log(`Indicator Stream disconnected for ${symbol}. Reconnecting in 5s...`);
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null; // prevent reconnect loop
        ws.close();
      }
    };
  }, [symbol, isModalOpen]);

  // Calculate Overall Sentiment efficiently
  useEffect(() => {
    if (indicators.length === 0) return;

    let totalScore = 0;
    let totalWeight = 0;

    indicators.forEach(ind => {
      let scoreVal = 50;
      switch (ind.signal) {
        case 'STRONG_BUY': scoreVal = 100; break;
        case 'BUY': scoreVal = 75; break;
        case 'NEUTRAL': scoreVal = 50; break;
        case 'SELL': scoreVal = 25; break;
        case 'STRONG_SELL': scoreVal = 0; break;
      }
      totalScore += scoreVal * ind.weight;
      totalWeight += ind.weight;
    });

    const finalScore = totalScore / totalWeight;
    
    setOverallSentiment({
      score: finalScore,
      signal: determineSignal(finalScore)
    });
  }, [indicators]);

  return { indicators, overallSentiment };
};
