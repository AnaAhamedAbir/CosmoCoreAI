import React, { useMemo, useEffect, useState } from 'react';
import { OverallSentiment } from './useTechnicalIndicators';

interface Props {
  sentiment: OverallSentiment;
}

export const OverallGauge: React.FC<Props> = ({ sentiment }) => {
  const [animatedScore, setAnimatedScore] = useState(0);

  // Animate the score number ticking up
  useEffect(() => {
    let startTime: number;
    const duration = 1000; // 1 second
    const startValue = animatedScore;
    const endValue = sentiment.score;

    const animate = (time: number) => {
      if (!startTime) startTime = time;
      const progress = Math.min((time - startTime) / duration, 1);
      // easeOutQuart
      const easeProgress = 1 - Math.pow(1 - progress, 4);
      setAnimatedScore(startValue + (endValue - startValue) * easeProgress);

      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }, [sentiment.score]);

  // Map score (0-100) to degrees (0-180) for the gauge needle
  const rotation = useMemo(() => {
    return (animatedScore / 100) * 180;
  }, [animatedScore]);

  // Path length for R=80, 180deg arc is Pi * 80 ≈ 251.32
  const pathLength = 251.32;
  const dashOffset = pathLength - (animatedScore / 100) * pathLength;

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
        className={`absolute inset-0 opacity-10 blur-3xl transition-colors duration-1000 ${
          sentiment.signal.includes('BUY') ? 'bg-green-500' : 
          sentiment.signal.includes('SELL') ? 'bg-red-500' : 'bg-yellow-500'
        }`}
      />

      <h3 className="text-sm font-medium text-slate-400 mb-10 z-10 tracking-widest uppercase flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-brand-primary animate-pulse"></span>
        Live Sentiment
      </h3>
      
      <div className="relative w-72 h-36 z-10 flex flex-col items-center group">
        {/* Gauge Arc SVG */}
        <svg viewBox="0 0 200 100" className="w-full h-full drop-shadow-2xl overflow-visible">
          <defs>
            <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#ef4444" /> {/* Red / Strong Sell */}
              <stop offset="25%" stopColor="#f87171" /> {/* Light Red / Sell */}
              <stop offset="50%" stopColor="#facc15" /> {/* Yellow / Neutral */}
              <stop offset="75%" stopColor="#4ade80" /> {/* Light Green / Buy */}
              <stop offset="100%" stopColor="#22c55e" /> {/* Green / Strong Buy */}
            </linearGradient>
            
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          
          {/* Background Track (Thick) */}
          <path d="M 10 90 A 80 80 0 0 1 190 90" fill="none" stroke="#1e293b" strokeWidth="16" strokeLinecap="round" />
          
          {/* Colored Arc (Animated Fill) */}
          <path 
            d="M 10 90 A 80 80 0 0 1 190 90" 
            fill="none" 
            stroke="url(#gaugeGradient)" 
            strokeWidth="16" 
            strokeLinecap="round" 
            strokeDasharray={pathLength}
            strokeDashoffset={dashOffset}
            className="transition-all duration-75 ease-linear"
            filter="url(#glow)"
          />
          
          {/* Detailed Ticks */}
          {[...Array(11)].map((_, i) => {
             const angle = (i * 18) * (Math.PI / 180);
             const rOuter = 70;
             const rInner = i % 5 === 0 ? 60 : 65;
             const x1 = 100 - rOuter * Math.cos(angle);
             const y1 = 90 - rOuter * Math.sin(angle);
             const x2 = 100 - rInner * Math.cos(angle);
             const y2 = 90 - rInner * Math.sin(angle);
             return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#475569" strokeWidth={i % 5 === 0 ? 2 : 1} />;
          })}
          
          {/* The Needle */}
          <g 
            style={{ 
              transformOrigin: '100px 90px', 
              transform: `rotate(${rotation - 90}deg)`,
            }} 
            className="transition-all duration-75 ease-linear"
          >
            <polygon points="97,90 103,90 100,15" fill="#f8fafc" className="drop-shadow-xl" />
            <circle cx="100" cy="90" r="8" fill="#f8fafc" filter="url(#glow)" />
            <circle cx="100" cy="90" r="3" fill="#0f172a" />
          </g>
        </svg>

        {/* Labels under the gauge arc */}
        <div className="absolute top-[90px] w-full flex justify-between px-4 text-[10px] text-gray-500 font-bold uppercase tracking-wider">
          <span className="text-red-500/80">Sell</span>
          <span className="text-yellow-500/80">Neutral</span>
          <span className="text-green-500/80">Buy</span>
        </div>
      </div>

      <div className="mt-6 z-10 flex flex-col items-center">
        <span className={`text-4xl font-black tracking-tight ${getColor(sentiment.signal)} transition-colors duration-500 drop-shadow-[0_0_20px_rgba(255,255,255,0.15)] transform group-hover:scale-105`}>
          {getLabel(sentiment.signal)}
        </span>
        <div className="mt-2 flex items-baseline gap-1">
          <span className="text-sm text-slate-400 font-medium">Power Score:</span>
          <span className={`text-lg font-mono font-bold ${getColor(sentiment.signal)}`}>
            {animatedScore.toFixed(1)}
          </span>
          <span className="text-xs text-slate-500">/ 100</span>
        </div>
      </div>
    </div>
  );
};
