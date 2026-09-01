import React, { useMemo } from 'react';
import { OverallSentiment } from './useTechnicalIndicators';

interface Props {
  sentiment: OverallSentiment;
}

export const OverallGauge: React.FC<Props> = ({ sentiment }) => {
  // Map score (0-100) to degrees (0-180) for the gauge needle
  const rotation = useMemo(() => {
    return (sentiment.score / 100) * 180;
  }, [sentiment.score]);

  const getColor = (sig: string) => {
    switch (sig) {
      case 'STRONG_BUY': return 'text-green-500';
      case 'BUY': return 'text-green-400';
      case 'NEUTRAL': return 'text-yellow-400';
      case 'SELL': return 'text-red-400';
      case 'STRONG_SELL': return 'text-red-500';
      default: return 'text-gray-400';
    }
  };

  const getLabel = (sig: string) => {
    return sig.replace('_', ' ');
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
      {/* Background glow based on sentiment */}
      <div 
        className={`absolute inset-0 opacity-20 blur-3xl transition-colors duration-1000 ${
          sentiment.signal.includes('BUY') ? 'bg-green-500' : 
          sentiment.signal.includes('SELL') ? 'bg-red-500' : 'bg-yellow-500'
        }`}
      />

      <h3 className="text-sm font-medium text-slate-400 mb-6 z-10 tracking-widest uppercase">Overall Sentiment</h3>
      
      <div className="relative w-64 h-32 z-10 flex flex-col items-center">
        {/* Gauge Arc SVG */}
        <svg viewBox="0 0 200 100" className="w-full h-full drop-shadow-lg">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" /> {/* Red / Strong Sell */}
              <stop offset="25%" stopColor="#f87171" /> {/* Light Red / Sell */}
              <stop offset="50%" stopColor="#facc15" /> {/* Yellow / Neutral */}
              <stop offset="75%" stopColor="#4ade80" /> {/* Light Green / Buy */}
              <stop offset="100%" stopColor="#22c55e" /> {/* Green / Strong Buy */}
            </linearGradient>
          </defs>
          {/* Background Track */}
          <path d="M 10 90 A 80 80 0 0 1 190 90" fill="none" stroke="#334155" strokeWidth="16" strokeLinecap="round" />
          {/* Colored Arc */}
          <path d="M 10 90 A 80 80 0 0 1 190 90" fill="none" stroke="url(#gaugeGradient)" strokeWidth="16" strokeLinecap="round" />
          
          {/* The Needle */}
          <g 
            style={{ transformOrigin: '100px 90px', transition: 'transform 1s cubic-bezier(0.34, 1.56, 0.64, 1)' }} 
            transform={`rotate(${rotation - 90})`}
          >
            <polygon points="95,90 105,90 100,10" fill="white" className="drop-shadow-md" />
            <circle cx="100" cy="90" r="8" fill="white" />
            <circle cx="100" cy="90" r="4" fill="#0f172a" />
          </g>
        </svg>

        {/* Labels under the gauge arc */}
        <div className="absolute top-[80px] w-full flex justify-between px-2 text-[10px] text-gray-500 font-medium">
          <span>SELL</span>
          <span>NEUTRAL</span>
          <span>BUY</span>
        </div>
      </div>

      <div className="mt-4 z-10 flex flex-col items-center">
        <span className={`text-3xl font-black tracking-tight ${getColor(sentiment.signal)} transition-colors duration-500 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]`}>
          {getLabel(sentiment.signal)}
        </span>
        <span className="text-xs text-gray-400 mt-1 font-mono">Score: {sentiment.score.toFixed(1)} / 100</span>
      </div>
    </div>
  );
};
