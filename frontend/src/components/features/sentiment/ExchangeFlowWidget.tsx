import React, { useEffect, useState } from 'react';
import { isThermalGuardActive } from '@/utils/deviceProfile';

interface ExchangeFlowData {
    inflow_eth: number;
    outflow_eth: number;
    net_flow: number;
    sentiment: string;
    tx_count: number;
}

const ExchangeFlowWidget: React.FC = React.memo(() => {
    const thermalGuard = isThermalGuardActive();
    const [data, setData] = useState<ExchangeFlowData | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchData = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_API_URL || ''}/api/v1/on-chain/exchange-flow`
                );
                if (response.ok) {
                    const result = await response.json();
                    setData(result);
                }
            } catch (error) {
                console.error('Failed to fetch exchange flow metrics', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, thermalGuard ? 90000 : 60000);
        return () => clearInterval(interval);
    }, [thermalGuard]);

    if (loading) {
        return (
            <div className="animate-pulse h-40 bg-slate-100 dark:bg-[#070b14] rounded-2xl border border-slate-200 dark:border-white/10" />
        );
    }

    const safeData = {
        inflow_eth: Number(data?.inflow_eth ?? 0),
        outflow_eth: Number(data?.outflow_eth ?? 0),
        net_flow: Number(data?.net_flow ?? 0),
        sentiment: data?.sentiment || 'Neutral',
        tx_count: Number(data?.tx_count ?? 0),
    };

    const totalFlow = safeData.inflow_eth + safeData.outflow_eth;
    const inflowPct = totalFlow > 0 ? (safeData.inflow_eth / totalFlow) * 100 : 50;

    const isBullish = safeData.net_flow > 0;
    const isNeutral = safeData.net_flow === 0;

    return (
        <div className="bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-5 rounded-2xl shadow-sm flex flex-col justify-between relative overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                        Aggregate Exchange Netflow (Live)
                    </h3>
                    <p className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                        Block-Level Settlement Inflow vs Outflow
                    </p>
                </div>
                <span
                    className={`text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-lg border ${
                        isBullish
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/35'
                            : isNeutral
                              ? 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-white/10'
                              : 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/35'
                    }`}
                >
                    {safeData.sentiment.toUpperCase()}
                </span>
            </div>

            <div className="space-y-2.5 my-2">
                <div className="flex justify-between items-end text-xs font-mono">
                    <div>
                        <span className="text-slate-500 dark:text-gray-400 block text-[10px] uppercase">
                            Inflow (Sell)
                        </span>
                        <span className="text-rose-600 dark:text-rose-400 font-black text-base">
                            {safeData.inflow_eth.toFixed(2)} <span className="text-xs">ETH</span>
                        </span>
                    </div>
                    <div className="text-right">
                        <span className="text-slate-500 dark:text-gray-400 block text-[10px] uppercase">
                            Outflow (Buy)
                        </span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-black text-base">
                            {safeData.outflow_eth.toFixed(2)} <span className="text-xs">ETH</span>
                        </span>
                    </div>
                </div>

                <div className="h-3 bg-slate-200 dark:bg-[#050811] rounded-full overflow-hidden flex relative border border-slate-200 dark:border-white/10">
                    <div
                        className="h-full bg-gradient-to-r from-rose-600 to-rose-400"
                        style={{ width: `${inflowPct}%` }}
                    />
                    <div
                        className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600"
                        style={{ width: `${100 - inflowPct}%` }}
                    />
                </div>
            </div>

            <div className="flex justify-between items-center text-[10.5px] font-mono text-slate-500 dark:text-gray-400 pt-2 border-t border-slate-100 dark:border-white/5">
                <span>
                    Analyzed:{' '}
                    <strong className="text-slate-800 dark:text-gray-200">
                        {safeData.tx_count}
                    </strong>{' '}
                    Tx/Block
                </span>
                <span>
                    Net:{' '}
                    <strong
                        className={
                            isBullish
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                        }
                    >
                        {safeData.net_flow > 0 ? '+' : ''}
                        {safeData.net_flow.toFixed(2)} ETH
                    </strong>
                </span>
            </div>
        </div>
    );
});

export default ExchangeFlowWidget;
