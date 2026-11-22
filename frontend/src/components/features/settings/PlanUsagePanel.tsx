import React, { useCallback, useEffect, useState } from 'react';
import { fetchMyPlanUsage } from '@/services/auth';
import { billingService, type PlatformNoCodeConfig } from '@/services/adminService';
import { useToast } from '@/context/ToastContext';
import { useSettings } from '@/context/SettingsContext';
import Button from '@/components/common/Button';
import {
    Crown,
    Cpu,
    Bot,
    Key,
    BarChart3,
    Sparkles,
    CreditCard,
    Coins,
    Smartphone,
    CheckCircle2,
    HelpCircle,
} from 'lucide-react';

interface PlanUsageResponse {
    plan_tier: string;
    display_name: string;
    is_unlimited: boolean;
    usage: {
        exchanges: number;
        active_bots: number;
        backtests_this_month: number;
        ai_calls_today: number;
    };
    limits: {
        max_exchanges: number | null;
        max_active_bots: number | null;
        max_backtests_per_month: number | null;
        max_ai_calls_per_day: number | null;
        ml_training_enabled: boolean;
    };
}

interface BillingInfo {
    providers: { stripe: boolean; nowpayments: boolean };
    local_config?: PlatformNoCodeConfig;
    subscription: {
        status: string;
        provider: string;
        billing_cycle: string;
        current_period_end: string | null;
    } | null;
    transactions: {
        id: number;
        provider: string;
        amount_usd: number;
        amount_bdt?: number | null;
        currency: string;
        plan_tier: string;
        billing_cycle: string;
        status: string;
        trx_id?: string | null;
        sender_account?: string | null;
        created_at: string | null;
    }[];
}

