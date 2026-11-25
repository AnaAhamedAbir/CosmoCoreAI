
import React, { useState, useEffect, useRef } from 'react';
import {
    BacktesterIcon, BotLabIcon,
    InteractiveBrokersLogo, CoinbaseLogo, BitfinexLogo, AlpacaLogo,
    CharlesSchwabLogo, KrakenLogo, BinanceLogo,
    IdeaIcon,
    MOCK_CRYPTO_NEWS
} from '@/constants';
import { useTheme } from '@/context/ThemeContext';
import MarketTicker from '@/components/features/market/MarketTicker';
import { useToast } from '@/context/ToastContext';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import type { PublicView } from './PublicWebsite';
import type { BriefingTopic } from './PublicBriefingModal';
import {
    ArrowRight,
    PlayCircle,
    Sparkles,
    ShieldCheck,
    Radar,
    Zap,
    Activity,
    Globe,
    Copy,
    Check,
    Calendar,
    X,
} from 'lucide-react';

// Scroll Animation Hook
const useScrollAnimation = (threshold = 0.1) => {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    observer.unobserve(entry.target);
                }
            },
            { threshold }
        );
        if (ref.current) observer.observe(ref.current);
        return () => { if (ref.current) observer.unobserve(ref.current); };
    }, [threshold]);
    return ref;
};

// ============================
// Cosmic Star Background (Warp Speed / Back Window View)
// ============================
export const CosmicStarBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let animId: number = 0;
        let resumeTimerId: number = 0;
        let isDisposed = false;
        const maxZ = 3000;
        // Desktop: full 24,000 warp stars @ native refresh rate.
        // Mobile/Tablet thermal guard: capped density (uses physical screen width so desktop-view toggle on phones doesn't inflate star count)
        // rendered via flat TypedArrays + 30 batched RGBA path fills @ 30 FPS cap.
        const effectiveStarWidth = thermalGuard
            ? Math.min(window.innerWidth, window.screen?.width || window.innerWidth)
            : window.innerWidth;
        const starCount = thermalGuard
            ? Math.min(4800, Math.max(1500, Math.round(effectiveStarWidth * 7)))
            : Math.min(24000, window.innerWidth * 18);
        const palette = ['#ffffff', '#e2e8f0', '#a5f3fc', '#67e8f9', '#8b5cf6', '#d946ef'];
        const paletteRgb = [
            '255,255,255',
            '226,232,240',
            '165,243,252',
            '103,232,249',
            '139,92,246',
            '217,70,239',
        ];

        const resize = () => {
            const parent = canvas.parentElement;
            const nextWidth = parent ? parent.clientWidth : window.innerWidth;
            const nextHeight = parent ? parent.clientHeight : window.innerHeight;
            // Only update canvas backing store when dimensions actually change (ignores mobile URL-bar height shifts)
            if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
                canvas.width = nextWidth;
                canvas.height = nextHeight;
            }
        };

        // --- Optimized Batched TypedArray Renderer (Mobile/Tablet Thermal Guard) ---
        const ALPHA_LEVELS = [0.2, 0.4, 0.6, 0.8, 1.0];
        const ALPHA_STEPS = ALPHA_LEVELS.length;
        const COLORS = paletteRgb.length;
        const TOTAL_BUCKETS = COLORS * ALPHA_STEPS;
        const bucketFillStyles: string[] = [];
        for (let c = 0; c < COLORS; c++) {
            for (let a = 0; a < ALPHA_STEPS; a++) {
                bucketFillStyles.push(`rgba(${paletteRgb[c]},${ALPHA_LEVELS[a]})`);
            }
        }

        const starX = thermalGuard ? new Float32Array(starCount) : null;
        const starY = thermalGuard ? new Float32Array(starCount) : null;
        const starZ = thermalGuard ? new Float32Array(starCount) : null;
        const starSizeMul = thermalGuard ? new Float32Array(starCount) : null;
        const starColorIdx = thermalGuard ? new Uint8Array(starCount) : null;

        const maxPerColor = thermalGuard ? Math.ceil(starCount / COLORS) + 1 : 0;
        const bucketStride = maxPerColor * 3;
        const bucketData = thermalGuard ? new Float32Array(TOTAL_BUCKETS * bucketStride) : null;
        const bucketCounts = thermalGuard ? new Int32Array(TOTAL_BUCKETS) : null;

        // --- Standard Desktop Class Renderer (Untouched on PC) ---
        class Star {
            x: number; y: number; z: number; pz: number; color: string; sizeMultiplier: number;
            constructor(spawnAnywhere: boolean = false) {
                const angle = Math.random() * Math.PI * 2;
                const distance = Math.pow(Math.random(), 0.8) * (maxZ / 1.2) + 5;
                this.x = Math.cos(angle) * distance;
                this.y = Math.sin(angle) * distance;
                this.z = spawnAnywhere ? Math.random() * maxZ : 10;
                this.pz = this.z;
                this.sizeMultiplier = Math.random() < 0.9 ? (Math.random() * 0.4 + 0.1) : (Math.random() * 1.2 + 0.6);
                this.color = palette[Math.floor(Math.random() * palette.length)];
            }
            update(speed: number) {
                this.pz = this.z;
                this.z += speed;
                if (this.z > maxZ) {
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.pow(Math.random(), 0.8) * (maxZ / 1.2) + 5;
                    this.x = Math.cos(angle) * distance;
                    this.y = Math.sin(angle) * distance;
                    this.z = 10;
                    this.pz = 10;
                }
            }
            draw(width: number, height: number, fov: number, cx: number, cy: number) {
                const sx = (this.x / this.z) * fov + cx;
                const sy = (this.y / this.z) * fov + cy;
                if (sx < 0 || sx > width || sy < 0 || sy > height) return;
                const depthFactor = 1 - (this.z / maxZ);
                const opacity = Math.min(1, Math.max(0, depthFactor * (this.sizeMultiplier + 0.5)));
                const size = Math.max(0.1, depthFactor * 2 * this.sizeMultiplier);
                ctx!.fillStyle = this.color;
                ctx!.globalAlpha = opacity;
                ctx!.fillRect(sx, sy, size, size);
            }
        }

        let desktopStars: Star[] = [];

        const init = () => {
            if (thermalGuard && starX && starY && starZ && starSizeMul && starColorIdx) {
                const baseRadius = maxZ / 1.2;
                for (let i = 0; i < starCount; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const distance = Math.pow(Math.random(), 0.8) * baseRadius + 5;
                    starX[i] = Math.cos(angle) * distance;
                    starY[i] = Math.sin(angle) * distance;
                    starZ[i] = Math.random() * maxZ;
                    starSizeMul[i] = Math.random() < 0.9 ? (Math.random() * 0.4 + 0.1) : (Math.random() * 1.2 + 0.6);
                    starColorIdx[i] = i % COLORS;
                }
            } else {
                desktopStars = [];
                for (let i = 0; i < starCount; i++) {
                    desktopStars.push(new Star(true));
                }
            }
        };

        let lastFrameTime = 0;
        const minMobileFrameMs = 31.5; // Caps mobile/tablet starfield to ~30 FPS for cool battery & GPU thermals

        const scheduleResumeCheck = () => {
            if (isDisposed || resumeTimerId) return;
            resumeTimerId = window.setTimeout(() => {
                resumeTimerId = 0;
                if (isDisposed || document.hidden) return;
                if (canvas.offsetParent !== null && !animId) {
                    lastFrameTime = 0;
                    animId = requestAnimationFrame(animate);
                } else if (canvas.offsetParent === null) {
                    scheduleResumeCheck();
                }
            }, 500);
        };

        const animate = (timestamp: number = 0) => {
            if (isDisposed) return;

            if (typeof document !== 'undefined' && document.hidden) {
                animId = 0;
                return;
            }

            if (canvas.offsetParent === null) {
                animId = 0;
                scheduleResumeCheck();
                return;
            }

            if (thermalGuard && starX && starY && starZ && starSizeMul && starColorIdx && bucketData && bucketCounts) {
                if (lastFrameTime && (timestamp - lastFrameTime) < minMobileFrameMs) {
                    animId = requestAnimationFrame(animate);
                    return;
                }
                const dt = lastFrameTime ? Math.min(50, timestamp - lastFrameTime) : 16.67;
                lastFrameTime = timestamp;

                const width = canvas.width;
                const height = canvas.height;
                const fov = width * 0.8;
                const cx = width * 0.5;
                const cy = height * 0.5;
                const speed = Math.max(2, (dt / 16.67) * 4);
                const baseRadius = maxZ / 1.2;

                bucketCounts.fill(0);

                for (let i = 0; i < starCount; i++) {
                    let z = starZ[i] + speed;
                    if (z > maxZ) {
                        const angle = Math.random() * Math.PI * 2;
                        const distance = Math.pow(Math.random(), 0.8) * baseRadius + 5;
                        starX[i] = Math.cos(angle) * distance;
                        starY[i] = Math.sin(angle) * distance;
                        z = 10;
                    }
                    starZ[i] = z;

                    const sx = (starX[i] / z) * fov + cx;
                    if (sx < 0 || sx > width) continue;
                    const sy = (starY[i] / z) * fov + cy;
                    if (sy < 0 || sy > height) continue;

                    const depthFactor = 1 - (z / maxZ);
                    const mul = starSizeMul[i];
                    const opacity = Math.min(1, Math.max(0, depthFactor * (mul + 0.5)));
                    const alphaIdx = Math.min(ALPHA_STEPS - 1, Math.floor(opacity * ALPHA_STEPS));
                    const b = starColorIdx[i] * ALPHA_STEPS + alphaIdx;
                    const count = bucketCounts[b];
                    const writePos = b * bucketStride + count * 3;
                    bucketData[writePos] = sx;
                    bucketData[writePos + 1] = sy;
                    bucketData[writePos + 2] = Math.max(0.35, depthFactor * 2 * mul);
                    bucketCounts[b] = count + 1;
                }

                ctx!.globalAlpha = 1.0;
                ctx!.clearRect(0, 0, width, height);

                for (let b = 0; b < TOTAL_BUCKETS; b++) {
                    const count = bucketCounts[b];
                    if (count === 0) continue;
                    ctx!.fillStyle = bucketFillStyles[b];
                    ctx!.beginPath();
                    const base = b * bucketStride;
                    for (let k = 0; k < count; k++) {
                        const p = base + k * 3;
                        const sz = bucketData[p + 2];
                        ctx!.rect(bucketData[p], bucketData[p + 1], sz, sz);
                    }
                    ctx!.fill();
                }

                animId = requestAnimationFrame(animate);
                return;
            }

            const width = canvas.width;
            const height = canvas.height;
            const fov = width * 0.8;
            const cx = width / 2;
            const cy = height / 2;

            ctx!.globalAlpha = 1.0;
            ctx!.clearRect(0, 0, width, height);

            const speed = 4;
            for (let i = 0; i < desktopStars.length; i++) {
                const s = desktopStars[i];
                s.update(speed);
                s.draw(width, height, fov, cx, cy);
            }

            animId = requestAnimationFrame(animate);
        };

        const handleResize = () => {
            resize();
        };

        const handleVisibilityChange = () => {
            if (isDisposed) return;
            if (document.hidden) {
                if (animId) {
                    cancelAnimationFrame(animId);
                    animId = 0;
                }
            } else if (!animId) {
                lastFrameTime = 0;
                animId = requestAnimationFrame(animate);
            }
        };

        resize();
        init();
        animId = requestAnimationFrame(animate);
        window.addEventListener('resize', handleResize);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            isDisposed = true;
            window.removeEventListener('resize', handleResize);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (animId) cancelAnimationFrame(animId);
            if (resumeTimerId) clearTimeout(resumeTimerId);
        };
    }, [thermalGuard]);

    return (
        <>
            {/* Full-viewport solid black backdrop independent of browser toolbar height */}
            <div className="fixed inset-0 z-0 pointer-events-none bg-black" />
            {/* Bottom-anchored constant-lvh stage so top URL/tab bar hide/show on Chrome mobile & tablet never shifts the galaxy */}
            <div
                className="fixed bottom-0 left-0 right-0 z-0 w-full h-[100lvh] min-h-screen pointer-events-none overflow-hidden"
                style={{ transform: 'translateZ(0)' }}
            >
                {/* Distant Galaxy Image Background - Centered, Masked, Static, Balanced Distance */}
                <div 
                    className="absolute top-1/2 left-1/2 w-[600px] h-[600px] md:w-[800px] md:h-[800px] bg-[url('/distant_galaxy_bg.png')] bg-cover bg-center bg-no-repeat opacity-45"
                    style={{ 
                        transform: 'translate3d(-50%, -50%, 0)',
                        mixBlendMode: thermalGuard ? 'normal' : 'screen',
                        WebkitMaskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 70%)',
                        maskImage: 'radial-gradient(circle at center, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 70%)'
                    }}
                />
                {/* 3D Starfield Canvas */}
                <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                    style={thermalGuard ? undefined : { willChange: 'transform', transform: 'translateZ(0)' }}
                />
            </div>
        </>
    );
};

