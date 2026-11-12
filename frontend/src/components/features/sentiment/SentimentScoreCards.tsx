import React, { useState, useEffect } from 'react';
import Card from '@/components/common/Card';
import InfoTooltip from '@/components/common/InfoTooltip';

// --- Sub Component: SentimentOrb ---
const SentimentOrb = ({ score, momentum, volume, netflow }: any) => {
    // Determine State
    const mood = score > 0.2 ? "Bullish" : score < -0.2 ? "Bearish" : "Neutral";

    // Advanced Color Palettes for Neon/Holographic Effect
    const themes = {
        Bullish: {
            primary: "emerald",
            hex: "#10b981",
            gradient: "from-emerald-600 via-teal-500 to-green-500 dark:from-emerald-500 dark:via-teal-400 dark:to-green-300",
            shadow: "shadow-[0_0_50px_-12px_rgba(16,185,129,0.45)] dark:shadow-[0_0_50px_-12px_rgba(16,185,129,0.6)]",
            textGlow: "dark:drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]",
            textClass: "text-emerald-600 dark:text-emerald-400",
            ringBorder: "border-emerald-500/40 dark:border-emerald-500/50",
            pulseBg: "bg-emerald-500/15 dark:bg-emerald-500/20",
            badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
            dotClass: "bg-emerald-500 dark:bg-emerald-400",
            btnClass: "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20",
            btnOverlay: "bg-emerald-500/20",
            btnText: "text-emerald-700 dark:text-emerald-400 group-hover:text-emerald-800 dark:group-hover:text-emerald-300",
            hoverMetric: "group-hover:text-emerald-600 dark:group-hover:text-emerald-400",
            zapText: "text-emerald-500"
        },
        Bearish: {
            primary: "rose",
            hex: "#f43f5e",
            gradient: "from-rose-600 via-red-500 to-orange-500 dark:from-rose-500 dark:via-red-500 dark:to-orange-400",
            shadow: "shadow-[0_0_50px_-12px_rgba(244,63,94,0.45)] dark:shadow-[0_0_50px_-12px_rgba(244,63,94,0.6)]",
            textGlow: "dark:drop-shadow-[0_0_10px_rgba(244,63,94,0.8)]",
            textClass: "text-rose-600 dark:text-rose-400",
            ringBorder: "border-rose-500/40 dark:border-rose-500/50",
            pulseBg: "bg-rose-500/15 dark:bg-rose-500/20",
            badgeClass: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
            dotClass: "bg-rose-500 dark:bg-rose-400",
            btnClass: "bg-rose-500/10 border-rose-500/30 hover:bg-rose-500/20",
            btnOverlay: "bg-rose-500/20",
            btnText: "text-rose-700 dark:text-rose-400 group-hover:text-rose-800 dark:group-hover:text-rose-300",
            hoverMetric: "group-hover:text-rose-600 dark:group-hover:text-rose-400",
            zapText: "text-rose-500"
        },
        Neutral: {
            primary: "indigo",
            hex: "#6366f1",
            gradient: "from-indigo-600 via-blue-500 to-cyan-500 dark:from-indigo-500 dark:via-blue-400 dark:to-cyan-300",
            shadow: "shadow-[0_0_50px_-12px_rgba(99,102,241,0.45)] dark:shadow-[0_0_50px_-12px_rgba(99,102,241,0.6)]",
            textGlow: "dark:drop-shadow-[0_0_10px_rgba(99,102,241,0.8)]",
            textClass: "text-indigo-600 dark:text-indigo-400",
            ringBorder: "border-indigo-500/40 dark:border-indigo-500/50",
            pulseBg: "bg-indigo-500/15 dark:bg-indigo-500/20",
            badgeClass: "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-400",
            dotClass: "bg-indigo-500 dark:bg-indigo-400",
            btnClass: "bg-indigo-500/10 border-indigo-500/30 hover:bg-indigo-500/20",
            btnOverlay: "bg-indigo-500/20",
            btnText: "text-indigo-700 dark:text-indigo-400 group-hover:text-indigo-800 dark:group-hover:text-indigo-300",
            hoverMetric: "group-hover:text-indigo-600 dark:group-hover:text-indigo-400",
            zapText: "text-indigo-500"
        }
    };

    const theme = themes[mood as keyof typeof themes];
    const rotationSpeed = Math.max(3, 15 - Math.abs(momentum));

    return (
        <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-slate-50 dark:bg-[#0A0A0A] rounded-2xl border border-slate-200 dark:border-[#1F1F1F]/50">
            {/* --- Background Cyber Grid --- */}
            <div className="absolute inset-0 opacity-30 dark:opacity-20 pointer-events-none"
                style={{
                    backgroundImage: `linear-gradient(${theme.hex}22 1px, transparent 1px), linear-gradient(90deg, ${theme.hex}22 1px, transparent 1px)`,
                    backgroundSize: '40px 40px',
                    maskImage: 'radial-gradient(circle at center, black 40%, transparent 80%)'
                }}>
            </div>

            {/* --- Main Reactor Core --- */}
            <div className="relative flex items-center justify-center w-72 h-72">

                {/* 1. Outer Static Ring with Ticks */}
                <div className="absolute inset-0 border border-slate-300/70 dark:border-[#1F1F1F]/50 rounded-full opacity-70 dark:opacity-50"></div>

                {/* 2. Rotating Dash Ring (Clockwise) */}
                <div className="absolute inset-2 border-2 border-dashed border-slate-300 dark:border-slate-600/60 rounded-full animate-[spin_10s_linear_infinite]"
                    style={{ animationDuration: `${rotationSpeed * 1.5}s` }}></div>

                {/* 3. Counter-Rotating Arc Ring (Holographic) */}
                <div className={`absolute inset-4 rounded-full border-t-2 border-b-2 border-l-0 border-r-0 ${theme.ringBorder} animate-[spin_8s_linear_infinite_reverse] blur-[1px]`}
                    style={{ animationDuration: `${rotationSpeed}s` }}>
                </div>

                {/* 4. Pulsing Glow Layer */}
                <div className={`absolute w-56 h-56 ${theme.pulseBg} rounded-full blur-xl animate-pulse ${theme.shadow}`}></div>

                {/* 5. Center Core (Glassmorphism) */}
                <div className={`relative w-48 h-48 rounded-full bg-gradient-to-br from-white/95 to-slate-100/95 dark:from-slate-800/90 dark:to-slate-900/90 flex flex-col items-center justify-center 
                    backdrop-blur-xl border border-slate-200/90 dark:border-white/10 shadow-xl dark:shadow-2xl z-10 overflow-hidden group transition-all duration-500 hover:scale-105`}>

                    {/* Inner Shine */}
                    <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-white/60 dark:from-white/10 to-transparent opacity-60 dark:opacity-50 pointer-events-none"></div>

                    {/* Value Display */}
                    <div className="flex flex-col items-center z-20">
                        <div className="flex items-center gap-1 mb-1">
                            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500 dark:text-slate-400">Smart Money</span>
                            <InfoTooltip text="Sentiment derived from institutional players, whale wallet movements, and on-chain analysis." />
                        </div>
                        <span className={`text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b ${theme.gradient} ${theme.textGlow}`}>
                            {score.toFixed(2)}
                        </span>

                        <div className={`mt-2 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border ${theme.badgeClass}`}>
                            {mood}
                        </div>
                    </div>

                    {/* Orbiting Particle */}
                    <div className="absolute inset-0 animate-[spin_3s_linear_infinite]">
                        <div className={`absolute top-2 left-1/2 w-1.5 h-1.5 ${theme.dotClass} rounded-full shadow-[0_0_10px_currentColor]`}></div>
                    </div>
                </div>
            </div>

            {/* --- Bottom Status Panel (HUD Style) --- */}
            <div className="mt-8 w-full px-8 flex flex-col items-center gap-4 relative z-10">
                {/* Dynamic Unified Trade Button */}
                <button className={`w-full group relative overflow-hidden px-4 py-3 rounded-xl border ${theme.btnClass} transition-all shadow-sm dark:shadow-[0_0_20px_rgba(0,0,0,0.2)]`}>
                    <div className={`absolute inset-0 ${theme.btnOverlay} translate-y-full group-hover:translate-y-0 transition-transform duration-300`}></div>
                    <div className="relative flex items-center justify-center gap-3">
                        <span className="text-xl animate-bounce">
                            {score > 0.1 ? '🚀' : score < -0.1 ? '🔻' : '⚖️'}
                        </span>
                        <span className={`text-sm font-black uppercase tracking-widest ${theme.btnText}`}>
                            {netflow?.toUpperCase() || (score > 0.1 ? 'LONG / BUY' : score < -0.1 ? 'SHORT / SELL' : 'HOLD')}
                        </span>
                    </div>
                </button>

                {/* Metrics HUD */}
                <div className="flex justify-between w-full text-xs font-mono border-t border-slate-200 dark:border-[#1F1F1F]/50 pt-3 mt-1">
                    <div className="flex flex-col items-center gap-1 group cursor-default">
                        <div className="flex items-center">
                            <span className="text-slate-500 uppercase text-[10px]">Momentum</span>
                            <InfoTooltip text="The rate of acceleration in sentiment change over the selected timeframe." />
                        </div>
                        <span className={`text-slate-800 dark:text-slate-300 font-bold ${theme.hoverMetric} transition-colors`}>{momentum.toFixed(2)}</span>
                    </div>
                    <div className="w-px h-8 bg-gradient-to-b from-transparent via-slate-300 dark:via-slate-600 to-transparent"></div>
                    <div className="flex flex-col items-center gap-1 group cursor-default">
                        <div className="flex items-center">
                            <span className="text-slate-500 uppercase text-[10px]">Active Vol</span>
                            <InfoTooltip text="The total frequency of mentions across all tracked social platforms." />
                        </div>
                        <div className="flex items-center gap-1">
                            <span className={`animate-pulse ${theme.zapText}`}>⚡</span>
                            <span className={`text-slate-800 dark:text-slate-300 font-bold ${theme.hoverMetric} transition-colors`}>{volume}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- Sub Component: FearGreedFlux ---
const FearGreedFlux = ({ score, classification }: any) => {
    const [timeLeft, setTimeLeft] = useState<string>('--h --m');

    // Countdown logic
    useEffect(() => {
        const updateTimer = () => {
            const now = new Date();
            const nextUpdate = new Date();
            nextUpdate.setUTCHours(24, 0, 0, 0);
            const diff = nextUpdate.getTime() - now.getTime();
            if (diff > 0) {
                const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
                const minutes = Math.floor((diff / (1000 * 60)) % 60);
                setTimeLeft(`${hours}h ${minutes}m`);
            } else {
                setTimeLeft('Updating...');
            }
        };
        updateTimer();
        const interval = setInterval(updateTimer, 60000);
        return () => clearInterval(interval);
    }, []);

    // Color Logic
    const getColor = (s: number) => {
        if (s < 25) return { hex: '#ef4444', label: 'Extreme Fear', tail: 'bg-red-500', text: 'text-red-500' };
        if (s < 45) return { hex: '#f97316', label: 'Fear', tail: 'bg-orange-500', text: 'text-orange-500' };
        if (s < 55) return { hex: '#eab308', label: 'Neutral', tail: 'bg-yellow-500', text: 'text-yellow-500' };
        if (s < 75) return { hex: '#84cc16', label: 'Greed', tail: 'bg-lime-500', text: 'text-lime-500' };
        return { hex: '#22c55e', label: 'Extreme Greed', tail: 'bg-emerald-500', text: 'text-emerald-500' };
    };

    const theme = getColor(score);
    const totalSegments = 40;
    const activeSegments = Math.round((score / 100) * totalSegments);

    return (
        <div className="flex flex-col items-center justify-center h-full relative overflow-hidden bg-slate-50 dark:bg-[#0A0A0A] p-4">
            {/* Background Noise */}
            <div className="absolute inset-0 opacity-20 bg-[url('/noise.svg')]"></div>

            {/* Header */}
            <div className="relative z-10 flex flex-col items-center mb-4 mt-4">
                <h4 className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">
                    Fear & Greed
                </h4>
                <div className="flex items-center justify-center -mt-1 mb-1">
                    <InfoTooltip text="Overall market emotion. Extreme fear suggests oversold conditions; extreme greed suggests overbought." />
                </div>
                <div className="flex items-center gap-2 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                    <span className="text-[9px] font-mono text-slate-500 uppercase">Live Index</span>
                </div>
            </div>

            {/* Main Gauge */}
            <div className="relative w-full max-w-[280px] aspect-[2/1] flex items-end justify-center mb-2">

                {/* SVG Segmented Arc */}
                <svg viewBox="0 0 300 160" className="w-full h-full overflow-visible">
                    <defs>
                        <filter id="glow-arc" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                    </defs>

                    {/* Render Segments */}
                    {Array.from({ length: totalSegments }).map((_, i) => {
                        const angle = 180 + (i / (totalSegments - 1)) * 180;
                        const radius = 120;
                        const x1 = 150 + radius * Math.cos((angle * Math.PI) / 180);
                        const y1 = 140 + radius * Math.sin((angle * Math.PI) / 180);

                        const innerRadius = 100;
                        const x2 = 150 + innerRadius * Math.cos((angle * Math.PI) / 180);
                        const y2 = 140 + innerRadius * Math.sin((angle * Math.PI) / 180);

                        const isActive = i < activeSegments;

                        return (
                            <line
                                key={i}
                                x1={x1} y1={y1} x2={x2} y2={y2}
                                stroke={isActive ? theme.hex : '#334155'}
                                strokeWidth="4"
                                strokeLinecap="round"
                                className={`transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-20'}`}
                                style={{ filter: isActive ? 'url(#glow-arc)' : 'none' }}
                            />
                        );
                    })}

                    {/* Inner Needle / Indicator Base */}
                    <circle cx="150" cy="140" r="80" className="fill-transparent stroke-slate-300/70 dark:stroke-slate-800/50 stroke-1" />
                </svg>

                {/* Central Digital Score */}
                <div className="absolute bottom-0 flex flex-col items-center transform translate-y-4">
                    <span className={`text-6xl font-black tracking-tighter transition-colors duration-500 drop-shadow-lg ${theme.text}`}
                        style={{ textShadow: `0 0 30px ${theme.hex}50` }}
                    >
                        {Math.round(score)}
                    </span>
                    <div className="mt-2 px-3 py-1 rounded-lg border border-slate-200 dark:border-white/10 bg-white/80 dark:bg-white/5 backdrop-blur-md">
                        <span className={`text-xs font-bold uppercase tracking-widest ${theme.text}`}>
                            {classification}
                        </span>
                    </div>
                </div>
            </div>

            {/* Footer Timer */}
            <div className="mt-2 flex items-center gap-2 text-[10px] bg-white dark:bg-[#0A0A0A]/50 px-3 py-1.5 rounded-full border border-slate-200 dark:border-[#1F1F1F]/50">
                <span className="text-slate-500 dark:text-slate-400">Next Update:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200">{timeLeft}</span>
            </div>
        </div>
    );
};

interface SentimentScoreCardsProps {
    data: {
        currentScore: number;
        currentMomentum: number;
        currentVolume: number;
        currentSmartMoney: number;
        currentNetflow: string;
        fearGreedIndex: number;
        fearGreedLabel: string;
    }
}

export const SentimentScoreCards: React.FC<SentimentScoreCardsProps> = ({ data }) => {
    return (
        <div className="space-y-6">
            <Card className="h-[420px] !p-0 overflow-hidden relative">
                <div className="absolute inset-0 bg-[url('/noise.svg')] opacity-10"></div>
                <SentimentOrb
                    score={data.currentSmartMoney}
                    momentum={data.currentMomentum}
                    volume={data.currentVolume}
                    netflow={data.currentNetflow}
                />
            </Card>
            <Card className="h-64 !p-0 overflow-hidden">
                <FearGreedFlux
                    score={data.fearGreedIndex}
                    classification={data.fearGreedLabel}
                />
            </Card>
        </div>
    );
};