const QuotaRow: React.FC<{
    icon: React.ReactNode;
    label: string;
    used: number;
    limit: number | null;
}> = ({ icon, label, used, limit }) => {
    const isUnlimited = limit === null;
    const pct = isUnlimited || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
    const nearLimit = !isUnlimited && limit > 0 && used >= limit;

    return (
        <div className="p-3.5 rounded-lg bg-gray-50 dark:bg-[#0A0A0A]/40 border border-gray-200 dark:border-[#1A1A1A] space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-gray-200">
                    {icon}
                    {label}
                </span>
                <span className={`font-mono text-xs font-bold ${nearLimit ? 'text-rose-500' : 'text-cyan-500'}`}>
                    {isUnlimited ? `${used} / Unlimited` : `${used} / ${limit}`}
                </span>
            </div>
            {!isUnlimited && (
                <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${nearLimit ? 'bg-rose-500' : 'bg-cyan-500'}`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                    />
                </div>
            )}
        </div>
    );
};

const PlanUsagePanel: React.FC = () => {
    const { showToast } = useToast();
    const { loadUserData } = useSettings();
    const [data, setData] = useState<PlanUsageResponse | null>(null);
    const [billing, setBilling] = useState<BillingInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [checkingOut, setCheckingOut] = useState<string | null>(null);

    // Bangladesh & Direct Crypto Manual Payment State
    const [localMethod, setLocalMethod] = useState<'bkash' | 'nagad' | 'rocket' | 'binance_pay'>('bkash');
    const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
    const [senderAccount, setSenderAccount] = useState('');
    const [trxId, setTrxId] = useState('');
    const [note, setNote] = useState('');
    const [submittingLocal, setSubmittingLocal] = useState(false);

    const refreshAll = useCallback(async () => {
        const [usageRes, billingRes] = await Promise.all([
            fetchMyPlanUsage().catch(() => null),
            billingService.getSubscription().catch(() => null),
        ]);
        if (usageRes) setData(usageRes);
        if (billingRes) setBilling(billingRes);
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const checkoutState = params.get('checkout');
        if (checkoutState === 'success') {
            showToast('Payment completed! Syncing your upgraded plan...', 'success');
            void loadUserData();
            params.delete('checkout');
            const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
            window.history.replaceState({}, '', nextUrl);
        } else if (checkoutState === 'canceled') {
            showToast('Checkout was canceled. Your current plan remains unchanged.', 'warning');
            params.delete('checkout');
            const nextUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
            window.history.replaceState({}, '', nextUrl);
        }
    }, [loadUserData, showToast]);

    useEffect(() => {
        let alive = true;
        refreshAll().finally(() => {
            if (alive) setLoading(false);
        });
        return () => {
            alive = false;
        };
    }, [refreshAll]);

    const handleUpgrade = async (provider: 'stripe' | 'nowpayments') => {
        setCheckingOut(provider);
        try {
            const res = await billingService.createCheckout(provider, 'pro', billingCycle);
            if (res?.checkout_url) {
                window.location.href = res.checkout_url;
            }
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.response?.data?.message || 'Checkout unavailable';
            showToast(msg, 'warning');
        } finally {
            setCheckingOut(null);
        }
    };

    const handleManualSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!senderAccount.trim() || !trxId.trim()) {
            showToast('Please enter your Sender Number/ID and Transaction ID (TrxID).', 'warning');
            return;
        }
        setSubmittingLocal(true);
        try {
            const res = await billingService.submitManualPayment({
                provider: localMethod,
                trx_id: trxId.trim(),
                sender_account: senderAccount.trim(),
                plan_tier: 'pro',
                billing_cycle: billingCycle,
                note: note.trim() || undefined,
            });
            showToast(res?.message || 'Payment submitted for verification!', 'success');
            setTrxId('');
            setSenderAccount('');
            setNote('');
            await refreshAll();
        } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.response?.data?.message || 'Failed to submit payment';
            showToast(msg, 'error');
        } finally {
            setSubmittingLocal(false);
        }
    };

    if (loading) {
        return <div className="p-6 text-sm text-gray-500">Loading subscription & quota telemetry...</div>;
    }

    if (!data) {
        return <div className="p-6 text-sm text-gray-500">Unable to load current plan quota details.</div>;
    }

    const cfg = billing?.local_config;
    const priceUsd = billingCycle === 'yearly' ? (cfg?.pro_yearly_usd ?? 468) : (cfg?.pro_monthly_usd ?? 49);
    const priceBdt = billingCycle === 'yearly' ? (cfg?.pro_yearly_bdt ?? 52000) : (cfg?.pro_monthly_bdt ?? 5500);
    const pendingTx = billing?.transactions?.find((t) => t.status === 'pending_approval');

    const getDestinationNumber = () => {
        if (!cfg) return '01931645993';
        if (localMethod === 'bkash') return cfg.bkash_number || 'Not configured';
        if (localMethod === 'nagad') return cfg.nagad_number || 'Not configured';
        if (localMethod === 'rocket') return cfg.rocket_number || 'Not configured';
        return cfg.binance_pay_id || 'Not configured';
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 via-violet-500/10 to-transparent border border-cyan-500/20">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-cyan-500/15 text-cyan-400">
                        <Crown className="w-6 h-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-slate-900 dark:text-white">{data.display_name}</h3>
                            {data.is_unlimited && (
                                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400 border border-violet-500/30">
                                    Owner Unlimited
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            {billing?.subscription?.current_period_end
                                ? `Active via ${billing.subscription.provider.toUpperCase()} • Expires ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`
                                : 'Active SaaS tier enforcement & monthly/daily resource usage.'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {cfg?.support_url && (
                        <a
                            href={cfg.support_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
                        >
                            <HelpCircle className="w-3.5 h-3.5" />
                            Support
                        </a>
                    )}
                    <span className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/80 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-gray-300">
                        Tier: {data.plan_tier}
                    </span>
                </div>
            </div>

            {pendingTx && (
                <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="text-xs text-amber-700 dark:text-amber-300 space-y-0.5">
                        <div className="font-bold">
                            ⏳ আপনার পেমেন্টটি ({pendingTx.provider.toUpperCase()} • TrxID: {pendingTx.trx_id || 'Submitted'}) ভেরিফিকেশনের অপেক্ষায় আছে।
                        </div>
                        <div>
                            Owner আপনার TrxID অ্যাপ্রুভ করার সাথে সাথেই আপনার Pro প্ল্যান অটোমেটিক চালু হয়ে যাবে।
                        </div>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={() => {
                            void refreshAll();
                            void loadUserData();
                            showToast('Checked latest subscription status!', 'info');
                        }}
                    >
                        Refresh Status
                    </Button>
                </div>
            )}

            {!data.is_unlimited && (
                <div className="p-5 rounded-2xl border border-cyan-500/30 bg-cyan-500/5 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white">
                                {data.plan_tier === 'free' ? 'Upgrade to Pro Trader' : 'Renew / Extend Pro Trader'} (৳{priceBdt.toLocaleString()} / ${priceUsd})
                            </h4>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Unlock 5 exchanges, 10 active bots, unlimited backtests, 200 AI calls/day, and Auto-ML Training.
                            </p>
                        </div>
                        <div className="inline-flex rounded-xl p-1 bg-gray-200/70 dark:bg-black/50 border border-gray-300 dark:border-white/10 text-xs font-semibold">
                            <button
                                type="button"
                                onClick={() => setBillingCycle('monthly')}
                                className={`px-3 py-1.5 rounded-lg transition-all ${
                                    billingCycle === 'monthly' ? 'bg-cyan-500 text-white' : 'text-gray-500'
                                }`}
                            >
                                Monthly (30d)
                            </button>
                            <button
                                type="button"
                                onClick={() => setBillingCycle('yearly')}
                                className={`px-3 py-1.5 rounded-lg transition-all ${
                                    billingCycle === 'yearly' ? 'bg-violet-500 text-white' : 'text-gray-500'
                                }`}
                            >
                                Yearly (Save 20%)
                            </button>
                        </div>
                    </div>

                    {/* Bangladesh Mobile Banking & Binance Pay Form */}
                    <div className="p-4 rounded-xl bg-white/90 dark:bg-[#0A0A0A]/80 border border-gray-200 dark:border-white/10 space-y-4">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-cyan-500 flex items-center gap-1.5">
                                <Smartphone className="w-4 h-4" />
                                Bangladesh Local & Direct Crypto Payment (Instant TrxID Submit)
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                                {([
                                    { id: 'bkash', label: 'bKash' },
                                    { id: 'nagad', label: 'Nagad' },
                                    { id: 'rocket', label: 'Rocket' },
                                    { id: 'binance_pay', label: 'Binance Pay / USDT' },
                                ] as const).map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setLocalMethod(m.id)}
                                        className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${
                                            localMethod === m.id
                                                ? 'bg-cyan-500 text-white border-cyan-500'
                                                : 'bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/10'
                                        }`}
                                    >
                                        {m.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-slate-800 dark:text-gray-200 space-y-1">
                            <div>
                                ১. নিচের <strong>{localMethod.toUpperCase()}</strong> নাম্বার/আইডিতে{' '}
                                <strong className="text-cyan-500">
                                    {localMethod === 'binance_pay' ? `$${priceUsd} USDT` : `৳${priceBdt.toLocaleString()} BDT`}
                                </strong>{' '}
                                পাঠান:
                            </div>
                            <div className="font-mono text-sm font-bold text-cyan-600 dark:text-cyan-300 select-all">
                                {getDestinationNumber()}
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                ২. টাকা পাঠানোর পর আপনার নাম্বার এবং Transaction ID (TrxID) নিচে দিয়ে Submit করুন—Owner ভেরিফাই করলেই অটোমেটিক Pro চালু হয়ে যাবে।
                            </div>
                        </div>

                        <form onSubmit={handleManualSubmit} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <input
                                type="text"
                                required
                                value={senderAccount}
                                onChange={(e) => setSenderAccount(e.target.value)}
                                placeholder={localMethod === 'binance_pay' ? 'Your Binance ID / Wallet' : 'Sender Number (e.g. 017XXXXXXXX)'}
                                className="px-3 py-2 text-xs rounded-lg bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                            />
                            <input
                                type="text"
                                required
                                value={trxId}
                                onChange={(e) => setTrxId(e.target.value)}
                                placeholder="Transaction ID (TrxID)"
                                className="px-3 py-2 text-xs font-mono rounded-lg bg-gray-50 dark:bg-black/50 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                            />
                            <Button type="submit" variant="primary" disabled={submittingLocal}>
                                <span className="flex items-center justify-center gap-1.5 text-xs">
                                    <CheckCircle2 className="w-4 h-4" />
                                    {submittingLocal ? 'Submitting...' : 'Submit TrxID'}
                                </span>
                            </Button>
                        </form>
                    </div>

                    {/* International Gateway Buttons */}
                    {(billing?.providers?.stripe || billing?.providers?.nowpayments) && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-cyan-500/20">
                            <span className="text-xs text-gray-500">Or pay via automated international gateway:</span>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    variant="secondary"
                                    disabled={checkingOut !== null}
                                    onClick={() => handleUpgrade('stripe')}
                                >
                                    <span className="flex items-center gap-1.5 text-xs">
                                        <CreditCard className="w-4 h-4" />
                                        {checkingOut === 'stripe' ? 'Redirecting...' : 'Card (Stripe)'}
                                    </span>
                                </Button>
                                <Button
                                    variant="secondary"
                                    disabled={checkingOut !== null}
                                    onClick={() => handleUpgrade('nowpayments')}
                                >
                                    <span className="flex items-center gap-1.5 text-xs">
                                        <Coins className="w-4 h-4" />
                                        {checkingOut === 'nowpayments' ? 'Redirecting...' : 'Crypto (NOWPayments)'}
                                    </span>
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <QuotaRow
                    icon={<Key className="w-4 h-4 text-cyan-500" />}
                    label="Connected Exchanges"
                    used={data.usage.exchanges}
                    limit={data.limits.max_exchanges}
                />
                <QuotaRow
                    icon={<Bot className="w-4 h-4 text-emerald-500" />}
                    label="Active Running Bots"
                    used={data.usage.active_bots}
                    limit={data.limits.max_active_bots}
                />
                <QuotaRow
                    icon={<BarChart3 className="w-4 h-4 text-violet-500" />}
                    label="Monthly Backtests"
                    used={data.usage.backtests_this_month}
                    limit={data.limits.max_backtests_per_month}
                />
                <QuotaRow
                    icon={<Sparkles className="w-4 h-4 text-amber-500" />}
                    label="Daily AI Strategy / Sentiment Calls"
                    used={data.usage.ai_calls_today}
                    limit={data.limits.max_ai_calls_per_day}
                />
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-lg bg-gray-50 dark:bg-[#0A0A0A]/40 border border-gray-200 dark:border-[#1A1A1A] text-sm">
                <span className="flex items-center gap-2 font-medium text-slate-800 dark:text-gray-200">
                    <Cpu className="w-4 h-4 text-pink-500" />
                    Auto-ML & RL Model Training Studio
                </span>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                    data.limits.ml_training_enabled
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-gray-200 dark:bg-white/10 text-gray-500'
                }`}>
                    {data.limits.ml_training_enabled ? 'Unlocked' : 'Pro Required'}
                </span>
            </div>

            {billing && billing.transactions.length > 0 && (
                <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500">Payment History</h4>
                    <div className="space-y-1.5">
                        {billing.transactions.map((t) => (
                            <div key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 rounded-lg bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-white/5 text-xs">
                                <div>
                                    <span className="font-semibold text-slate-800 dark:text-gray-200">
                                        {t.plan_tier.toUpperCase()} ({t.billing_cycle}) via {t.provider.toUpperCase()}
                                    </span>
                                    {t.trx_id && (
                                        <span className="ml-2 font-mono text-cyan-500">TrxID: {t.trx_id}</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 font-mono">
                                    <span className="text-gray-500">
                                        {t.amount_bdt ? `৳${t.amount_bdt} / ` : ''}${t.amount_usd}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                        t.status === 'paid'
                                            ? 'bg-emerald-500/15 text-emerald-500'
                                            : t.status === 'pending_approval'
                                            ? 'bg-amber-500/15 text-amber-500'
                                            : t.status === 'rejected'
                                            ? 'bg-rose-500/15 text-rose-500'
                                            : 'bg-gray-500/15 text-gray-400'
                                    }`}>
                                        {t.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanUsagePanel;
