import React from 'react';
import { Shield, FileText, Cookie, AlertTriangle, ArrowLeft } from 'lucide-react';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export type LegalDocType = 'terms' | 'privacy' | 'cookies' | 'risk';

interface LegalPageProps {
    docType: LegalDocType;
    onSelectDoc: (doc: LegalDocType) => void;
    onBack: () => void;
}

const DOC_TABS: { id: LegalDocType; label: string; icon: React.ReactNode }[] = [
    { id: 'terms', label: 'Terms of Service', icon: <FileText className="w-4 h-4" /> },
    { id: 'privacy', label: 'Privacy Policy', icon: <Shield className="w-4 h-4" /> },
    { id: 'risk', label: 'Risk Disclaimer', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'cookies', label: 'Cookie Policy', icon: <Cookie className="w-4 h-4" /> },
];

const LegalPage: React.FC<LegalPageProps> = ({ docType, onSelectDoc, onBack }) => {
    const year = new Date().getFullYear();
    const thermalGuard = isThermalGuardActive();

    return (
        <div className="min-h-screen py-20 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-2 text-sm text-cyan-400 hover:text-cyan-300 mb-8 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Platform Overview
            </button>

            <div className={`bg-[#070F20]/85 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 rounded-3xl p-6 sm:p-10 shadow-2xl space-y-8`}>
                <div>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-3 py-1 rounded-full">
                        Compliance & Legal Documentation
                    </span>
                    <h1 className="text-3xl sm:text-4xl font-extrabold text-white mt-4">
                        CosmoQuantAI Legal Center
                    </h1>
                    <p className="text-xs text-slate-400 mt-1">
                        Effective Date: January 1, {year} • Applies to all CosmoQuantAI SaaS subscribers and API integrations.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
                    {DOC_TABS.map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => onSelectDoc(t.id)}
                            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                                docType === t.id
                                    ? 'bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-lg'
                                    : 'bg-white/5 text-slate-300 hover:bg-white/10'
                            }`}
                        >
                            {t.icon}
                            {t.label}
                        </button>
                    ))}
                </div>

                {docType === 'terms' && (
                    <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
                        <h2 className="text-xl font-bold text-white">1. Terms of Service</h2>
                        <p>
                            CosmoQuantAI provides software tooling for market telemetry, historical backtesting, portfolio tracking, and user-configured automated execution bots. By creating an account, you confirm you are at least 18 years old and legally permitted to access digital asset or derivative analytics software in your jurisdiction.
                        </p>
                        <h3 className="text-base font-bold text-white pt-2">Non-Custodial Software Model</h3>
                        <p>
                            CosmoQuantAI never takes custody of your exchange funds. You connect external exchanges solely via trade-only API keys configured with IP restrictions and zero withdrawal permissions. You remain solely responsible for every strategy, parameter, leverage setting, and order executed under your credentials.
                        </p>
                        <h3 className="text-base font-bold text-white pt-2">Subscriptions & Quotas</h3>
                        <p>
                            Subscription tiers (Free, Pro Trader, Enterprise) govern monthly backtest quotas, connected exchange limits, active bot concurrency, and AI Foundry usage. Subscriptions renew automatically unless canceled prior to the next billing cycle.
                        </p>
                    </div>
                )}

                {docType === 'privacy' && (
                    <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
                        <h2 className="text-xl font-bold text-white">2. Privacy & API Key Protection Policy</h2>
                        <p>
                            We collect only the account information strictly needed to operate your workspace: email address, display name, hashed authentication credentials, optional Two-Factor secrets, and workspace preferences.
                        </p>
                        <h3 className="text-base font-bold text-white pt-2">Cryptographic Vault Security</h3>
                        <p>
                            Third-party exchange API secrets and 2FA authenticator secrets are encrypted at rest using authenticated symmetric cryptography (`Fernet` / AES-128-CBC + HMAC-SHA256) before database persistence. Per-user ML models, datasets, and strategy files are isolated inside user-scoped storage directories.
                        </p>
                        <h3 className="text-base font-bold text-white pt-2">Third-Party Processors</h3>
                        <p>
                            Billing checkouts are processed securely by Stripe or NOWPayments; CosmoQuantAI does not store raw credit card numbers or private wallet seed phrases.
                        </p>
                    </div>
                )}

                {docType === 'risk' && (
                    <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
                        <h2 className="text-xl font-bold text-rose-400">3. Algorithmic Trading & Financial Risk Disclaimer</h2>
                        <p className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-200">
                            Trading cryptocurrencies, forex, futures, and leveraged derivatives carries a substantial risk of financial loss and is not suitable for every investor. Past backtest performance or AI signal accuracy does not guarantee future results.
                        </p>
                        <p>
                            CosmoQuantAI provides analytical software only and does not provide personalized investment, tax, or legal advice. Network latency, exchange API downtime, liquidity gaps, or extreme volatility may cause slippage or unexpected bot executions. Always test new strategies thoroughly in Paper Trading mode before allocating live capital.
                        </p>
                    </div>
                )}

                {docType === 'cookies' && (
                    <div className="space-y-4 text-sm text-slate-300 leading-relaxed">
                        <h2 className="text-xl font-bold text-white">4. Cookie & Local Storage Policy</h2>
                        <p>
                            CosmoQuantAI uses strictly necessary browser storage (`localStorage` and `sessionStorage`) to preserve your authentication session, theme preference (dark/light), notification preferences, and active workspace state.
                        </p>
                        <p>
                            We do not sell user behavioral data to third-party advertising networks. Clearing your browser site data will sign out active sessions and reset local UI preferences.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LegalPage;
