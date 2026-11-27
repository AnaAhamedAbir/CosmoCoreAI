import React, { useEffect, useState } from 'react';
import { OnChainMetric } from '../../../types/on_chain';
import { isThermalGuardActive } from '@/utils/deviceProfile';

const OnChainLiquidityWidget: React.FC<{ symbol: string }> = React.memo(({ symbol }) => {
    const thermalGuard = isThermalGuardActive();
    const [data, setData] = useState<OnChainMetric | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchData = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const baseSymbol = symbol.includes('/') ? symbol.split('/')[0] : symbol;
                const response = await fetch(
                    `${import.meta.env.VITE_API_URL || ''}/api/v1/on-chain/${baseSymbol}`
                );
                if (response.ok) {
                    const result = await response.json();
                    setData(result);
                }
            } catch (error) {
                console.error('Failed to fetch on-chain metrics', error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        const interval = setInterval(fetchData, thermalGuard ? 45000 : 30000);
        return () => clearInterval(interval);
    }, [symbol, thermalGuard]);

    if (loading) {
        return (
            <div className="animate-pulse h-40 bg-slate-100 dark:bg-[#070b14] rounded-2xl border border-slate-200 dark:border-white/10" />
        );
    }

    const inflowVol = Number(data?.exchange_inflow_volume || 0);
    const outflowVol = Number(data?.exchange_outflow_volume || 0);
    const netStatus = data?.net_flow_status || 'Balanced Flow';
    const totalVol = inflowVol + outflowVol;
    const inflowPct = totalVol > 0 ? (inflowVol / totalVol) * 100 : 50;

    const isBullish = netStatus === 'Strong Buying Pressure' || outflowVol > inflowVol;
    const isBearish = netStatus === 'High Sell Pressure' || inflowVol > outflowVol;

    return (
        <div className="bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 p-5 rounded-2xl shadow-sm flex flex-col justify-between">
            <div className="flex items-center justify-between gap-2 mb-3">
                <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                        On-Chain Exchange Liquidity ({symbol.split('/')[0]})
                    </h3>
                    <p className="text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                        Tracked CEX Wallet Inflow vs Outflow Pressure
                    </p>
                </div>
                <span
                    className={`text-[10px] font-mono font-black uppercase px-2.5 py-1 rounded-lg border ${
                        isBullish
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/35'
                            : isBearish
                              ? 'bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/35'
                              : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-gray-300 border-slate-200 dark:border-white/10'
                    }`}
                >
                    {netStatus}
                </span>
            </div>

            <div className="space-y-2.5 my-2">
                <div className="flex justify-between text-xs font-mono">
                    <span className="text-slate-500 dark:text-gray-400">
                        Inflow (Sell):{' '}
                        <strong className="text-rose-600 dark:text-rose-400">
                            ${inflowVol.toLocaleString()}
                        </strong>
                    </span>
                    <span className="text-slate-500 dark:text-gray-400">
                        Outflow (Buy):{' '}
                        <strong className="text-emerald-600 dark:text-emerald-400">
                            ${outflowVol.toLocaleString()}
                        </strong>
                    </span>
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
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white/60 left-1/2" />
                </div>

                <div className="flex justify-between text-[10.5px] font-mono text-slate-500 dark:text-gray-400">
                    <span>{inflowPct.toFixed(1)}% Inflow</span>
                    <span>{(100 - inflowPct).toFixed(1)}% Outflow</span>
                </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-white/5 text-[10px] font-mono text-slate-400 flex justify-between">
                <span>Source: On-Chain Telemetry</span>
                <span>
                    Updated:{' '}
                    {data?.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'Live'}
                </span>
            </div>
        </div>
    );
});

export default OnChainLiquidityWidget;