// ============================
// Cyber Card / Glow Card
// ============================
const CyberCard: React.FC<{ children: React.ReactNode; className?: string; glowColor?: string }> = ({
    children, className = '', glowColor = 'cyan'
}) => {
    const divRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const [opacity, setOpacity] = useState(0);
    const thermalGuard = isThermalGuardActive();

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        if (thermalGuard || !divRef.current) return;
        const rect = divRef.current.getBoundingClientRect();
        setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const colorMap: Record<string, string> = {
        cyan: 'rgba(6,182,212,0.15)',
        violet: 'rgba(139,92,246,0.15)',
        green: 'rgba(34,197,94,0.12)',
        blue: 'rgba(59,130,246,0.12)',
        pink: 'rgba(236,72,153,0.12)',
    };

    return (
        <div
            ref={divRef}
            onMouseMove={handleMouseMove}
            onMouseEnter={() => { if (!thermalGuard) setOpacity(1); }}
            onMouseLeave={() => setOpacity(0)}
            className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[#070F20]/70 ${thermalGuard ? '' : 'backdrop-blur-xl'} ${className}`}
        >
            {!thermalGuard && (
                <>
                    <div
                        className="pointer-events-none absolute -inset-px transition-opacity duration-300 rounded-2xl"
                        style={{
                            opacity,
                            background: `radial-gradient(500px circle at ${pos.x}px ${pos.y}px, ${colorMap[glowColor] || colorMap.cyan}, transparent 40%)`,
                        }}
                    />
                    <div
                        className="pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-300"
                        style={{
                            opacity: opacity * 0.5,
                            boxShadow: `inset 0 0 0 1px ${colorMap[glowColor]?.replace('0.15', '0.5') || 'rgba(6,182,212,0.5)'}`,
                        }}
                    />
                </>
            )}
            <div className="relative h-full z-10">{children}</div>
        </div>
    );
};

// ============================
// News Ticker
// ============================
const LandingPageNewsTicker: React.FC<{ onSignUp: () => void }> = ({ onSignUp }) => {
    const [selectedNews, setSelectedNews] = useState<any>(null);
    const thermalGuard = isThermalGuardActive();

    return (
        <>
            <div className={`w-full bg-[#020A1A]/85 border-t border-cyan-500/15 py-2 px-4 overflow-hidden flex items-center relative z-20 ${thermalGuard ? '' : 'backdrop-blur-sm'}`}>
                <div className="flex items-center gap-2 px-2.5 py-1 bg-rose-500/10 border border-rose-500/25 rounded-lg flex-shrink-0 mr-4">
                    <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                    </span>
                    <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider whitespace-nowrap">Market Wire</span>
                </div>
                <div className="flex-1 overflow-hidden relative h-6">
                    <div
                        className="animate-marquee-slow landing-ticker-marquee whitespace-nowrap absolute top-0 left-0 flex items-center h-full text-sm text-slate-400"
                        style={{ animationDuration: '65s' }}
                    >
                        {[...MOCK_CRYPTO_NEWS, ...MOCK_CRYPTO_NEWS].map((news, i) => (
                            <button
                                type="button"
                                key={`${news.id}-${i}`}
                                className="mx-7 flex flex-shrink-0 items-center cursor-pointer hover:text-cyan-400 transition-colors"
                                onClick={() => setSelectedNews(news)}
                            >
                                <span className="font-bold text-slate-500 text-xs mr-2">[{news.source}]</span>
                                {news.text}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {selectedNews && (
                <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/75 ${thermalGuard ? '' : 'backdrop-blur-md'}`} onClick={() => setSelectedNews(null)}>
                    <div
                        className="bg-[#070F20] w-full max-w-md rounded-2xl shadow-2xl border border-cyan-500/25 overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-emerald-400" />
                        <div className="p-6 relative">
                            <button
                                type="button"
                                onClick={() => setSelectedNews(null)}
                                aria-label="Close news details"
                                className="absolute top-4 right-4 text-slate-400 hover:text-white transition-colors"
                            >
                                <X className="w-5 h-5" />
                            </button>
                            <div className="flex items-center gap-3 mb-4">
                                <span className="px-2.5 py-1 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold uppercase tracking-wider">{selectedNews.source}</span>
                                <span className="text-xs text-slate-500 font-mono">Headline Snapshot</span>
                            </div>
                            <h3 className="text-lg font-bold text-white leading-snug mb-4">{selectedNews.text}</h3>
                            <div className="p-4 bg-white/5 rounded-xl border border-white/10 mb-5">
                                <p className="text-sm text-slate-300 leading-relaxed">
                                    <strong className="block mb-1 text-slate-400 text-xs uppercase tracking-wider">Sentiment Polarity</strong>
                                    Classified:{' '}
                                    <span className={`font-bold capitalize ${selectedNews.sentiment === 'positive' ? 'text-emerald-400' : selectedNews.sentiment === 'negative' ? 'text-rose-400' : 'text-amber-400'}`}>
                                        {selectedNews.sentiment}
                                    </span>
                                </p>
                            </div>
                            <div className="flex gap-2.5">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedNews(null);
                                        onSignUp();
                                    }}
                                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-xs font-bold text-white"
                                >
                                    Analyze in Terminal
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setSelectedNews(null)}
                                    className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 hover:bg-white/10 transition-all"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ============================
// Market Intelligence Section
// ============================
const MarketIntelligenceSection: React.FC<{
    onSelectChartPair: (pairSymbol: string) => void;
}> = ({ onSelectChartPair }) => {
    const ref = useScrollAnimation();
    const [activeSignal, setActiveSignal] = useState(0);

    const signals = [
        { pair: 'BTC/USDT', tvSymbol: 'BTCUSDT', signal: 'WALL ABSORPTION', conf: 88, type: 'long' },
        { pair: 'SOL/USDT', tvSymbol: 'SOLUSDT', signal: 'LIQUIDITY SWEEP', conf: 92, type: 'long' },
        { pair: 'ETH/USDT', tvSymbol: 'ETHUSDT', signal: 'ASK WALL CLUSTER', conf: 79, type: 'short' },
        { pair: 'BNB/USDT', tvSymbol: 'BNBUSDT', signal: 'SUPPORT RECLAIM', conf: 84, type: 'long' },
    ];

    const sectorFlow = [
        { n: 'AI', v: 85, barClass: 'bg-cyan-500/70 border-cyan-400/50', textClass: 'text-cyan-300' },
        { n: 'DeFi', v: 52, barClass: 'bg-violet-500/70 border-violet-400/50', textClass: 'text-violet-300' },
        { n: 'L1', v: 64, barClass: 'bg-blue-500/70 border-blue-400/50', textClass: 'text-blue-300' },
        { n: 'Perps', v: 78, barClass: 'bg-pink-500/70 border-pink-400/50', textClass: 'text-pink-300' },
        { n: 'Memes', v: 92, barClass: 'bg-emerald-500/70 border-emerald-400/50', textClass: 'text-emerald-300' },
    ];

    useEffect(() => {
        const isThermalGuard = isThermalGuardActive();
        const intervalMs = isThermalGuard ? 5000 : 2500;
        const timer = setInterval(() => {
            if (isThermalGuard && typeof document !== 'undefined' && document.hidden) return;
            setActiveSignal(prev => (prev + 1) % signals.length);
        }, intervalMs);
        return () => clearInterval(timer);
    }, []);

    return (
        <div ref={ref} className="py-20 bg-transparent fade-in-up border-b border-white/5">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-bold uppercase tracking-widest mb-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        Telemetry Preview
                    </div>
                    <h2 className="text-3xl md:text-4xl font-extrabold text-white">
                        Liquidity &amp; Sentiment at a{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-400">Glance</span>
                    </h2>
                    <p className="text-sm text-slate-400 mt-3 max-w-xl mx-auto">
                        Sample telemetry snapshot from WallHunter and OrderFlow scanners. Click any pair below to load its chart above.
                    </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Market Sentiment */}
                    <CyberCard glowColor="green" className="p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Market Regime Index</p>
                                <h3 className="text-4xl font-extrabold text-white">68</h3>
                                <p className="text-sm font-semibold text-emerald-400 mt-0.5">Constructive Risk-On</p>
                            </div>
                            <div className="w-16 h-16 relative">
                                <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3" />
                                    <circle
                                        cx="18"
                                        cy="18"
                                        r="15.9"
                                        fill="none"
                                        stroke="url(#greedGrad)"
                                        strokeWidth="3"
                                        strokeDasharray={`${68 * 0.999} ${100 - 68 * 0.999}`}
                                        strokeLinecap="round"
                                    />
                                    <defs>
                                        <linearGradient id="greedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="#10b981" />
                                            <stop offset="100%" stopColor="#22d3ee" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-emerald-400">68%</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-5 gap-1.5 mb-2">
                            {[0, 1, 2, 3, 4].map((i) => (
                                <div key={i} className={`h-1.5 rounded-full ${i < 3 ? 'bg-white/15' : i === 3 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-white/5'}`} />
                            ))}
                        </div>
                        <div className="flex justify-between text-[10px] font-mono text-slate-500">
                            <span>Fear</span>
                            <span>Neutral</span>
                            <span className="text-emerald-400">Greed</span>
                        </div>
                    </CyberCard>

                    {/* Clickable Signal Stream */}
                    <CyberCard glowColor="cyan" className="p-6">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-0.5">WallHunter Alert Stream</p>
                                <p className="text-[11px] text-slate-500">Click row to inspect chart</p>
                            </div>
                            <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                                <span className="relative flex h-1.5 w-1.5">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                </span>
                                <span className="text-[10px] text-emerald-400 font-bold">PREVIEW</span>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {signals.map((sig, idx) => (
                                <button
                                    key={sig.pair}
                                    type="button"
                                    onClick={() => onSelectChartPair(sig.tvSymbol)}
                                    className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-all duration-300 text-left ${idx === activeSignal
                                        ? 'bg-cyan-500/10 border-cyan-500/35'
                                        : 'bg-white/[0.03] border-white/5 hover:border-white/20 opacity-80 hover:opacity-100'
                                        }`}
                                >
                                    <span className="font-mono font-bold text-sm text-white">{sig.pair}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg ${sig.type === 'long' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'}`}>
                                        {sig.signal}
                                    </span>
                                    <span className="text-xs font-mono font-bold text-cyan-400">{sig.conf}%</span>
                                </button>
                            ))}
                        </div>
                    </CyberCard>

                    {/* Touch-friendly Sector Flow */}
                    <CyberCard glowColor="violet" className="p-6 flex flex-col">
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Capital Rotation (24h)</p>
                            <span className="text-[10px] font-mono text-violet-300">Sample Flow</span>
                        </div>
                        <div className="flex-1 flex items-end gap-3 pt-2">
                            {sectorFlow.map((sec) => (
                                <div key={sec.n} className="flex-1 flex flex-col items-center gap-1.5">
                                    <span className={`text-[11px] font-mono font-bold ${sec.textClass}`}>{sec.v}%</span>
                                    <div className="w-full rounded-t-lg overflow-hidden relative bg-white/5 border border-white/10" style={{ height: `${Math.max(sec.v * 1.15, 24)}px` }}>
                                        <div className={`w-full h-full border-t ${sec.barClass}`} />
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400">{sec.n}</span>
                                </div>
                            ))}
                        </div>
                    </CyberCard>
                </div>
            </div>
        </div>
    );
};

// ============================
// Stats Section
// ============================
const StatsSection: React.FC = () => {
    const ref = useScrollAnimation();
    const stats = [
        { label: 'Signal Routing Speed', value: '< 15ms', icon: <Zap className="w-6 h-6 text-cyan-400" />, color: 'cyan' },
        { label: 'Cloud Worker Uptime', value: '99.98%', icon: <ShieldCheck className="w-6 h-6 text-emerald-400" />, color: 'green' },
        { label: 'Supported Exchanges', value: '6+ Major', icon: <Globe className="w-6 h-6 text-violet-400" />, color: 'violet' },
        { label: 'Automated Risk Guard', value: '24 / 7', icon: <Activity className="w-6 h-6 text-blue-400" />, color: 'blue' },
    ];

    return (
        <div ref={ref} className="py-20 border-t border-white/5 fade-in-up relative overflow-hidden">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                    {stats.map((stat) => (
                        <CyberCard key={stat.label} glowColor={stat.color} className="p-6 sm:p-7 text-center">
                            <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-3.5">
                                {stat.icon}
                            </div>
                            <h3 className="text-3xl md:text-4xl font-extrabold text-white mb-1.5">
                                {stat.value}
                            </h3>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                        </CyberCard>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ============================
// Features Bento Grid + Workflow
// ============================
const BentoGrid: React.FC<{
    onNavigate: (view: PublicView) => void;
    onScrollToDemo: () => void;
    onSignUp: () => void;
}> = ({ onNavigate, onScrollToDemo, onSignUp }) => {
    const ref = useScrollAnimation(0.1);
    const thermalGuard = isThermalGuardActive();

    const workflowSteps = [
        { step: '01', title: 'Scan or Prompt Strategy', desc: 'Use WallHunter liquidity telemetry or plain English in AI Foundry.' },
        { step: '02', title: 'Backtest & Calibrate', desc: 'Validate equity curve, drawdown, and Smart Chase stops in Paper mode.' },
        { step: '03', title: 'Deploy 24/7 Cloud Bots', desc: 'Connect trade-only API keys with automatic daily risk circuit breakers.' },
    ];

    return (
        <div id="platform-workflow" ref={ref} className="py-24 relative fade-in-up bg-transparent scroll-mt-24">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="text-center max-w-3xl mx-auto mb-14">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-bold uppercase tracking-widest mb-5">
                        <Zap className="w-3.5 h-3.5" />
                        Platform Architecture
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-white leading-tight">
                        Everything You Need to{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">Execute With Precision.</span>
                    </h2>
                    <p className="mt-4 text-base sm:text-lg text-slate-400">
                        One unified SaaS workspace combining liquidity detection, order-flow heatmaps, AI code synthesis, and automated bracket protection.
                    </p>
                </div>

                {/* 3-Step Workflow Strip */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
                    {workflowSteps.map((w) => (
                        <div key={w.step} className="rounded-2xl border border-white/10 bg-[#070F20]/75 p-5 flex items-start gap-4">
                            <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-500/15 border border-cyan-500/30 px-2.5 py-1 rounded-lg shrink-0">
                                {w.step}
                            </span>
                            <div>
                                <h3 className="text-sm font-bold text-white mb-1">{w.title}</h3>
                                <p className="text-xs text-slate-400 leading-relaxed">{w.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-6 gap-5">
                    {/* WallHunter & OrderFlow Heatmap - Large */}
                    <CyberCard glowColor="cyan" className="md:col-span-4 group min-h-[320px] flex flex-col">
                        <div className="p-7 pb-0 flex-grow">
                            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-[0_0_20px_rgba(6,182,212,0.35)]">
                                        <Radar className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h4 className="text-xl font-bold text-white">WallHunter &amp; OrderFlow Heatmap</h4>
                                        <p className="text-xs text-cyan-400 font-mono">Institutional Depth &amp; Liquidity Radar</p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => onNavigate('Services')}
                                    className="text-xs font-semibold px-3.5 py-1.5 rounded-xl border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 transition-colors inline-flex items-center gap-1"
                                >
                                    Explore Suite <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <p className="text-slate-400 max-w-xl text-sm leading-relaxed">
                                Pinpoint heavy bid/ask resting walls, spoofing shifts, and liquidation clusters overlaid directly with live price flow before entering a position.
                            </p>
                        </div>
                        <div className="relative mt-6 border-t border-white/10 bg-[#0D1117]/90 p-5">
                            <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                                <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 p-3">
                                    <span className="text-[10px] text-rose-300 block uppercase">Ask Wall Cluster</span>
                                    <span className="text-sm font-bold text-white">$98,450</span>
                                    <span className="text-[10px] text-rose-400 block mt-0.5">$4.8M Resting</span>
                                </div>
                                <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/25 p-3">
                                    <span className="text-[10px] text-cyan-300 block uppercase">Sweep Trigger</span>
                                    <span className="text-sm font-bold text-white">Smart Chase</span>
                                    <span className="text-[10px] text-cyan-400 block mt-0.5">Auto-Bracket Ready</span>
                                </div>
                                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-3">
                                    <span className="text-[10px] text-emerald-300 block uppercase">Bid Defense</span>
                                    <span className="text-sm font-bold text-white">$96,920</span>
                                    <span className="text-[10px] text-emerald-400 block mt-0.5">$6.2M Absorbed</span>
                                </div>
                            </div>
                        </div>
                    </CyberCard>

                    {/* Bot Lab & Smart Chase */}
                    <CyberCard glowColor="green" className="md:col-span-2 group min-h-[320px] flex flex-col">
                        <div className="p-7 flex-grow flex flex-col">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white mb-5 shadow-[0_0_20px_rgba(34,197,94,0.35)]">
                                <BotLabIcon />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-1.5">Bot Lab &amp; Smart Chase SL</h4>
                            <p className="text-xs text-emerald-400 font-mono mb-3">Cloud Execution &amp; Protection</p>
                            <p className="text-slate-400 text-sm leading-relaxed mb-5">
                                Deploy Paper or Live bots 24/7 with trailing Smart Chase stop-losses, split TPs, and automatic breakeven shifts.
                            </p>
                            <div className="mt-auto relative flex items-center justify-center py-2">
                                <div className="relative w-28 h-28">
                                    <div className="absolute top-1/2 left-1/2 w-4 h-4 bg-emerald-500 rounded-full -translate-x-1/2 -translate-y-1/2 z-10 shadow-[0_0_16px_rgba(34,197,94,0.8)]" />
                                    {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                                        <div key={i} className="absolute top-1/2 left-1/2 w-[52px] h-px bg-gradient-to-r from-emerald-500/60 to-transparent origin-left" style={{ transform: `rotate(${deg}deg)` }}>
                                            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-slate-800 border border-emerald-400/60" />
                                        </div>
                                    ))}
                                    <div className={`absolute inset-0 rounded-full border border-emerald-500/25 ${thermalGuard ? '' : 'animate-spin'}`} style={thermalGuard ? undefined : { animationDuration: '9s' }} />
                                </div>
                            </div>
                        </div>
                    </CyberCard>

                    {/* Backtester */}
                    <CyberCard glowColor="blue" className="md:col-span-2 group min-h-[290px] flex flex-col">
                        <div className="p-7">
                            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white mb-5 shadow-[0_0_20px_rgba(59,130,246,0.35)]">
                                <BacktesterIcon />
                            </div>
                            <h4 className="text-xl font-bold text-white mb-1.5">Parallel Backtesting</h4>
                            <p className="text-xs text-blue-400 font-mono mb-3">Historical Validation</p>
                            <p className="text-slate-400 text-sm leading-relaxed">
                                Validate entry logic, Sharpe ratio, and max drawdown across multi-year feeds before going live.
                            </p>
                        </div>
                        <div className="mt-auto h-24 w-full relative overflow-hidden">
                            <svg className="absolute bottom-0 left-0 right-0 w-full h-24" preserveAspectRatio="none" viewBox="0 0 200 60">
                                <defs>
                                    <linearGradient id="chartGrad" x1="0" y1="0" x2="1" y2="0">
                                        <stop offset="0%" stopColor="#3b82f6" />
                                        <stop offset="100%" stopColor="#06b6d4" />
                                    </linearGradient>
                                </defs>
                                <path d="M0 55 Q 30 50, 50 40 T 90 20 T 130 25 T 180 8 L200 5" fill="none" stroke="url(#chartGrad)" strokeWidth="2.5" />
                                <path d="M0 60 L0 55 Q 30 50, 50 40 T 90 20 T 130 25 T 180 8 L200 5 V60 H0 Z" fill="url(#chartGrad)" fillOpacity="0.18" />
                            </svg>
                        </div>
                    </CyberCard>

                    {/* AI Foundry & Visual Strategy Builder */}
                    <CyberCard glowColor="violet" className="md:col-span-4 group min-h-[290px] flex flex-col">
                        <div className="grid md:grid-cols-2 h-full">
                            <div className="p-7 flex flex-col justify-center">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white mb-5 shadow-[0_0_20px_rgba(139,92,246,0.35)]">
                                    <IdeaIcon className="w-6 h-6" />
                                </div>
                                <h4 className="text-xl font-bold text-white mb-1.5">AI Foundry &amp; Visual Builder</h4>
                                <p className="text-xs text-violet-400 font-mono mb-3">Natural Language + Node Logic</p>
                                <p className="text-slate-400 text-sm leading-relaxed mb-5">
                                    Turn plain-English trading rules or drag-and-drop indicator blocks into clean, backtest-ready strategies in seconds.
                                </p>
                                <div className="flex flex-wrap gap-2.5">
                                    <button
                                        type="button"
                                        onClick={onScrollToDemo}
                                        className="text-xs font-semibold px-4 py-2 rounded-xl bg-violet-500/20 border border-violet-500/40 text-violet-200 hover:bg-violet-500/30 transition-all inline-flex items-center gap-1.5"
                                    >
                                        Try Interactive Demo <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onSignUp}
                                        className="text-xs font-semibold px-4 py-2 rounded-xl border border-white/15 text-slate-300 hover:border-cyan-400/50 hover:text-white transition-all"
                                    >
                                        Open Workspace
                                    </button>
                                </div>
                            </div>
                            <div className="relative min-h-[200px] border-t md:border-t-0 md:border-l border-white/10 p-6 flex flex-col justify-center gap-3 bg-[#0D1117]/60">
                                <div className="rounded-xl bg-blue-500/10 border border-blue-500/30 px-4 py-2.5 text-xs font-mono text-blue-300 flex items-center justify-between">
                                    <span>1. Data Trigger</span>
                                    <span className="text-[10px] text-blue-400">1H / 15M Feed</span>
                                </div>
                                <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-2.5 text-xs font-mono text-amber-300 flex items-center justify-between">
                                    <span>2. Filter Logic</span>
                                    <span className="text-[10px] text-amber-400">RSI + Wall Cluster</span>
                                </div>
                                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2.5 text-xs font-mono text-emerald-300 flex items-center justify-between">
                                    <span>3. Smart Execution</span>
                                    <span className="text-[10px] text-emerald-400">Chase SL + Split TP</span>
                                </div>
                            </div>
                        </div>
                    </CyberCard>
                </div>
            </div>
        </div>
    );
};

// ============================
// Working Interactive AI Strategy Synthesizer
// ============================
interface StrategyPreset {
    id: string;
    label: string;
    prompt: string;
    metrics: { winRate: string; profitFactor: string; maxDrawdown: string };
    code: string;
}

const STRATEGY_PRESETS: StrategyPreset[] = [
    {
        id: 'wallhunter',
        label: 'WallHunter Liquidity Sweep',
        prompt: 'Enter long on BTC/USDT when a bid liquidity sweep absorbs sell pressure below VWAP, with Smart Chase SL and 2R split TP.',
        metrics: { winRate: '64.2%', profitFactor: '2.18', maxDrawdown: '-6.4%' },
        code: `class WallHunterLiquiditySweep(CosmoStrategy):
    symbol = "BTC/USDT"
    timeframe = "15m"
    chase_sl_atr = 1.25

    def on_bar(self, bar, orderbook):
        sweep = orderbook.detect_liquidity_sweep(side="bid", min_usd=1_500_000)
        reclaim = bar.close > self.vwap(bar)
        if sweep and reclaim and not self.position:
            stop_price = bar.low - (1.25 * self.atr(14))
            self.enter_long(size_pct=2.0, stop_loss=stop_price, smart_chase=True)
            self.set_split_tp(tp1_rr=1.5, tp2_rr=2.5, move_sl_be_on_tp1=True)`,
    },
    {
        id: 'rsi',
        label: 'RSI Mean Reversion',
        prompt: 'Buy BTC when RSI(14) crosses below 30 inside lower Bollinger Band and exit near RSI 65.',
        metrics: { winRate: '61.5%', profitFactor: '1.94', maxDrawdown: '-7.8%' },
        code: `class RsiBollingerReversion(CosmoStrategy):
    symbol = "BTC/USDT"
    timeframe = "1h"

    def on_bar(self, bar):
        rsi = self.rsi(bar.close, period=14)
        upper, mid, lower = self.bollinger(bar.close, period=20, std=2.0)
        if rsi < 30 and bar.close <= lower and not self.position:
            self.enter_long(size_pct=1.5, smart_chase=True)
        elif self.position and (rsi > 65 or bar.close >= upper):
            self.close_position()`,
    },
    {
        id: 'ema_vol',
        label: 'EMA + Volume Breakout',
        prompt: 'Long ETH/USDT when EMA(21) crosses above EMA(55) with 1.8x average volume confirmation.',
        metrics: { winRate: '57.8%', profitFactor: '2.06', maxDrawdown: '-8.2%' },
        code: `class EmaVolumeBreakout(CosmoStrategy):
    symbol = "ETH/USDT"
    timeframe = "4h"

    def on_bar(self, bar):
        fast = self.ema(bar.close, 21)
        slow = self.ema(bar.close, 55)
        vol_spike = bar.volume > (1.8 * self.sma(self.volume_series, 20))
        if self.crossed_above(fast, slow) and vol_spike:
            self.enter_long(size_pct=2.0, trailing_stop_pct=1.8, smart_chase=True)
        elif self.crossed_below(fast, slow):
            self.close_position()`,
    },
    {
        id: 'bb_squeeze',
        label: 'Bollinger Volatility Squeeze',
        prompt: 'Trade SOL/USDT breakout after Bollinger Band width compresses below 20-day low with MACD alignment.',
        metrics: { winRate: '59.1%', profitFactor: '2.31', maxDrawdown: '-9.1%' },
        code: `class BollingerSqueezeBreakout(CosmoStrategy):
    symbol = "SOL/USDT"
    timeframe = "1h"

    def on_bar(self, bar):
        upper, mid, lower = self.bollinger(bar.close, 20, 2.0)
        in_squeeze = (upper - lower) / mid < self.percentile_band_width(20, 15)
        macd_hist = self.macd(bar.close).hist
        if in_squeeze and bar.close > upper and macd_hist > 0:
            self.enter_long(size_pct=1.5, stop_loss=mid, smart_chase=True)`,
    },
];

const synthesizeStrategyFromPrompt = (rawPrompt: string): StrategyPreset => {
    const p = rawPrompt.toLowerCase();
    if (p.includes('wall') || p.includes('sweep') || p.includes('liquidity') || p.includes('heatmap')) {
        return STRATEGY_PRESETS[0];
    }
    if (p.includes('squeeze') || p.includes('macd')) {
        return STRATEGY_PRESETS[3];
    }
    if (p.includes('ema') || p.includes('cross') || p.includes('volume') || p.includes('breakout')) {
        return STRATEGY_PRESETS[2];
    }

    const pairMatch = rawPrompt.toUpperCase().match(/\b(BTC|ETH|SOL|BNB|XRP|DOGE|AVAX|ARB)\b/);
    const pair = pairMatch ? `${pairMatch[1]}/USDT` : 'BTC/USDT';
    const tfMatch = rawPrompt.match(/\b(1m|5m|15m|30m|1h|4h|1d)\b/i);
    const timeframe = tfMatch ? tfMatch[1].toLowerCase() : '1h';
    const rsiThresholdMatch = rawPrompt.match(/(?:below|under|<)\s*(\d{2})/i);
    const rsiExitMatch = rawPrompt.match(/(?:above|over|>)\s*(\d{2})/i);
    const rsiLow = rsiThresholdMatch ? rsiThresholdMatch[1] : '30';
    const rsiHigh = rsiExitMatch ? rsiExitMatch[1] : '70';

    return {
        id: 'custom',
        label: 'Synthesized Custom Rule',
        prompt: rawPrompt,
        metrics: { winRate: '60.8%', profitFactor: '1.97', maxDrawdown: '-7.5%' },
        code: `class CustomSynthesizedStrategy(CosmoStrategy):
    symbol = "${pair}"
    timeframe = "${timeframe}"
    use_smart_chase_sl = True

    def on_bar(self, bar):
        # Compiled from natural-language rule
        rsi = self.rsi(bar.close, period=14)
        ema_trend = self.ema(bar.close, period=50)

        if rsi < ${rsiLow} and bar.close >= ema_trend * 0.985 and not self.position:
            self.enter_long(size_pct=1.5, smart_chase=True)
            self.set_split_tp(tp1_rr=1.5, tp2_rr=2.5, move_sl_be_on_tp1=True)
        elif self.position and rsi > ${rsiHigh}:
            self.close_position()`,
    };
};

const AIStrategyGenerator: React.FC<{ onSignUp: () => void }> = ({ onSignUp }) => {
    const { showToast } = useToast();
    const ref = useScrollAnimation(0.15);
    const [prompt, setPrompt] = useState(STRATEGY_PRESETS[0].prompt);
    const [activeResult, setActiveResult] = useState<StrategyPreset>(STRATEGY_PRESETS[0]);
    const [isLoading, setIsLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const thermalGuard = isThermalGuardActive();

    const highlightSyntax = (code: string) => {
        const pythonKeywords = ['def', 'return', 'import', 'from', 'class', 'if', 'else', 'elif', 'for', 'while', 'in', 'and', 'or', 'not', 'is', 'None', 'True', 'False'];
        return code
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/(#.*$)/gm, '<span class="token-comment">$1</span>')
            .replace(/('.*?'|".*?")/g, '<span class="token-string">$1</span>')
            .replace(new RegExp(`\\b(${pythonKeywords.join('|')})\\b`, 'g'), '<span class="token-keyword">$1</span>')
            .replace(/\b(\d+\.?\d*)\b/g, '<span class="token-number">$1</span>')
            .replace(/([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="token-function">$1</span>');
    };

    const runSynthesis = (inputPrompt: string) => {
        if (!inputPrompt.trim()) {
            showToast('Please enter a strategy rule or select a preset.', 'error');
            return;
        }
        setIsLoading(true);
        window.setTimeout(() => {
            setActiveResult(synthesizeStrategyFromPrompt(inputPrompt));
            setIsLoading(false);
        }, 280);
    };

    const handlePresetClick = (preset: StrategyPreset) => {
        setPrompt(preset.prompt);
        setIsLoading(true);
        window.setTimeout(() => {
            setActiveResult(preset);
            setIsLoading(false);
        }, 200);
    };

    const handleCopy = () => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(activeResult.code).catch(() => {});
        }
        setCopied(true);
        showToast('Strategy Python blueprint copied.', 'success');
        window.setTimeout(() => setCopied(false), 1800);
    };

    return (
        <div id="ai-strategy-demo" ref={ref} className="py-24 bg-transparent fade-in-up relative overflow-hidden scroll-mt-24">
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="grid lg:grid-cols-2 gap-12 items-center">
                    {/* Terminal Preview */}
                    <div className="order-2 lg:order-1">
                        <CyberCard glowColor="cyan" className="overflow-hidden">
                            <div className="bg-[#0D1117] px-4 py-3 flex items-center gap-3 border-b border-white/10">
                                <div className="flex gap-1.5">
                                    <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                                </div>
                                <div className="flex items-center gap-2 ml-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                                    <span className="text-xs text-slate-300 font-mono">ai_foundry_blueprint.py</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopy}
                                    className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-slate-300 hover:text-white hover:border-cyan-400/40 transition-colors"
                                >
                                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>

                            <div className="p-5 sm:p-6 min-h-[290px] max-h-[340px] overflow-y-auto font-mono text-xs sm:text-sm bg-[#0D1117]">
                                {isLoading ? (
                                    <div className="flex flex-col items-center justify-center h-[240px] gap-3">
                                        <div className="relative w-10 h-10">
                                            <div className="absolute inset-0 border-2 border-cyan-500/25 rounded-full" />
                                            <div className="absolute inset-0 border-2 border-transparent border-t-cyan-400 rounded-full animate-spin" />
                                        </div>
                                        <p className="text-cyan-400 text-xs font-mono">Compiling Strategy Blueprint...</p>
                                    </div>
                                ) : (
                                    <pre className="whitespace-pre-wrap leading-relaxed">
                                        <code dangerouslySetInnerHTML={{ __html: highlightSyntax(activeResult.code) }} />
                                    </pre>
                                )}
                            </div>

                            <div className="bg-[#080E1A] px-5 py-3.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
                                <div className="flex items-center gap-4 text-xs font-mono">
                                    <span className="text-slate-400">Sim Win: <strong className="text-emerald-400">{activeResult.metrics.winRate}</strong></span>
                                    <span className="text-slate-400">PF: <strong className="text-cyan-400">{activeResult.metrics.profitFactor}</strong></span>
                                    <span className="text-slate-400">DD: <strong className="text-rose-400">{activeResult.metrics.maxDrawdown}</strong></span>
                                </div>
                                <button
                                    type="button"
                                    onClick={onSignUp}
                                    className="text-xs font-bold text-cyan-300 hover:text-white inline-flex items-center gap-1 transition-colors"
                                >
                                    Backtest in Workspace <ArrowRight className="w-3.5 h-3.5" />
                                </button>
                            </div>
                        </CyberCard>
                    </div>

                    {/* Interactive Prompt Form */}
                    <div className="order-1 lg:order-2">
                        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-bold uppercase tracking-widest mb-5">
                            <Sparkles className="w-3.5 h-3.5" />
                            Interactive AI Foundry Preview
                        </div>
                        <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-4 leading-tight">
                            Describe Your Rules.{' '}
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-400">Get Clean Code.</span>
                        </h2>
                        <p className="text-base sm:text-lg text-slate-400 mb-6 leading-relaxed">
                            Test a preset or write your own entry, indicator, and Smart Chase stop-loss logic below — preview the compiled blueprint before signing up.
                        </p>

                        {/* Preset Chips */}
                        <div className="flex flex-wrap gap-2 mb-4">
                            {STRATEGY_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => handlePresetClick(preset)}
                                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                        activeResult.id === preset.id
                                            ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white hover:border-white/25'
                                    }`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        <div className={`relative rounded-2xl border border-white/15 bg-white/[0.04] ${thermalGuard ? '' : 'backdrop-blur'} focus-within:border-cyan-500/50 transition-all`}>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                rows={3}
                                className="w-full bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 resize-none p-4 sm:p-5 text-sm leading-relaxed outline-none"
                                placeholder="E.g., Long BTC on 15m when RSI drops below 30 and reclaim VWAP with Smart Chase SL..."
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-4">
                                <span className="text-xs text-slate-400">Supports: WallHunter, RSI, EMA, MACD, Bollinger, VWAP</span>
                                <button
                                    type="button"
                                    onClick={() => runSynthesis(prompt)}
                                    disabled={isLoading}
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-sm font-semibold shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all disabled:opacity-50 hover:scale-[1.02]"
                                >
                                    <Sparkles className="w-4 h-4" />
                                    {isLoading ? 'Compiling...' : 'Generate Blueprint'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================
// Partners Section
// ============================
const PartnersSection: React.FC = () => {
    const thermalGuard = isThermalGuardActive();
    const logos = [
        { name: 'Binance', component: <BinanceLogo className="h-7 w-auto" /> },
        { name: 'Coinbase', component: <CoinbaseLogo className="h-6 w-auto" /> },
        { name: 'Kraken', component: <KrakenLogo className="h-6 w-auto" /> },
        { name: 'Bybit', component: <span className="text-sm font-extrabold tracking-widest uppercase text-slate-200 font-mono">BYBIT</span> },
        { name: 'OKX', component: <span className="text-sm font-extrabold tracking-widest uppercase text-slate-200 font-mono">OKX</span> },
        { name: 'Bitfinex', component: <BitfinexLogo className="h-6 w-auto" /> },
        { name: 'Alpaca', component: <AlpacaLogo className="h-6 w-auto" /> },
        { name: 'Interactive Brokers', component: <InteractiveBrokersLogo className="h-6 w-auto" /> },
        { name: 'Charles Schwab', component: <CharlesSchwabLogo className="h-7 w-auto" /> },
    ];

    const displayLogos = thermalGuard ? logos : [...logos, ...logos, ...logos];

    return (
        <div className="py-12 bg-transparent border-y border-white/5">
            <div className="text-center mb-7">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                    Built for Leading Crypto &amp; Multi-Asset Venues
                </p>
            </div>
            <div
                className={`relative w-full ${thermalGuard ? 'overflow-x-auto no-scrollbar px-4' : 'overflow-hidden'}`}
                style={thermalGuard ? undefined : {
                    WebkitMaskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
                    maskImage: 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
                }}
            >
                <div className={`flex whitespace-nowrap items-center ${thermalGuard ? 'justify-start gap-2' : 'animate-marquee-slow'}`}>
                    {displayLogos.map((logo, index) => (
                        <div key={`${logo.name}-${index}`} className={`${thermalGuard ? 'mx-5' : 'mx-10'} flex flex-shrink-0 items-center justify-center opacity-60 hover:opacity-95 transition-opacity duration-300`}>
                            {logo.component}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// ============================
// CTA Section
// ============================
const CustomServicesSection: React.FC<{
    onOpenBriefing: (topic?: BriefingTopic) => void;
    onNavigate: (view: PublicView) => void;
}> = ({ onOpenBriefing, onNavigate }) => {
    const ref = useScrollAnimation();
    return (
        <div ref={ref} className="py-24 relative overflow-hidden fade-in-up bg-transparent">
            <div
                className="absolute inset-0 opacity-10 pointer-events-none"
                style={{
                    backgroundImage: 'linear-gradient(rgba(6,182,212,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.3) 1px, transparent 1px)',
                    backgroundSize: '60px 60px',
                }}
            />

            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
                <div className="max-w-4xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-bold uppercase tracking-widest mb-7">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        CosmoQuantAI Engineering Desk
                    </div>
                    <h2 className="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
                        Need Dedicated{' '}
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">
                            Quant Infrastructure?
                        </span>
                    </h2>
                    <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                        Partner with the CosmoQuantAI engineering team for isolated cloud execution clusters, bespoke strategy adapters, and multi-venue webhook pipelines.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <button
                            type="button"
                            onClick={() => onOpenBriefing('custom_algo')}
                            className="inline-flex items-center justify-center gap-2 px-9 py-4 text-base sm:text-lg font-semibold rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_30px_rgba(6,182,212,0.35)] hover:shadow-[0_0_50px_rgba(6,182,212,0.55)] transition-all hover:scale-[1.03]"
                        >
                            <Calendar className="w-5 h-5" />
                            Book Consultation
                        </button>
                        <button
                            type="button"
                            onClick={() => onNavigate('Portfolio')}
                            className="inline-flex items-center justify-center gap-2 px-9 py-4 text-base sm:text-lg font-semibold rounded-2xl border border-white/15 bg-[#070F20]/60 text-white hover:border-cyan-500/45 hover:bg-white/5 transition-all hover:scale-[1.03]"
                        >
                            View Case Studies
                            <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Service guarantees */}
                    <div className="mt-14 grid grid-cols-3 gap-6 max-w-lg mx-auto">
                        {[
                            { value: 'NDA', label: 'IP Confidentiality' },
                            { value: 'Trade-Only', label: 'Key Isolation' },
                            { value: '< 24h', label: 'Desk Response' },
                        ].map((item) => (
                            <div key={item.label} className="text-center">
                                <div className="text-xl sm:text-2xl font-extrabold text-white">{item.value}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{item.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============================
// HOME PAGE
// ============================
const HomePage: React.FC<{
    onLogin: () => void;
    onSignUp: () => void;
    onNavigate: (view: PublicView) => void;
    onOpenBriefing: (topic?: BriefingTopic) => void;
    focusedSymbol?: string;
    focusSectionReq?: { id: string; nonce: number } | null;
}> = ({ onSignUp, onNavigate, onOpenBriefing, focusedSymbol, focusSectionReq }) => {
    const { theme } = useTheme();
    const [activeSymbol, setActiveSymbol] = useState(focusedSymbol || 'BTCUSDT');
    const deviceProfile = useDeviceProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        if (focusedSymbol) setActiveSymbol(focusedSymbol);
    }, [focusedSymbol]);

    useEffect(() => {
        if (!focusSectionReq?.id) return;
        const timer = window.setTimeout(() => {
            const el = document.getElementById(focusSectionReq.id);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
        return () => window.clearTimeout(timer);
    }, [focusSectionReq]);

    useEffect(() => {
        const createWidget = () => {
            const container = document.getElementById('homepage_chart');
            if (!container || !window.TradingView) return;
            container.innerHTML = '';
            new window.TradingView.widget({
                symbol: `BINANCE:${activeSymbol}`,
                interval: '60',
                autosize: true,
                container_id: 'homepage_chart',
                theme: 'Dark',
                style: '1',
                locale: 'en',
                toolbar_bg: '#0D1117',
                enable_publishing: false,
                allow_symbol_change: true,
                hide_top_toolbar: false,
                hide_legend: false,
                hide_side_toolbar: thermalGuard,
                withdateranges: true,
                hotlist: !thermalGuard,
                calendar: !thermalGuard,
                save_image: false,
                studies: ['MASimple@tv-basicstudies', 'RSI@tv-basicstudies'],
            });
        };

        if (!thermalGuard) {
            const timer = setTimeout(createWidget, 450);
            return () => clearTimeout(timer);
        }

        const container = document.getElementById('homepage_chart');
        if (!container || typeof IntersectionObserver === 'undefined') {
            const timer = setTimeout(createWidget, 450);
            return () => clearTimeout(timer);
        }

        let created = false;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !created) {
                    created = true;
                    createWidget();
                    observer.disconnect();
                }
            },
            { rootMargin: '250px' }
        );
        observer.observe(container);
        return () => observer.disconnect();
    }, [theme, activeSymbol, thermalGuard]);

    const scrollToElement = (id: string) => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const handleTickerClick = (symbol: string) => {
        setActiveSymbol(`${symbol.toUpperCase()}USDT`);
        scrollToElement('homepage_chart_card');
    };

    return (
        <div className="relative overflow-hidden bg-transparent">
            {/* ========== HERO ========== */}
            <div className={`relative ${isPhoneMobileUI ? 'flex flex-col' : 'min-h-screen flex flex-col justify-between'} overflow-hidden bg-transparent`}>
                <div className={`container mx-auto px-4 relative z-10 flex flex-col items-center text-center ${isPhoneMobileUI ? 'pt-2 pb-4' : 'pt-20 pb-14'}`}>
                    {/* SaaS Positioning Pill */}
                    <div className={`inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 ${isPhoneMobileUI ? 'text-[10px] mb-3.5' : 'text-xs mb-8'} font-bold uppercase tracking-widest animate-fade-in-down`}>
                        <span className="relative flex h-1.5 w-1.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400"></span>
                        </span>
                        WallHunter • OrderFlow Heatmap • AI Automation
                    </div>

                    {/* Headline */}
                    <h1 className={`${isPhoneMobileUI ? 'text-4xl mb-3.5' : 'text-5xl md:text-7xl lg:text-8xl mb-7'} font-extrabold tracking-tighter text-white animate-fade-in-down leading-none`} style={{ animationDelay: '0.1s' }}>
                        Stop Guessing.{' '}
                        <br className="hidden md:block" />
                        <span className="relative">
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">
                                Start Quantifying.
                            </span>
                            <span className="absolute -bottom-2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
                        </span>
                    </h1>

                    {/* Subtitle */}
                    <p className={`max-w-2xl ${isPhoneMobileUI ? 'text-sm sm:text-base mb-5 px-1' : 'text-xl mb-10'} text-slate-300/90 leading-relaxed animate-fade-in-down`} style={{ animationDelay: '0.2s' }}>
                        The unified algorithmic trading SaaS. Scan order-book liquidity walls, synthesize strategies with AI Foundry, backtest, and execute 24/7 with Smart Chase risk protection.
                    </p>

                    {/* Wired CTA Buttons */}
                    <div className={`flex flex-col sm:flex-row gap-3 sm:gap-4 animate-fade-in-down ${isPhoneMobileUI ? 'mb-4' : 'mb-6'} w-full sm:w-auto items-center justify-center`} style={{ animationDelay: '0.3s' }}>
                        <button
                            type="button"
                            onClick={onSignUp}
                            className={`relative overflow-hidden whitespace-nowrap ${isPhoneMobileUI ? 'w-full max-w-xs sm:w-auto px-6 py-3 text-sm sm:text-base justify-center' : 'px-9 py-4 text-lg'} font-semibold rounded-2xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_30px_rgba(6,182,212,0.4)] hover:shadow-[0_0_50px_rgba(6,182,212,0.6)] transition-all hover:scale-105 flex items-center gap-2`}
                        >
                            <span>Start Free Workspace</span>
                            <ArrowRight className="w-5 h-5 shrink-0" />
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollToElement('platform-workflow')}
                            className={`whitespace-nowrap ${isPhoneMobileUI ? 'w-full max-w-xs sm:w-auto px-6 py-3 text-sm sm:text-base justify-center' : 'px-9 py-4 text-lg'} font-semibold rounded-2xl border border-white/15 bg-[#070F20]/60 text-white hover:border-cyan-500/45 hover:bg-white/5 transition-all hover:scale-105 flex items-center gap-2`}
                        >
                            <PlayCircle className="w-5 h-5 text-cyan-400 shrink-0" />
                            <span>See How It Works</span>
                        </button>
                    </div>

                    {/* Clean SaaS Trust Strip */}
                    <div className="flex flex-wrap items-center justify-center gap-3 text-xs sm:text-sm text-slate-400 animate-fade-in-down" style={{ animationDelay: '0.4s' }}>
                        <div className="flex -space-x-2">
                            {['WH', 'OF', 'SC', 'AI'].map((badge) => (
                                <div key={badge} className="w-7 h-7 rounded-full bg-[#0D162B] border border-cyan-500/35 flex items-center justify-center text-[10px] font-mono font-bold text-cyan-300">
                                    {badge}
                                </div>
                            ))}
                        </div>
                        <span>Paper Trading included • No credit card required • Trade-only API security</span>
                    </div>

                    {/* Chart Terminal Window */}
                    <div id="homepage_chart_card" className={`${isPhoneMobileUI ? 'mt-5' : 'mt-14'} w-full max-w-6xl relative animate-fade-in-slide-up scroll-mt-24`}>
                        {!thermalGuard && (
                            <div className="absolute -inset-4 bg-cyan-500/5 rounded-3xl blur-2xl pointer-events-none" />
                        )}
                        <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-[0_0_60px_rgba(6,182,212,0.12)] bg-[#0D1117]">
                            <div className="h-0.5 bg-gradient-to-r from-cyan-500 via-violet-500 to-pink-500" />
                            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#0D1117] border-b border-white/10">
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="flex gap-1.5 shrink-0">
                                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500/75" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/75" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/75" />
                                    </div>
                                    <span className="ml-2 text-xs text-slate-400 font-mono truncate">
                                        CosmoQuant Terminal — BINANCE:{activeSymbol}
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="hidden sm:flex items-center gap-1">
                                        {['BTCUSDT', 'ETHUSDT', 'SOLUSDT'].map((sym) => (
                                            <button
                                                key={sym}
                                                type="button"
                                                onClick={() => setActiveSymbol(sym)}
                                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                                                    activeSymbol === sym
                                                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/35'
                                                        : 'text-slate-400 hover:text-white'
                                                }`}
                                            >
                                                {sym.replace('USDT', '')}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <span className="relative flex h-1.5 w-1.5">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                                        </span>
                                        <span className="text-[10px] text-emerald-400 font-mono">LIVE</span>
                                    </div>
                                </div>
                            </div>
                            <div id="homepage_chart" className={`w-full ${isPhoneMobileUI ? 'h-[320px]' : 'h-[480px] md:h-[540px]'}`} />
                        </div>
                    </div>
                </div>

                {/* Bottom Tickers */}
                <div className={`w-full z-20 flex flex-col ${isPhoneMobileUI ? 'mt-2' : 'mt-4'}`}>
                    <div className={`border-t border-white/10 bg-[#020610]/75 ${thermalGuard ? '' : 'backdrop-blur-md'}`}>
                        <MarketTicker variant="overlay" onCoinClick={handleTickerClick} />
                    </div>
                    <LandingPageNewsTicker onSignUp={onSignUp} />
                </div>
            </div>

            <PartnersSection />
            <MarketIntelligenceSection onSelectChartPair={handleTickerClick} />
            <BentoGrid
                onNavigate={onNavigate}
                onScrollToDemo={() => scrollToElement('ai-strategy-demo')}
                onSignUp={onSignUp}
            />
            <AIStrategyGenerator onSignUp={onSignUp} />
            <StatsSection />
            <CustomServicesSection onOpenBriefing={onOpenBriefing} onNavigate={onNavigate} />
        </div>
    );
};

export default HomePage;

