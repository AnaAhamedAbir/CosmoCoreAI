import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, Calendar, Building2, Sparkles, Mail } from 'lucide-react';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export type BriefingTopic = 'enterprise' | 'custom_algo' | 'demo';

interface PublicBriefingModalProps {
    isOpen: boolean;
    initialTopic?: BriefingTopic;
    onClose: () => void;
    onSignUp?: () => void;
}

const TOPIC_LABELS: Record<BriefingTopic, { title: string; subtitle: string; badge: string }> = {
    enterprise: {
        title: 'Enterprise & Desk Briefing',
        subtitle: 'Discuss dedicated cloud clusters, DMA routing, team seats, and custom SLAs with our solutions team.',
        badge: 'Enterprise Plan'
    },
    custom_algo: {
        title: 'Custom Quant Engineering',
        subtitle: 'Scope custom strategies, WallHunter webhook pipelines, or low-latency execution bots with our quant engineers.',
        badge: 'Custom Engineering'
    },
    demo: {
        title: 'Live Platform Walkthrough',
        subtitle: 'Get a guided tour of AI Foundry, OrderFlow Heatmap, Smart Chase SL, and Automated Bot Lab.',
        badge: 'Guided Tour'
    }
};

const PublicBriefingModal: React.FC<PublicBriefingModalProps> = ({
    isOpen,
    initialTopic = 'demo',
    onClose,
    onSignUp,
}) => {
    const [topic, setTopic] = useState<BriefingTopic>(initialTopic);
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [deskSize, setDeskSize] = useState('Individual Pro Trader');
    const [notes, setNotes] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);

    const thermalGuard = isThermalGuardActive();

    useEffect(() => {
        if (isOpen) {
            setTopic(initialTopic);
            setError(null);
            setSubmitted(false);
        }
    }, [isOpen, initialTopic]);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const meta = TOPIC_LABELS[topic];

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !email.includes('@')) {
            setError('Please enter your name and a valid work or personal email.');
            return;
        }
        setError(null);
        setSubmitted(true);
    };

    return (
        <div
            className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 ${thermalGuard ? '' : 'backdrop-blur-md'}`}
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-lg rounded-3xl bg-[#070F20] border border-cyan-500/25 shadow-[0_0_50px_rgba(6,182,212,0.2)] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-emerald-400" />
                <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close briefing dialog"
                    className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:border-cyan-500/40 flex items-center justify-center transition-colors"
                >
                    <X className="w-4 h-4" />
                </button>

                {submitted ? (
                    <div className="p-8 text-center">
                        <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                            <CheckCircle2 className="w-7 h-7" />
                        </div>
                        <span className="inline-block px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-bold uppercase tracking-wider mb-3">
                            Request Logged • {meta.badge}
                        </span>
                        <h3 className="text-2xl font-extrabold text-white mb-2">Briefing Request Received</h3>
                        <p className="text-sm text-slate-400 leading-relaxed mb-6">
                            Thank you, <span className="text-white font-semibold">{name}</span>. Our onboarding & quant solutions team will reach out to <span className="text-cyan-300 font-mono">{email}</span> within 1 business day.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            {onSignUp && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onClose();
                                        onSignUp();
                                    }}
                                    className="px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-lg hover:scale-[1.02] transition-all"
                                >
                                    Start Free Workspace Now
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={onClose}
                                className="px-6 py-3 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10 transition-colors"
                            >
                                Back to Site
                            </button>
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-5">
                        <div>
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[11px] font-bold uppercase tracking-wider mb-3">
                                <Calendar className="w-3.5 h-3.5" />
                                {meta.badge}
                            </div>
                            <h3 className="text-2xl font-extrabold text-white">{meta.title}</h3>
                            <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">{meta.subtitle}</p>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { id: 'demo', label: 'Platform Tour' },
                                { id: 'custom_algo', label: 'Custom Engine' },
                                { id: 'enterprise', label: 'Enterprise' },
                            ] as { id: BriefingTopic; label: string }[]).map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setTopic(item.id)}
                                    className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all ${
                                        topic === item.id
                                            ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-300'
                                            : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                                    }`}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                                    Full Name
                                </label>
                                <input
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="Alex Mercer"
                                    className="w-full rounded-xl bg-[#0D1117] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                                />
                            </div>
                            <div>
                                <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                                    Work or Personal Email
                                </label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="alex@desk.io"
                                    className="w-full rounded-xl bg-[#0D1117] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                                Trading Profile
                            </label>
                            <div className="relative">
                                <Building2 className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <select
                                    value={deskSize}
                                    onChange={(e) => setDeskSize(e.target.value)}
                                    className="w-full rounded-xl bg-[#0D1117] border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/60"
                                >
                                    <option>Individual Pro Trader</option>
                                    <option>Prop Desk / Trading Team (2-10 seats)</option>
                                    <option>Quantitative Fund / Institutional</option>
                                    <option>Broker / Fintech Partner</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                                Target Markets & Requirements (Optional)
                            </label>
                            <textarea
                                rows={3}
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="E.g., Binance Futures + Bybit execution, WallHunter alerts, Smart Chase risk automation..."
                                className="w-full rounded-xl bg-[#0D1117] border border-white/10 p-3.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500/60 resize-none"
                            />
                        </div>

                        {error && (
                            <p className="text-xs text-rose-400 font-medium">{error}</p>
                        )}

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                            <a
                                href="mailto:support@cosmoquant.ai?subject=CosmoQuantAI%20Inquiry"
                                className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 transition-colors"
                            >
                                <Mail className="w-3.5 h-3.5" />
                                support@cosmoquant.ai
                            </a>
                            <button
                                type="submit"
                                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all hover:scale-[1.02]"
                            >
                                <Sparkles className="w-4 h-4" />
                                Request Briefing
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default PublicBriefingModal;
