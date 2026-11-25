import React, { useEffect, useState } from 'react';
import { billingService, type PlatformNoCodeConfig } from '@/services/adminService';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import type { BriefingTopic } from './PublicBriefingModal';
import { Check, ChevronDown } from 'lucide-react';

type BillingCycle = 'monthly' | 'yearly';

interface PricingTier {
    name: string;
    monthlyPrice: string;
    yearlyPrice: string;
    description: string;
    features: string[];
    cta: string;
    isFeatured: boolean;
    highlightColor: string;
}

const PRICING_TIERS: PricingTier[] = [
    {
        name: 'Starter',
        monthlyPrice: '$0',
        yearlyPrice: '$0',
        description: 'Explore live telemetry, backtesting, and automated Paper bots risk-free.',
        features: [
            'Paper Trading & 1 Live Exchange',
            'WallHunter Liquidity Preview',
            '10 Historical Backtests / mo',
            '1 Active Automated Bot',
            'Basic Smart Chase SL Brackets',
            'Community Documentation',
        ],
        cta: 'Start Free Workspace',
        isFeatured: false,
        highlightColor: 'border-white/10',
    },
    {
        name: 'Pro Trader',
        monthlyPrice: '$49',
        yearlyPrice: '$39',
        description: 'Full suite for active algorithmic and order-flow traders.',
        features: [
            'Up to 5 Connected Exchanges',
            'Full WallHunter & OrderFlow Heatmap',
            'AI Strategy Foundry (Unlimited)',
            'Smart Chase SL + Multi-Target TP',
            '10 Concurrent Live / Paper Bots',
            'Priority Desk Support',
        ],
        cta: 'Upgrade to Pro',
        isFeatured: true,
        highlightColor: 'border-cyan-500/80 shadow-[0_0_30px_rgba(6,182,212,0.2)]',
    },
    {
        name: 'Enterprise',
        monthlyPrice: 'Custom',
        yearlyPrice: 'Custom',
        description: 'Dedicated clusters, team roles, and custom adapters for desks.',
        features: [
            'Unlimited Exchange Accounts',
            'Isolated Dedicated Execution Node',
            'Custom Signal & Webhook Pipelines',
            'Co-Engineered Algo Modules',
            'Custom SLA & Onboarding',
            'Dedicated Solutions Engineer',
        ],
        cta: 'Request Enterprise Briefing',
        isFeatured: false,
        highlightColor: 'border-violet-500/50 shadow-[0_0_20px_rgba(139,92,246,0.1)]',
    },
];

const COMPARISON_FEATURES = [
    { name: 'WallHunter & OrderFlow Heatmap', free: 'Preview', pro: 'Real-Time Full Depth', ent: 'Multi-Venue Dedicated' },
    { name: 'Smart Chase SL & Split TP', free: 'Basic Brackets', pro: 'Full Automation', ent: 'Custom Risk Policies' },
    { name: 'AI Strategy Foundry', free: '3 Prompts / mo', pro: 'Unlimited', ent: 'Unlimited + Private Models' },
    { name: 'Backtesting Engine', free: 'Standard (1h)', pro: 'Parallel (1m)', ent: 'Dedicated Cluster (Tick)' },
    { name: 'Connected Exchanges', free: '1 Venue', pro: 'Up to 5 Venues', ent: 'Unlimited + Custom API' },
    { name: 'Support', free: 'Docs & Guides', pro: 'Priority (24h)', ent: 'Dedicated Engineer' },
];

const FAQS = [
    { q: 'Can I switch or cancel plans later?', a: 'Yes. You can upgrade, downgrade, or cancel anytime directly from your billing settings without lock-in.' },
    { q: 'How are my exchange API keys protected?', a: 'Keys are encrypted at rest with AES-256 and used strictly with trade-only permissions. CosmoQuantAI never has withdrawal access or custody of funds.' },
    { q: 'Which exchanges and markets are supported?', a: 'CosmoQuantAI supports major crypto venues including Binance, Bybit, OKX, Coinbase, Kraken, and Bitget, alongside full Paper Trading simulation.' },
    { q: 'What payment methods are supported for Pro?', a: 'Pro plans support international cards, crypto payments (Binance Pay / USDT), and local BDT wallets (bKash / Nagad).' },
];

