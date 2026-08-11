import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, TrendingDown, Flame, Sparkles, BarChart2, Search, Filter, Activity } from 'lucide-react';
import { useBinanceMarketData, TokenData } from '../hooks/useBinanceMarketData';
import { useMarketStore } from '../store/marketStore';

interface TopTokensModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CATEGORIES = {
    'All': [],
    'AI': ['FET', 'AGIX', 'OCEAN', 'RNDR', 'WLD', 'TAO', 'NEAR', 'GRT', 'ROSE', 'AR', 'THETA'],
    'Meme': ['DOGE', 'SHIB', 'PEPE', 'FLOKI', 'BONK', 'WIF', 'BOME', 'MEME', 'PEOPLE'],
    'Layer 1': ['BTC', 'ETH', 'SOL', 'AVAX', 'ADA', 'DOT', 'APT', 'SUI', 'SEI', 'INJ', 'TIA'],
    'DeFi': ['UNI', 'AAVE', 'MKR', 'SNX', 'CRV', 'LDO', 'RUNE', 'CAKE', 'COMP', 'DYDX']
};

export const TopTokensModal: React.FC<TopTokensModalProps> = ({ isOpen, onClose }) => {
    const [isVisible, setIsVisible] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState<keyof typeof CATEGORIES>('All');
    const [baseMarket, setBaseMarket] = useState('USDT');
    
    const data = useBinanceMarketData(isOpen, baseMarket);
    const { setGlobalSymbol } = useMarketStore();

    useEffect(() => {
        if (isOpen) {
            setIsVisible(true);
        } else {
            const timer = setTimeout(() => setIsVisible(false), 300);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    if (!isVisible) return null;

    const filterTokens = (tokens: TokenData[]) => {
        return tokens.filter(t => {
            const baseSymbol = baseMarket === 'All' ? t.symbol : t.symbol.replace(baseMarket, '');
            const symbol = t.symbol.replace('USDT', ''); // Keep generic replace for category match
            
            const matchesSearch = t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = category === 'All' || CATEGORIES[category].includes(symbol);
            return matchesSearch && matchesCategory;
        });
    };

    const handleTokenClick = (symbol: string) => {
        // Find the quote asset to correctly format the symbol for the store
        let quote = 'USDT';
        if (symbol.endsWith('BNB')) quote = 'BNB';
        else if (symbol.endsWith('BTC')) quote = 'BTC';
        else if (symbol.endsWith('FDUSD')) quote = 'FDUSD';
        else if (symbol.endsWith('USDT')) quote = 'USDT';
        
        const base = symbol.substring(0, symbol.length - quote.length);
        setGlobalSymbol(`${base}/${quote}`);
        onClose();
    };

    const renderSparkline = (history: number[], isPositive: boolean) => {
        if (!history || history.length < 2) return (
            <svg width="40" height="16" className="mx-2"><line x1="0" y1="8" x2="40" y2="8" stroke="#4b5563" strokeWidth="1" strokeDasharray="2,2" /></svg>
        );
        const min = Math.min(...history);
        const max = Math.max(...history);
        const range = max - min || 1;
        
        const strokeColor = isPositive ? '#22c55e' : '#ef4444';
        const fillColor = isPositive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        
        const linePoints = history.map((val, i) => `${(i / (history.length - 1)) * 40},${16 - ((val - min) / range) * 14}`).join(' ');
        const areaPoints = `${linePoints} 40,16 0,16`;

        return (
            <div className="relative mx-1.5 flex items-center justify-center">
                <div className="absolute inset-0 blur-[4px] opacity-40" style={{ background: strokeColor }}></div>
                <svg width="40" height="16" className="relative z-10 overflow-visible">
                    <polygon points={areaPoints} fill={fillColor} />
                    <polyline points={linePoints} fill="none" stroke={strokeColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    };

    const renderTokenList = (rawTokens: TokenData[], title: string, icon: React.ReactNode, colorClass: string, glowColor: string, delayClass: string) => {
        const tokens = filterTokens(rawTokens);
        
        return (
            <div className={`relative group flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both ${delayClass}`}>
                <div className={`absolute -inset-0.5 bg-gradient-to-br ${glowColor} opacity-10 group-hover:opacity-30 blur-xl transition-opacity duration-500 rounded-xl`}></div>
                
                <div className="relative bg-black/60 backdrop-blur-xl border border-white/5 group-hover:border-white/20 p-3 flex flex-col h-full rounded-xl transition-all duration-300">
                    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-white/10 relative">
                        <div className={`p-1.5 rounded-md bg-gradient-to-br ${glowColor} bg-opacity-20 backdrop-blur-md border border-white/10 shadow-[0_0_10px_rgba(255,255,255,0.1)]`}>
                            {React.cloneElement(icon as React.ReactElement<any>, { className: `w-4 h-4 text-white` })}
                        </div>
                        <h3 className={`font-bold text-sm tracking-wide bg-clip-text text-transparent bg-gradient-to-r ${colorClass}`}>{title}</h3>
                        
                        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center justify-center w-1.5 h-1.5">
                            <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-20 animate-ping"></span>
                            <span className="relative inline-flex rounded-full h-1 w-1 bg-white opacity-50"></span>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto pr-1.5 custom-scrollbar space-y-1.5">
                        {tokens.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-2">
                                <Activity className="w-6 h-6 opacity-20 animate-pulse" />
                                <span className="text-[10px] uppercase tracking-widest font-bold">No Data</span>
                            </div>
                        ) : (
                            tokens.map((token, index) => {
                                const isPositive = token.priceChangePercent >= 0;
                                return (
                                    <button 
                                        key={token.symbol} 
                                        onClick={() => handleTokenClick(token.symbol)}
                                        className="relative w-full flex flex-col p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/10 transition-all duration-300 group/btn cursor-pointer overflow-hidden transform hover:-translate-y-0.5 hover:shadow-md"
                                    >
                                        <div className={`absolute inset-0 bg-gradient-to-r ${glowColor} opacity-0 group-hover/btn:opacity-10 transition-opacity duration-300 pointer-events-none`}></div>
                                        
                                        <div className="flex justify-between items-center w-full relative z-10">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-gray-600 font-mono text-[9px] w-3 text-left">{index + 1}.</span>
                                                <span className="font-bold text-[11px] text-gray-200 group-hover/btn:text-white transition-colors tracking-wide truncate max-w-[50px]">
                                                    {baseMarket === 'All' ? token.symbol : token.symbol.replace(baseMarket, '')}
                                                </span>
                                            </div>
                                            
                                            <div className="flex items-center">
                                                {renderSparkline(token.priceHistory, isPositive)}
                                                <div className="flex flex-col items-end min-w-[55px]">
                                                    <span className="text-[11px] font-mono font-bold text-white tracking-tight">
                                                        ${token.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                                    </span>
                                                    <div className={`flex items-center gap-0.5 text-[9px] font-bold ${isPositive ? 'text-[#4ade80] drop-shadow-[0_0_3px_rgba(74,222,128,0.5)]' : 'text-[#f87171] drop-shadow-[0_0_3px_rgba(248,113,113,0.5)]'}`}>
                                                        {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                        <span>{Math.abs(token.priceChangePercent).toFixed(2)}%</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="w-full mt-2 flex items-center gap-1.5 opacity-40 group-hover/btn:opacity-100 transition-opacity relative z-10">
                                            <span className="text-[7px] font-black tracking-widest text-[#4ade80] w-5">BUY</span>
                                            <div className="flex-1 h-1 bg-black/50 rounded-full overflow-hidden flex border border-white/5">
                                                <div className="h-full bg-[#4ade80] shadow-[0_0_5px_#4ade80] transition-all duration-500 ease-out" style={{ width: `${token.buyPressure ?? 50}%` }} />
                                                <div className="h-full bg-[#f87171] shadow-[0_0_5px_#f87171] transition-all duration-500 ease-out" style={{ width: `${100 - (token.buyPressure ?? 50)}%` }} />
                                            </div>
                                            <span className="text-[7px] font-black tracking-widest text-[#f87171] w-5 text-right">SELL</span>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        );
    };

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-5 font-sans">
            <div 
                className={`absolute inset-0 bg-black/70 backdrop-blur-xl transition-opacity duration-500 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            >
                <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-blue-500/20 rounded-full blur-[80px] mix-blend-screen pointer-events-none"></div>
                <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/20 rounded-full blur-[80px] mix-blend-screen pointer-events-none"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-orange-500/10 rounded-[100%] blur-[100px] mix-blend-screen pointer-events-none"></div>
            </div>
            
            <div 
                className={`relative w-full max-w-[95vw] xl:max-w-[1300px] h-[85vh] bg-[#0a0a0c]/85 backdrop-blur-2xl rounded-2xl shadow-[0_0_60px_rgba(0,0,0,0.8)] border border-white/10 overflow-hidden flex flex-col transform transition-all duration-500 ease-out ${isOpen ? 'scale-100 opacity-100 translate-y-0' : 'scale-95 opacity-0 translate-y-8'}`}
            >
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center p-4 border-b border-white/5 shrink-0 bg-gradient-to-b from-white/5 to-transparent relative z-20">
                    <div className="flex items-center gap-3">
                        <div className="relative group">
                            <div className="absolute inset-0 bg-gradient-to-r from-orange-500 to-rose-500 rounded-lg blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
                            <div className="relative p-2.5 bg-black rounded-lg border border-white/10">
                                <Flame className="w-5 h-5 text-orange-400" />
                            </div>
                        </div>
                        <div>
                            <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                                Market <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-rose-500">Movers</span>
                            </h2>
                            <p className="text-[10px] sm:text-[11px] font-medium text-gray-400 tracking-wider uppercase mt-0.5 flex items-center gap-1.5">
                                <span className="w-1 h-1 rounded-full bg-green-500 animate-pulse"></span>
                                Live Binance Data Stream
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 mt-3 sm:mt-0">
                        <div className="relative group min-w-[180px]">
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-full blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"></div>
                            <div className="relative flex items-center bg-black/40 border border-white/10 group-focus-within:border-blue-500/50 rounded-full px-3 py-1.5 transition-all shadow-inner">
                                <Search className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-blue-400 transition-colors" />
                                <input 
                                    type="text"
                                    placeholder="Search token..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full bg-transparent border-none text-[11px] font-medium text-white ml-2 focus:outline-none placeholder-gray-600"
                                />
                            </div>
                        </div>

                        <div className="relative group min-w-[120px]">
                            <div className="absolute inset-0 bg-gradient-to-r from-orange-500/20 to-rose-500/20 rounded-full blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"></div>
                            <div className="relative flex items-center bg-black/40 border border-white/10 group-focus-within:border-orange-500/50 rounded-full px-3 py-1.5 transition-all cursor-pointer">
                                <Filter className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-orange-400 transition-colors" />
                                <select 
                                    value={category}
                                    onChange={(e) => setCategory(e.target.value as keyof typeof CATEGORIES)}
                                    className="w-full bg-transparent border-none text-[11px] font-bold text-white ml-1.5 focus:outline-none appearance-none cursor-pointer"
                                >
                                    {Object.keys(CATEGORIES).map(cat => (
                                        <option key={cat} value={cat} className="bg-gray-900 font-bold">{cat} Sector</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Market Filter */}
                        <div className="relative group min-w-[120px]">
                            <div className="absolute inset-0 bg-gradient-to-r from-green-500/20 to-blue-500/20 rounded-full blur opacity-0 group-focus-within:opacity-100 transition-opacity duration-300"></div>
                            <div className="relative flex items-center bg-black/40 border border-white/10 group-focus-within:border-green-500/50 rounded-full px-3 py-1.5 transition-all cursor-pointer">
                                <Activity className="w-3.5 h-3.5 text-gray-400 group-focus-within:text-green-400 transition-colors" />
                                <select 
                                    value={baseMarket}
                                    onChange={(e) => setBaseMarket(e.target.value)}
                                    className="w-full bg-transparent border-none text-[11px] font-bold text-white ml-1.5 focus:outline-none appearance-none cursor-pointer"
                                >
                                    <option value="USDT" className="bg-gray-900 font-bold">USDT Market</option>
                                    <option value="BNB" className="bg-gray-900 font-bold">BNB Market</option>
                                    <option value="BTC" className="bg-gray-900 font-bold">BTC Market</option>
                                    <option value="FDUSD" className="bg-gray-900 font-bold">FDUSD Market</option>
                                    <option value="All" className="bg-gray-900 font-bold">All Market</option>
                                </select>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            className="p-2 ml-1 bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 border border-white/10 hover:border-red-500/50 rounded-full transition-all focus:outline-none"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
                
                <div className="flex-1 p-4 sm:p-5 overflow-hidden relative z-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 sm:gap-5 h-full">
                        {renderTokenList(
                            data.gainers, 
                            "Top Gainers", 
                            <TrendingUp />, 
                            "from-[#4ade80] to-[#22c55e]",
                            "from-green-500 to-emerald-600",
                            "delay-[50ms]"
                        )}
                        {renderTokenList(
                            data.losers, 
                            "Top Losers", 
                            <TrendingDown />, 
                            "from-[#f87171] to-[#ef4444]",
                            "from-red-500 to-rose-600",
                            "delay-[100ms]"
                        )}
                        {renderTokenList(
                            data.hot, 
                            "Hot Tokens", 
                            <Flame />, 
                            "from-[#fb923c] to-[#f97316]",
                            "from-orange-500 to-amber-600",
                            "delay-[150ms]"
                        )}
                        {renderTokenList(
                            data.newTokens, 
                            "Trending / Volatile", 
                            <Sparkles />, 
                            "from-[#c084fc] to-[#a855f7]",
                            "from-purple-500 to-fuchsia-600",
                            "delay-[200ms]"
                        )}
                        {renderTokenList(
                            data.volume, 
                            "Highest Volume", 
                            <BarChart2 />, 
                            "from-[#60a5fa] to-[#3b82f6]",
                            "from-blue-500 to-cyan-600",
                            "delay-[250ms]"
                        )}
                    </div>
                </div>
            </div>
            
            <style dangerouslySetInnerHTML={{__html: `
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { 
                    background-color: rgba(255, 255, 255, 0.15); 
                    border-radius: 10px; 
                }
                .custom-scrollbar:hover::-webkit-scrollbar-thumb { 
                    background-color: rgba(255, 255, 255, 0.3); 
                }
            `}} />
        </div>
    );

    return createPortal(modalContent, document.body);
};
