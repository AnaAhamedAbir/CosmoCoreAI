import React from 'react';
import { useMarketStore, MarketType } from '@/store/marketStore';
import { Bitcoin, LineChart } from 'lucide-react'; 

const MarketSwitcher: React.FC = () => {
    const { activeMarket, setActiveMarket } = useMarketStore();

    const markets: { id: MarketType; label: string; icon: React.ReactNode }[] = [
        { id: 'crypto', label: 'Crypto', icon: <Bitcoin className="w-4 h-4" /> },
        { id: 'forex', label: 'Forex', icon: <LineChart className="w-4 h-4" /> },
    ];

    return (
        <div className="inline-flex items-center p-0.5 h-9 rounded-xl bg-slate-100 dark:bg-[#0B1120] border border-slate-200 dark:border-slate-800/80 shadow-inner">
            {markets.map((market) => {
                const isActive = activeMarket === market.id;

                let activeClasses = '';
                if (isActive) {
                    if (market.id === 'crypto') {
                        activeClasses = 'bg-gradient-to-r from-cyan-500/20 to-indigo-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/35 shadow-sm';
                    } else {
                        activeClasses = 'bg-gradient-to-r from-amber-500/20 to-orange-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35 shadow-sm';
                    }
                }

                return (
                    <button
                        type="button"
                        key={market.id}
                        onClick={() => setActiveMarket(market.id)}
                        className={`
                            relative flex items-center justify-center gap-1.5 px-2.5 sm:px-3 h-full rounded-[10px] text-[11px] font-bold uppercase tracking-wider
                            transition-colors cursor-pointer whitespace-nowrap
                            ${isActive ? activeClasses : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white border border-transparent'}
                        `}
                    >
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                            isActive
                                ? market.id === 'crypto' ? 'bg-cyan-400' : 'bg-amber-400'
                                : 'bg-slate-400/50'
                        }`} />
                        {market.icon}
                        <span className="whitespace-nowrap hidden sm:inline">{market.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default MarketSwitcher;
