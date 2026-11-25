import React from 'react';
import {
    AIFoundryIcon,
    BacktesterIcon,
    BotLabIcon,
    TradingIcon,
    PortfolioIcon,
    AlphaEngineIcon,
} from '@/constants';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import type { BriefingTopic } from './PublicBriefingModal';
import { ArrowRight, Radar, Layers, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface ServicesPageProps {
    onSignUp?: () => void;
    onOpenBriefing?: (topic?: BriefingTopic) => void;
}

const ServiceCard: React.FC<{
    icon: React.ReactNode;
    badge: string;
    title: string;
    description: string;
    delay: number;
    thermalGuard: boolean;
}> = ({ icon, badge, title, description, delay, thermalGuard }) => (
    <div
        className={`group relative p-7 bg-[#070F20]/70 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 shadow-[0_0_20px_rgba(6,182,212,0.05)] rounded-3xl hover:shadow-[0_0_30px_rgba(6,182,212,0.15)] hover:border-cyan-500/30 transition-all duration-500 hover:-translate-y-1.5 overflow-hidden`}
        style={{ animationDelay: `${delay}ms` }}
    >
        {!thermalGuard && (
            <div className="absolute -right-10 -top-10 w-40 h-40 bg-cyan-500/10 rounded-full blur-[50px] group-hover:bg-cyan-500/20 transition-all duration-500 pointer-events-none" />
        )}

        <div className="relative z-10 flex flex-col h-full">
            <div className="flex items-center justify-between gap-3 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center text-cyan-400 group-hover:scale-105 group-hover:border-cyan-500/50 transition-all duration-300">
                    {icon}
                </div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-cyan-300">
                    {badge}
                </span>
            </div>
            <h3 className="text-xl font-bold text-white mb-2.5 group-hover:text-cyan-300 transition-colors">
                {title}
            </h3>
            <p className="text-sm text-slate-400 leading-relaxed font-light">{description}</p>
        </div>
    </div>
);

const ProcessStep: React.FC<{ number: string; title: string; desc: string }> = ({ number, title, desc }) => (
    <div className="relative pl-9 border-l border-white/10 last:border-l-transparent pb-8 last:pb-0 group">
        <div className="absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-slate-600 group-hover:bg-cyan-400 transition-colors" />
        <div className="flex items-center gap-2.5 mb-1.5">
            <span className="text-[11px] font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
                {number}
            </span>
            <h4 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">{title}</h4>
        </div>
        <p className="text-sm text-slate-400 leading-relaxed font-light">{desc}</p>
    </div>
);

const ServicesPage: React.FC<ServicesPageProps> = ({ onSignUp, onOpenBriefing }) => {
    const thermalGuard = isThermalGuardActive();

    const platformFeatures = [
        {
            icon: <Radar className="w-6 h-6" />,
            badge: 'Liquidity Radar',
            title: 'WallHunter Engine',
            description: 'Detect institutional bid/ask liquidity walls, absorption clusters, and stop-sweep setups across major perpetual venues in real time.',
        },
        {
            icon: <Layers className="w-6 h-6" />,
            badge: 'Depth Telemetry',
            title: 'OrderFlow Heatmap',
            description: 'Visualize rested order-book clusters overlaid directly on price action to spot breakout resistance and sweep reversals early.',
        },
        {
            icon: <ShieldCheck className="w-6 h-6" />,
            badge: 'Execution Guard',
            title: 'Smart Chase SL & Brackets',
            description: 'Automate adaptive trailing stop-losses, multi-tranche take profits, and breakeven triggers across Spot and Futures accounts.',
        },
        {
            icon: <AIFoundryIcon />,
            badge: 'NL -> Strategy',
            title: 'AI Strategy Foundry',
            description: 'Convert plain-English trade hypotheses into structured algorithmic rules ready for historical simulation and cloud deployment.',
        },
        {
            icon: <BacktesterIcon />,
            badge: 'Historical Sim',
            title: 'Parallel Backtesting',
            description: 'Stress-test strategies across multi-regime candle feeds with realistic fee, slippage, equity-curve, and drawdown metrics.',
        },
        {
            icon: <BotLabIcon />,
            badge: '24/7 Cloud',
            title: 'Bot Lab & Portfolio',
            description: 'Run Paper or Live bots across Binance, Bybit, OKX, Coinbase, Kraken, and Bitget from one unified execution workspace.',
        },
    ];

    return (
        <div className="relative bg-transparent min-h-screen overflow-hidden selection:bg-cyan-500/30 selection:text-cyan-200">
            {/* Decorative Background Elements */}
            <div className="absolute inset-0 z-0 pointer-events-none">
                <div
                    className="absolute inset-0 opacity-10"
                    style={{
                        backgroundImage: 'linear-gradient(rgba(6,182,212,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.15) 1px, transparent 1px)',
                        backgroundSize: '40px 40px',
                    }}
                />
                {!thermalGuard && (
                    <>
                        <div className="absolute top-0 left-1/4 w-[520px] h-[520px] bg-cyan-500/10 blur-[140px] rounded-full animate-float-medium" />
                        <div className="absolute top-40 right-1/4 w-[440px] h-[440px] bg-violet-600/10 blur-[140px] rounded-full animate-float-slow" />
                    </>
                )}
            </div>

            {/* Hero Section */}
            <div className="relative pt-24 pb-16 text-center px-4 z-10">
                <span className="inline-flex items-center gap-2 py-1 px-3.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-bold tracking-widest uppercase mb-6 border border-cyan-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    CosmoQuantAI Platform Suite
                </span>
                <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-6">
                    Self-Serve SaaS &amp; <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">Custom Engineering</span>
                </h1>
                <p className="text-lg sm:text-xl text-slate-400 font-light max-w-2xl mx-auto leading-relaxed">
                    Launch instantly with our unified algorithmic trading terminal, or partner with the CosmoQuantAI engineering team for bespoke execution infrastructure.
                </p>
            </div>

            <div className="container mx-auto px-4 sm:px-6 lg:px-8 pb-24 relative z-10">
                <div className="grid lg:grid-cols-12 gap-10 xl:gap-14">
                    {/* Left Column: Self-Service SaaS Platform */}
                    <div className="lg:col-span-7 flex flex-col">
                        <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h2 className="text-3xl font-extrabold text-white tracking-tight">Core SaaS Modules</h2>
                                <p className="text-xs font-mono text-cyan-400/80 uppercase tracking-widest mt-1.5 flex items-center gap-2">
                                    <PortfolioIcon />
                                    <span>Included Across Free &amp; Pro Workspaces</span>
                                </p>
                            </div>
                            <div className="self-start sm:self-auto px-3.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-bold border border-emerald-500/30 flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                INSTANT ACCESS
                            </div>
                        </div>

                        <div className="grid sm:grid-cols-2 gap-5">
                            {platformFeatures.map((feature, index) => (
                                <ServiceCard
                                    key={feature.title}
                                    {...feature}
                                    delay={index * 80}
                                    thermalGuard={thermalGuard}
                                />
                            ))}
                        </div>

                        <div className={`mt-8 p-7 rounded-3xl bg-[#070F20]/85 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-cyan-500/30 shadow-[0_0_40px_rgba(6,182,212,0.12)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 relative overflow-hidden group`}>
                            <div className="relative z-10">
                                <h3 className="text-2xl font-bold text-white mb-1.5">Start Trading Systematically</h3>
                                <p className="text-slate-400 text-sm font-light">Free Paper Workspace included. Connect trade-only API keys anytime.</p>
                            </div>
                            <button
                                type="button"
                                onClick={onSignUp}
                                className="relative z-10 inline-flex items-center gap-2 whitespace-nowrap px-7 py-3.5 rounded-xl font-bold bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all hover:scale-[1.02]"
                            >
                                Launch Terminal
                                <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Right Column: Institutional & Custom Quant Solutions */}
                    <div className="lg:col-span-5">
                        <div className="sticky top-28">
                            <div className={`relative bg-[#050A15]/85 ${thermalGuard ? '' : 'backdrop-blur-2xl'} rounded-[2.25rem] border border-white/10 p-8 sm:p-10 shadow-[0_0_50px_rgba(0,0,0,0.45)] overflow-hidden flex flex-col group`}>
                                <div className="relative z-10 mb-9">
                                    <div className="inline-flex items-center gap-2 text-[11px] font-mono text-violet-300 uppercase tracking-widest mb-3">
                                        <AlphaEngineIcon />
                                        <span>Institutional &amp; Custom Solutions</span>
                                    </div>
                                    <h2 className="text-3xl font-extrabold text-white tracking-tight mb-3">Custom Quant Engineering</h2>
                                    <p className="text-slate-400 text-sm leading-relaxed font-light">
                                        For proprietary desks, funds, and high-volume traders requiring dedicated low-latency clusters, custom signal adapters, or bespoke execution engines.
                                    </p>
                                </div>

                                {/* Structured Delivery Lifecycle */}
                                <div className="relative z-10 flex-grow mb-9 ml-1">
                                    <ProcessStep
                                        number="01"
                                        title="Strategy & Architecture Scoping"
                                        desc="Our quant engineers audit your alpha thesis, venue latency constraints, and portfolio risk rules."
                                    />
                                    <ProcessStep
                                        number="02"
                                        title="Engine & Connector Development"
                                        desc="Dedicated strategy modules, custom exchange adapters, and WebSocket risk guards built in Python or Rust."
                                    />
                                    <ProcessStep
                                        number="03"
                                        title="Walk-Forward Stress Testing"
                                        desc="Multi-regime historical simulation calibrating slippage, funding drag, and drawdown ceilings."
                                    />
                                    <ProcessStep
                                        number="04"
                                        title="Managed Cluster Deployment"
                                        desc="Zero-downtime deployment into isolated CosmoQuantAI cloud nodes with 24/7 telemetry alerts."
                                    />
                                </div>

                                <div className="relative z-10 space-y-3 pt-4 border-t border-white/10">
                                    <div className="flex flex-wrap gap-3 text-xs text-slate-400 mb-2">
                                        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> NDA Protected</span>
                                        <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Trade-Only Key Isolation</span>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => onOpenBriefing?.('custom_algo')}
                                        className="w-full py-4 rounded-xl font-bold bg-[#0D1117] border border-violet-500/35 text-white hover:bg-violet-500/15 hover:border-violet-400 transition-all shadow-lg flex items-center justify-center gap-2"
                                    >
                                        <TradingIcon />
                                        Schedule Engineering Briefing
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ServicesPage;
