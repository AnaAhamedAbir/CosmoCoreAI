import React, { useEffect, useState } from 'react';
import { fetchMyPlanUsage } from '@/services/auth';
import { billingService } from '@/services/adminService';
import { useToast } from '@/context/ToastContext';
import { useSettings } from '@/context/SettingsContext';
import Button from '@/components/common/Button';
import { Crown, Cpu, Bot, Key, BarChart3, Sparkles, CreditCard, Coins } from 'lucide-react';

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
        currency: string;
        plan_tier: string;
        billing_cycle: string;
        status: string;
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
        Promise.all([
            fetchMyPlanUsage().catch(() => null),
            billingService.getSubscription().catch(() => null),
        ])
            .then(([usageRes, billingRes]) => {
                if (!alive) return;
                if (usageRes) setData(usageRes);
                if (billingRes) setBilling(billingRes);
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const handleUpgrade = async (provider: 'stripe' | 'nowpayments') => {
        setCheckingOut(provider);
        try {
            const res = await billingService.createCheckout(provider, 'pro', 'monthly');
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

    if (loading) {
        return <div className="p-6 text-sm text-gray-500">Loading subscription & quota telemetry...</div>;
    }

    if (!data) {
        return <div className="p-6 text-sm text-gray-500">Unable to load current plan quota details.</div>;
    }

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
                                ? `Active via ${billing.subscription.provider} • Renews ${new Date(billing.subscription.current_period_end).toLocaleDateString()}`
                                : 'Active SaaS tier enforcement & monthly/daily resource usage.'}
                        </p>
                    </div>
                </div>
                <span className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg bg-white/80 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-700 dark:text-gray-300">
                    Tier: {data.plan_tier}
                </span>
            </div>

            {!data.is_unlimited && data.plan_tier === 'free' && (
                <div className="p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <h4 className="font-bold text-slate-900 dark:text-white">Upgrade to Pro Trader ($49/mo)</h4>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                            Unlock 5 exchanges, 10 active bots, unlimited backtests, 200 AI calls/day, and Auto-ML Training.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant="primary"
                            disabled={checkingOut !== null}
                            onClick={() => handleUpgrade('stripe')}
                        >
                            <span className="flex items-center gap-1.5">
                                <CreditCard className="w-4 h-4" />
                                {checkingOut === 'stripe' ? 'Redirecting...' : 'Pay with Card'}
                            </span>
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={checkingOut !== null}
                            onClick={() => handleUpgrade('nowpayments')}
                        >
                            <span className="flex items-center gap-1.5">
                                <Coins className="w-4 h-4" />
                                {checkingOut === 'nowpayments' ? 'Redirecting...' : 'Pay with Crypto'}
                            </span>
                        </Button>
                    </div>
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
                            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-white/5 text-xs">
                                <span className="font-medium text-slate-800 dark:text-gray-200">
                                    {t.plan_tier.toUpperCase()} ({t.billing_cycle}) via {t.provider}
                                </span>
                                <span className="font-mono text-gray-500">
                                    ${t.amount_usd} • {t.status.toUpperCase()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default PlanUsagePanel;