const PricingPage: React.FC<{
    onSelectPlan?: () => void;
    onOpenBriefing?: (topic?: BriefingTopic) => void;
}> = ({ onSelectPlan, onOpenBriefing }) => {
    const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
    const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
    const [publicCfg, setPublicCfg] = useState<PlatformNoCodeConfig | null>(null);
    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        billingService.getPublicConfig().then(setPublicCfg).catch(() => {});
    }, []);

    const proMonthlyUsd = publicCfg?.pro_monthly_usd || 49;
    const proYearlyUsd = publicCfg?.pro_yearly_usd || 468;
    const proYearlyMonthlyEq = Math.round(proYearlyUsd / 12);
    const savePct = Math.max(0, Math.round((1 - proYearlyUsd / (proMonthlyUsd * 12)) * 100));

    const dynamicTiers = PRICING_TIERS.map((t) => {
        if (t.name !== 'Pro Trader') return t;
        return {
            ...t,
            monthlyPrice: `$${proMonthlyUsd}`,
            yearlyPrice: `$${proYearlyMonthlyEq}`,
        };
    });

    return (
        <div className="bg-transparent min-h-screen font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
            {/* Hero Section */}
            <div className="relative pt-24 pb-16 overflow-hidden">
                <div className="absolute inset-0 z-0 pointer-events-none">
                    <div
                        className="absolute inset-0 opacity-10"
                        style={{
                            backgroundImage: 'radial-gradient(circle at 2px 2px, rgba(6,182,212,0.3) 1px, transparent 0)',
                            backgroundSize: '32px 32px',
                        }}
                    />
                    {!thermalGuard && (
                        <>
                            <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-cyan-500/10 blur-[140px] rounded-full animate-float-medium" />
                            <div className="absolute top-20 right-1/4 w-[440px] h-[440px] bg-violet-600/10 blur-[140px] rounded-full animate-float-slow" />
                        </>
                    )}
                </div>

                <div className="container mx-auto px-4 text-center relative z-10">
                    <span className="inline-flex items-center gap-2 py-1 px-3.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-bold tracking-widest uppercase mb-6 border border-cyan-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        Transparent SaaS Pricing
                    </span>
                    <h1 className="text-4xl md:text-7xl font-extrabold text-white tracking-tight mb-5">
                        Unlock Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">Trading Edge</span>
                    </h1>
                    <p className="text-lg text-slate-400 font-light max-w-2xl mx-auto mb-10">
                        Start free in Paper Trading mode, or unlock full WallHunter, OrderFlow Heatmap, and unlimited AI Foundry execution.
                    </p>

                    {/* Billing Toggle */}
                    <div className="flex justify-center items-center gap-4 mb-10">
                        <span className={`text-sm font-bold uppercase tracking-wider ${billingCycle === 'monthly' ? 'text-white' : 'text-slate-500'}`}>Monthly</span>
                        <button
                            type="button"
                            aria-label="Toggle billing cycle"
                            onClick={() => setBillingCycle((prev) => (prev === 'monthly' ? 'yearly' : 'monthly'))}
                            className="relative w-16 h-8 bg-[#0D1117] border border-white/15 rounded-full p-1 transition-all focus:outline-none"
                        >
                            <div className={`w-6 h-6 bg-gradient-to-r from-cyan-400 to-cyan-500 rounded-full shadow-md transform transition-transform duration-300 ${billingCycle === 'yearly' ? 'translate-x-8 from-violet-400 to-violet-500' : ''}`} />
                        </button>
                        <span className={`text-sm font-bold uppercase tracking-wider ${billingCycle === 'yearly' ? 'text-white' : 'text-slate-500'}`}>
                            Yearly
                            {savePct > 0 && (
                                <span className="ml-2 inline-block bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide">
                                    Save {savePct}%
                                </span>
                            )}
                        </span>
                    </div>
                </div>
            </div>

            {/* Pricing Cards */}
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 pb-20 relative z-10">
                <div className="grid lg:grid-cols-3 gap-7 max-w-7xl mx-auto items-stretch">
                    {dynamicTiers.map((tier) => (
                        <div
                            key={tier.name}
                            className={`relative bg-[#070F20]/70 ${thermalGuard ? '' : 'backdrop-blur-2xl'} border rounded-[2rem] p-8 md:p-9 flex flex-col transition-all duration-500 hover:-translate-y-1.5 group ${tier.highlightColor} ${tier.isFeatured ? 'z-10 lg:scale-[1.03]' : ''}`}
                        >
                            {tier.isFeatured && (
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#07162B] border border-cyan-400 text-cyan-300 text-[10px] font-bold px-4 py-1.5 rounded-full uppercase tracking-widest shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                                    <span className="inline-block w-1.5 h-1.5 bg-cyan-400 rounded-full mr-2 animate-pulse" />
                                    Most Popular
                                </div>
                            )}

                            <div className="mb-7">
                                <h3 className="text-2xl font-bold text-white mb-2">{tier.name}</h3>
                                <p className="text-sm text-slate-400 leading-relaxed font-light min-h-[2.5rem]">{tier.description}</p>
                            </div>

                            <div className="mb-7">
                                <div className="flex items-baseline">
                                    <span className="text-5xl font-extrabold text-white">
                                        {billingCycle === 'monthly' ? tier.monthlyPrice : tier.yearlyPrice}
                                    </span>
                                    {tier.monthlyPrice !== 'Custom' && (
                                        <span className="text-slate-400 ml-2 font-mono text-sm">/ month</span>
                                    )}
                                </div>
                                {billingCycle === 'yearly' && tier.name === 'Pro Trader' && (
                                    <p className="text-xs text-cyan-400 mt-2 font-mono font-bold tracking-wider">
                                        Billed ${proYearlyUsd.toLocaleString()} yearly
                                    </p>
                                )}
                                {tier.name === 'Pro Trader' && (
                                    <p className="text-xs text-emerald-400 mt-2 font-mono font-semibold">
                                        {billingCycle === 'monthly'
                                            ? `৳${(publicCfg?.pro_monthly_bdt ?? 5500).toLocaleString()} BDT / mo`
                                            : `৳${(publicCfg?.pro_yearly_bdt ?? 52000).toLocaleString()} BDT / yr`}{' '}
                                        • bKash / Nagad / Binance Pay / Card
                                    </p>
                                )}
                            </div>

                            {tier.isFeatured ? (
                                <button
                                    type="button"
                                    onClick={onSelectPlan}
                                    className="w-full py-4 rounded-xl font-bold bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all hover:scale-[1.02] mb-9"
                                >
                                    {tier.cta}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={tier.name === 'Enterprise' ? () => onOpenBriefing?.('enterprise') : onSelectPlan}
                                    className="w-full py-4 rounded-xl font-bold bg-[#0D1117] border border-white/15 text-white hover:bg-white/5 hover:border-cyan-500/40 transition-all mb-9 text-sm"
                                >
                                    {tier.cta}
                                </button>
                            )}

                            <div className="flex-grow pt-7 border-t border-white/10">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-5">What&apos;s Included</p>
                                <ul className="space-y-3.5">
                                    {tier.features.map((feature) => (
                                        <li key={feature} className="flex items-center gap-3">
                                            <div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${tier.isFeatured ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-white/5 text-slate-400 border border-white/10'}`}>
                                                <Check className="w-3 h-3" strokeWidth={3} />
                                            </div>
                                            <span className="text-sm text-slate-300">{feature}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Comparison Table */}
            <div className={`relative border-y border-white/5 py-20 bg-[#050A15]/60 ${thermalGuard ? '' : 'backdrop-blur-xl'}`}>
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-5xl relative z-10">
                    <h2 className="text-3xl font-extrabold text-white text-center mb-12 tracking-tight">Plan Comparison</h2>
                    <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#070F20]/85 shadow-2xl">
                        <table className="w-full text-left border-collapse min-w-[680px]">
                            <thead>
                                <tr className="border-b border-white/10 bg-[#0D1117]">
                                    <th className="py-5 px-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest w-1/3">Capability</th>
                                    <th className="py-5 px-4 text-center font-bold text-white w-1/5">Starter</th>
                                    <th className="py-5 px-4 text-center font-bold text-cyan-400 w-1/5">Pro Trader</th>
                                    <th className="py-5 px-4 text-center font-bold text-violet-400 w-1/5">Enterprise</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {COMPARISON_FEATURES.map((row) => (
                                    <tr key={row.name} className="hover:bg-white/5 transition-colors">
                                        <td className="py-4 px-6 text-sm font-medium text-slate-200">{row.name}</td>
                                        <td className="py-4 px-4 text-sm text-center text-slate-400 font-mono">{row.free}</td>
                                        <td className="py-4 px-4 text-sm text-center font-bold text-cyan-400 font-mono">{row.pro}</td>
                                        <td className="py-4 px-4 text-sm text-center text-violet-300 font-mono">{row.ent}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* FAQ Section */}
            <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-20 max-w-3xl relative z-10">
                <h2 className="text-3xl font-extrabold text-white text-center mb-10 tracking-tight">Frequently Asked Questions</h2>
                <div className="space-y-3.5">
                    {FAQS.map((faq, index) => (
                        <div key={faq.q} className="border border-white/10 rounded-2xl overflow-hidden bg-[#0D1117]/85 hover:border-cyan-500/25 transition-all">
                            <button
                                type="button"
                                onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                                className="w-full flex justify-between items-center p-5 sm:p-6 text-left focus:outline-none group"
                            >
                                <span className="font-bold text-white group-hover:text-cyan-400 transition-colors pr-4">{faq.q}</span>
                                <div className={`w-8 h-8 rounded-full border border-white/10 flex items-center justify-center shrink-0 transition-transform duration-300 ${openFaqIndex === index ? 'rotate-180 bg-cyan-500/15 border-cyan-500/30 text-cyan-400' : 'text-slate-400'}`}>
                                    <ChevronDown className="w-4 h-4" />
                                </div>
                            </button>
                            <div className={`px-5 sm:px-6 text-sm text-slate-400 leading-relaxed font-light overflow-hidden transition-all duration-300 ${openFaqIndex === index ? 'max-h-40 pb-6 opacity-100' : 'max-h-0 opacity-0'}`}>
                                {faq.a}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default PricingPage;
