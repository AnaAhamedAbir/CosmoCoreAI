import React from 'react';
import { useMarketStore, MarketType } from '@/store/marketStore';
import { Bitcoin, LineChart, Building2, Droplets } from 'lucide-react'; 

const MarketSwitcher: React.FC = () => {
    const { activeMarket, setActiveMarket } = useMarketStore();

    const markets: { id: MarketType; label: string; icon: React.ReactNode }[] = [
        { id: 'crypto', label: 'Crypto', icon: <Bitcoin className="w-4 h-4" /> },
        { id: 'forex', label: 'Forex', icon: <LineChart className="w-4 h-4" /> },
        { id: 'stocks', label: 'Stocks', icon: <Building2 className="w-4 h-4" /> },
        { id: 'commodities', label: 'Commodities', icon: <Droplets className="w-4 h-4" /> },
    ];

    return (
        <div className="flex bg-gray-100 dark:bg-[#0A0A0A]/80 p-1 rounded-xl border border-gray-200 dark:border-white/10 shadow-inner">
            {markets.map((market) => {
                const isActive = activeMarket === market.id;
                
                // Active Colors based on market type
                let activeClasses = '';
                if (isActive) {
                    if (market.id === 'crypto') {
                        activeClasses = 'bg-brand-primary text-white shadow-brand-primary/20 shadow-md';
                    } else {
                        // Gold theme for TradFi
                        activeClasses = 'bg-gradient-to-r from-yellow-600 to-yellow-500 text-white shadow-yellow-500/20 shadow-md';
                    }
                }

                return (
                    <button
                        key={market.id}
                        onClick={() => setActiveMarket(market.id)}
                        className={`
                            relative flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold
                            transition-all duration-300 ease-in-out
                            ${isActive ? activeClasses : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/5'}
                        `}
                    >
                        {market.icon}
                        <span className="whitespace-nowrap">{market.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default MarketSwitcher;
