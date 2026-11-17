import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, X, TrendingUp, TrendingDown, Flame, Sparkles, BarChart2, Search, Filter, Activity, ZoomIn } from 'lucide-react';
import { useBinanceMarketData, TokenData } from '../hooks/useBinanceMarketData';
import { useMarketStore } from '../store/marketStore';
import { useFloatingModalDrag } from '../hooks/useFloatingModalDrag';
import { useDeviceProfile } from '../hooks/useDeviceProfile';
import { FloatingModalCyberFX } from './common/FloatingModalCyberFX';

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

interface MagnifiedTarget {
    token: TokenData;
    listTitle: string;
    rank: number;
    colorClass: string;
    x: number;
    y: number;
}

export const TopTokensModal: React.FC<TopTokensModalProps> = ({ isOpen, onClose }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [category, setCategory] = useState<keyof typeof CATEGORIES>('All');
    const [baseMarket, setBaseMarket] = useState('USDT');
    const [isMagnifyMode, setIsMagnifyMode] = useState(false);
    const [magnifier, setMagnifier] = useState<MagnifiedTarget | null>(null);

    const { isThermalGuardActive } = useDeviceProfile();
    const { modalContainerRef, handleStartDrag, containerStyle } = useFloatingModalDrag({
        isOpen,
        storageKey: 'cosmo_top_tokens_modal_pos_v1',
        defaultWidth: 620,
        defaultHeight: 740,
        maxCapHeight: 778,
        compactMaxCapHeight: 720,
    });

    const data = useBinanceMarketData(isOpen, baseMarket);
    const { setGlobalSymbol } = useMarketStore();

    const gridContainerRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
    const isMagnifyingRef = useRef(false);
    const didMagnifyRef = useRef(false);
    const isMagnifyModeRef = useRef(isMagnifyMode);
    isMagnifyModeRef.current = isMagnifyMode;

    const filterTokens = useCallback((tokens: TokenData[]) => {
        return tokens.filter(t => {
            const symbol = t.symbol.replace('USDT', '');
            const matchesSearch = t.symbol.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = category === 'All' || CATEGORIES[category].includes(symbol);
            return matchesSearch && matchesCategory;
        });
    }, [searchQuery, category]);

    const listSections = useMemo(() => [
        {
            key: 'gainers',
            title: 'Top Gainers',
            tokens: filterTokens(data.gainers),
            icon: <TrendingUp />,
            colorClass: 'from-[#4ade80] to-[#22c55e]',
            glowColor: 'from-green-500 to-emerald-600',
        },
        {
            key: 'losers',
            title: 'Top Losers',
            tokens: filterTokens(data.losers),
            icon: <TrendingDown />,
            colorClass: 'from-[#f87171] to-[#ef4444]',
            glowColor: 'from-red-500 to-rose-600',
        },
        {
            key: 'hot',
            title: 'Hot Tokens',
            tokens: filterTokens(data.hot),
            icon: <Flame />,
            colorClass: 'from-[#fb923c] to-[#f97316]',
            glowColor: 'from-orange-500 to-amber-600',
        },
        {
            key: 'newTokens',
            title: 'Trending / Volatile',
            tokens: filterTokens(data.newTokens),
            icon: <Sparkles />,
            colorClass: 'from-[#c084fc] to-[#a855f7]',
            glowColor: 'from-purple-500 to-fuchsia-600',
        },
        {
            key: 'volume',
            title: 'Highest Volume',
            tokens: filterTokens(data.volume),
            icon: <BarChart2 />,
            colorClass: 'from-[#60a5fa] to-[#3b82f6]',
            glowColor: 'from-blue-500 to-cyan-600',
        },
    ], [data, filterTokens]);

    const tokenLookupMap = useMemo(() => {
        const map = new Map<string, { token: TokenData; listTitle: string; rank: number; colorClass: string }>();
        listSections.forEach(sec => {
            sec.tokens.forEach((tok, idx) => {
                map.set(`${sec.key}:${tok.symbol}`, {
                    token: tok,
                    listTitle: sec.title,
                    rank: idx + 1,
                    colorClass: sec.colorClass,
                });
            });
        });
        return map;
    }, [listSections]);

    const tokenLookupRef = useRef(tokenLookupMap);
    tokenLookupRef.current = tokenLookupMap;

    const clearLongPressTimer = useCallback(() => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    }, []);

    const updateMagnifierAtPoint = useCallback((clientX: number, clientY: number) => {
        if (typeof document === 'undefined') return false;
        const el = document.elementFromPoint(clientX, clientY)?.closest('[data-token-symbol]') as HTMLElement | null;
        if (!el) return false;
        const sym = el.dataset.tokenSymbol;
        const listKey = el.dataset.tokenList;
        if (!sym || !listKey) return false;
        const entry = tokenLookupRef.current.get(`${listKey}:${sym}`);
        if (!entry) return false;
        setMagnifier({
            token: entry.token,
            listTitle: entry.listTitle,
            rank: entry.rank,
            colorClass: entry.colorClass,
            x: clientX,
            y: clientY,
        });
        return true;
    }, []);

    const stopMagnifying = useCallback(() => {
        clearLongPressTimer();
        pointerStartRef.current = null;
        if (isMagnifyingRef.current) {
            isMagnifyingRef.current = false;
            didMagnifyRef.current = true;
            window.setTimeout(() => {
                didMagnifyRef.current = false;
            }, 350);
        }
        setMagnifier(null);
    }, [clearLongPressTimer]);

    // Native non-passive touch listeners so touch-and-hold magnifier locks scroll smoothly on Redmi Pad 2 Pro
    useEffect(() => {
        const gridEl = gridContainerRef.current;
        if (!isOpen || !gridEl) return;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];
            const tokenEl = (e.target as HTMLElement | null)?.closest('[data-token-symbol]') as HTMLElement | null;
            if (!tokenEl) return;

            pointerStartRef.current = { x: touch.clientX, y: touch.clientY };
            clearLongPressTimer();

            if (isMagnifyModeRef.current) {
                isMagnifyingRef.current = true;
                updateMagnifierAtPoint(touch.clientX, touch.clientY);
                return;
            }

            longPressTimerRef.current = window.setTimeout(() => {
                isMagnifyingRef.current = true;
                updateMagnifierAtPoint(touch.clientX, touch.clientY);
            }, 200);
        };

        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            const touch = e.touches[0];

            if (isMagnifyingRef.current) {
                if (e.cancelable) e.preventDefault();
                updateMagnifierAtPoint(touch.clientX, touch.clientY);
                return;
            }

            if (pointerStartRef.current) {
                const dx = touch.clientX - pointerStartRef.current.x;
                const dy = touch.clientY - pointerStartRef.current.y;
                if (Math.hypot(dx, dy) > 14) {
                    clearLongPressTimer();
                    pointerStartRef.current = null;
                }
            }
        };

        const onTouchEndOrCancel = () => {
            stopMagnifying();
        };

        gridEl.addEventListener('touchstart', onTouchStart, { passive: true });
        gridEl.addEventListener('touchmove', onTouchMove, { passive: false });
        gridEl.addEventListener('touchend', onTouchEndOrCancel);
        gridEl.addEventListener('touchcancel', onTouchEndOrCancel);

        return () => {
            clearLongPressTimer();
            gridEl.removeEventListener('touchstart', onTouchStart);
            gridEl.removeEventListener('touchmove', onTouchMove);
            gridEl.removeEventListener('touchend', onTouchEndOrCancel);
            gridEl.removeEventListener('touchcancel', onTouchEndOrCancel);
        };
    }, [isOpen, clearLongPressTimer, updateMagnifierAtPoint, stopMagnifying]);

    // Reset magnifier when modal closes
    useEffect(() => {
        if (!isOpen) {
            stopMagnifying();
        }
    }, [isOpen, stopMagnifying]);

    if (!isOpen || typeof document === 'undefined') return null;

    const getQuoteAndBase = (symbol: string) => {
        let quote = 'USDT';
        if (symbol.endsWith('BNB')) quote = 'BNB';
        else if (symbol.endsWith('BTC')) quote = 'BTC';
        else if (symbol.endsWith('FDUSD')) quote = 'FDUSD';
        else if (symbol.endsWith('USDT')) quote = 'USDT';
        const base = symbol.substring(0, symbol.length - quote.length);
        return { base, quote };
    };

    const handleTokenClick = (symbol: string) => {
        if (didMagnifyRef.current || isMagnifyingRef.current) return;
        const { base, quote } = getQuoteAndBase(symbol);
        setGlobalSymbol(`${base}/${quote}`);
        onClose();
    };

    const renderSparkline = (history: number[], isPositive: boolean, width = 40, height = 16) => {
        if (!history || history.length < 2) return (
            <svg width={width} height={height} className="mx-1.5 shrink-0">
                <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#4b5563" strokeWidth="1" strokeDasharray="2,2" />
            </svg>
        );
        const min = Math.min(...history);
        const max = Math.max(...history);
        const range = max - min || 1;
        const strokeColor = isPositive ? '#22c55e' : '#ef4444';
        const fillColor = isPositive ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        const pad = 2;
        const linePoints = history
            .map((val, i) => `${(i / (history.length - 1)) * width},${height - pad - ((val - min) / range) * (height - pad * 2)}`)
            .join(' ');
        const areaPoints = `${linePoints} ${width},${height} 0,${height}`;

        return (
            <div className="relative mx-1.5 flex items-center justify-center shrink-0">
                <div className="absolute inset-0 blur-[4px] opacity-35" style={{ background: strokeColor }} />
                <svg width={width} height={height} className="relative z-10 overflow-visible">
                    <polygon points={areaPoints} fill={fillColor} />
                    <polyline points={linePoints} fill="none" stroke={strokeColor} strokeWidth={width > 80 ? '2.2' : '1.2'} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
        );
    };

    const renderMagnifierOverlay = () => {
        if (!magnifier) return null;
        const { token, listTitle, rank, colorClass, x, y } = magnifier;
        const isPositive = token.priceChangePercent >= 0;
        const { base, quote } = getQuoteAndBase(token.symbol);
        const buyPct = Math.round(token.buyPressure ?? 50);
        const sellPct = 100 - buyPct;

        const winW = window.visualViewport?.width || window.innerWidth;
        const winH = window.visualViewport?.height || window.innerHeight;
        const lensW = Math.min(308, winW - 20);
        const lensH = 196;
        const left = Math.max(10, Math.min(winW - lensW - 10, Math.round(x - lensW / 2)));
        // Place magnifier comfortably above the touch finger, or below if too close to top
        const top = y - lensH - 34 >= 10
            ? Math.round(y - lensH - 34)
            : Math.min(winH - lensH - 10, Math.round(y + 42));

        return createPortal(
            <div
                style={{ left: `${left}px`, top: `${top}px`, width: `${lensW}px` }}
                className="fixed z-[100020] pointer-events-none select-none rounded-2xl border-2 border-cyan-400/75 bg-[#060a14]/98 shadow-[0_20px_50px_rgba(0,0,0,0.94),0_0_28px_rgba(34,211,238,0.35)] overflow-hidden"
            >
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-orange-400 to-rose-500" />
                <div className="p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/20 border border-cyan-400/45 text-cyan-300 text-[10px] font-mono font-black uppercase tracking-wider">
                            <ZoomIn className="w-3 h-3" />
                            2.2x Magnifier
                        </span>
                        <span className={`text-[11px] font-extrabold bg-clip-text text-transparent bg-gradient-to-r ${colorClass}`}>
                            #{rank} • {listTitle}
                        </span>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="text-2xl font-black text-white tracking-tight truncate">{base}</span>
                            <span className="text-xs font-mono font-bold text-gray-400">/{quote}</span>
                        </div>
                        <div className="text-right shrink-0">
                            <div className="text-lg font-mono font-black text-white leading-tight">
                                ${token.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                            </div>
                            <div className={`inline-flex items-center gap-1 text-sm font-black ${isPositive ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                                <span>{isPositive ? '+' : '-'}{Math.abs(token.priceChangePercent).toFixed(2)}%</span>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-center py-1 px-2 rounded-xl bg-white/[0.04] border border-white/10">
                        {renderSparkline(token.priceHistory, isPositive, 260, 48)}
                    </div>

                    <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-mono font-black">
                            <span className="text-[#4ade80]">BUY {buyPct}%</span>
                            <span className="text-[#f87171]">{sellPct}% SELL</span>
                        </div>
                        <div className="w-full h-2 bg-black/70 rounded-full overflow-hidden flex border border-white/10">
                            <div className="h-full bg-[#4ade80] shadow-[0_0_6px_#4ade80]" style={{ width: `${buyPct}%` }} />
                            <div className="h-full bg-[#f87171] shadow-[0_0_6px_#f87171]" style={{ width: `${sellPct}%` }} />
                        </div>
                    </div>
                </div>
            </div>,
            document.body
        );
    };

    const modalContent = (
        <>
            <div
                ref={modalContainerRef}
                style={containerStyle}
                className={`cosmo-theme-modal fixed w-[620px] max-w-[calc(100vw-12px)] h-[740px] rounded-xl border z-[99999] overflow-hidden transition-colors duration-200 select-none flex flex-col ${
                    isThermalGuardActive ? 'animate-cosmo-modal-fast' : 'animate-cosmo-modal-orange'
                } ${
                    isThermalGuardActive
                        ? 'bg-[#080c16] border-orange-500/45 shadow-[0_14px_36px_rgba(0,0,0,0.92)]'
                        : 'bg-[#070b14] bg-gradient-to-b from-[#0c1220]/95 via-[#080d1a]/[0.98] to-[#050811]/[0.98] border-orange-500/35 shadow-[0_14px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(249,115,22,0.18),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-2xl'
                }`}
            >
                <FloatingModalCyberFX color="orange" isThermalGuard={isThermalGuardActive} />

                {/* Top Neon Accent Line */}
                <div className="h-[1.5px] w-full bg-gradient-to-r from-transparent via-orange-400 to-rose-500 opacity-85 shrink-0" />

                {/* Draggable Header */}
                <div
                    onMouseDown={handleStartDrag}
                    onTouchStart={handleStartDrag}
                    style={{ touchAction: 'none' }}
                    className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.03] cursor-grab active:cursor-grabbing select-none shrink-0"
                    title="Drag to move Top Tokens Dashboard"
                >
                    <div className="flex items-center gap-2 pointer-events-none min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-orange-400/80 shrink-0" />
                        <div className="p-1.5 bg-black/80 rounded-lg border border-orange-500/30 shrink-0">
                            <Flame className="w-4 h-4 text-orange-400" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-[13px] sm:text-[14.5px] font-black tracking-tight text-white flex items-center gap-1.5 truncate">
                                Market <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-400 to-rose-500">Movers</span>
                            </h2>
                            <p className="text-[9.5px] font-medium text-gray-400 tracking-wider uppercase flex items-center gap-1.5 truncate">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                                Live Binance • Hold token to Magnify
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                setIsMagnifyMode(prev => {
                                    if (prev) stopMagnifying();
                                    return !prev;
                                });
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider border transition-all cursor-pointer ${
                                isMagnifyMode
                                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 shadow-[0_0_10px_rgba(34,211,238,0.35)]'
                                    : 'bg-white/[0.04] hover:bg-cyan-500/15 border-white/10 text-gray-300 hover:text-cyan-300'
                            }`}
                            title="Toggle Touch/Hover Magnifier Glass (or touch & hold any token)"
                        >
                            <ZoomIn className="w-3.5 h-3.5" />
                            <span>Magnify {isMagnifyMode ? 'ON' : ''}</span>
                        </button>
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-1 rounded-md bg-white/[0.04] hover:bg-rose-500/20 border border-white/[0.08] hover:border-rose-500/40 text-gray-400 hover:text-rose-300 transition-all cursor-pointer shrink-0"
                            title="Close Top Tokens Dashboard"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Compact Filter Toolbar */}
                <div className="px-3 py-2 border-b border-white/10 bg-[#050811]/80 flex flex-wrap items-center gap-2 shrink-0">
                    <div className="relative flex-1 min-w-[150px] flex items-center bg-black/50 border border-white/10 focus-within:border-blue-500/50 rounded-lg px-2.5 py-1.5">
                        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <input
                            type="text"
                            placeholder="Search token..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full bg-transparent border-none text-[12px] font-medium text-white ml-2 focus:outline-none placeholder-gray-600"
                        />
                    </div>

                    <div className="flex items-center bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 min-w-[115px]">
                        <Filter className="w-3.5 h-3.5 text-orange-400/80 shrink-0" />
                        <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value as keyof typeof CATEGORIES)}
                            className="w-full bg-transparent border-none text-[11.5px] font-bold text-white ml-1.5 focus:outline-none appearance-none cursor-pointer"
                        >
                            {Object.keys(CATEGORIES).map(cat => (
                                <option key={cat} value={cat} className="bg-gray-900 font-bold">{cat} Sector</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 min-w-[115px]">
                        <Activity className="w-3.5 h-3.5 text-green-400/80 shrink-0" />
                        <select
                            value={baseMarket}
                            onChange={(e) => setBaseMarket(e.target.value)}
                            className="w-full bg-transparent border-none text-[11.5px] font-bold text-white ml-1.5 focus:outline-none appearance-none cursor-pointer"
                        >
                            <option value="USDT" className="bg-gray-900 font-bold">USDT Market</option>
                            <option value="BNB" className="bg-gray-900 font-bold">BNB Market</option>
                            <option value="BTC" className="bg-gray-900 font-bold">BTC Market</option>
                            <option value="FDUSD" className="bg-gray-900 font-bold">FDUSD Market</option>
                            <option value="All" className="bg-gray-900 font-bold">All Market</option>
                        </select>
                    </div>
                </div>

                {/* Scrollable Token Lists Grid */}
                <div
                    ref={gridContainerRef}
                    style={{ touchAction: 'pan-y' }}
                    onContextMenu={(e) => e.preventDefault()}
                    onMouseLeave={() => {
                        if (isMagnifyMode) stopMagnifying();
                    }}
                    className="flex-1 min-h-0 overflow-y-auto p-3 custom-scrollbar"
                >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {listSections.map((sec, secIdx) => (
                            <div
                                key={sec.key}
                                className={`relative group flex flex-col h-[265px] overflow-hidden rounded-xl border border-white/10 bg-black/60 ${secIdx === 4 ? 'sm:col-span-2' : ''}`}
                            >
                                <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-white/[0.02] shrink-0">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-1 rounded-md bg-gradient-to-br ${sec.glowColor} border border-white/10`}>
                                            {React.cloneElement(sec.icon as React.ReactElement<any>, { className: 'w-3.5 h-3.5 text-white' })}
                                        </div>
                                        <h3 className={`font-bold text-[12.5px] tracking-wide bg-clip-text text-transparent bg-gradient-to-r ${sec.colorClass}`}>
                                            {sec.title}
                                        </h3>
                                    </div>
                                    <span className="text-[10px] font-mono text-gray-500">{sec.tokens.length}</span>
                                </div>

                                <div className="flex-1 min-h-0 overflow-y-auto p-2 custom-scrollbar space-y-1.5">
                                    {sec.tokens.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-1.5">
                                            <Activity className="w-5 h-5 opacity-25 animate-pulse" />
                                            <span className="text-[10px] uppercase tracking-widest font-bold">No Data</span>
                                        </div>
                                    ) : (
                                        sec.tokens.map((token, index) => {
                                            const isPositive = token.priceChangePercent >= 0;
                                            return (
                                                <button
                                                    key={token.symbol}
                                                    type="button"
                                                    data-token-symbol={token.symbol}
                                                    data-token-list={sec.key}
                                                    data-token-rank={index + 1}
                                                    style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                                                    onContextMenu={(e) => e.preventDefault()}
                                                    onClick={() => handleTokenClick(token.symbol)}
                                                    onMouseDown={(e) => {
                                                        if (e.button !== 0) return;
                                                        clearLongPressTimer();
                                                        const cx = e.clientX;
                                                        const cy = e.clientY;
                                                        longPressTimerRef.current = window.setTimeout(() => {
                                                            isMagnifyingRef.current = true;
                                                            updateMagnifierAtPoint(cx, cy);
                                                        }, 220);
                                                    }}
                                                    onMouseMove={(e) => {
                                                        if (isMagnifyMode || isMagnifyingRef.current) {
                                                            updateMagnifierAtPoint(e.clientX, e.clientY);
                                                        }
                                                    }}
                                                    onMouseUp={() => stopMagnifying()}
                                                    className="relative w-full flex flex-col p-2 rounded-lg bg-white/5 hover:bg-white/10 border border-transparent hover:border-white/15 transition-colors group/btn cursor-pointer overflow-hidden select-none text-left"
                                                >
                                                    <div className="flex justify-between items-center w-full relative z-10 gap-1">
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            <span className="text-gray-500 font-mono text-[10px] w-4 text-left shrink-0">{index + 1}.</span>
                                                            <span className="font-bold text-[12px] text-gray-200 group-hover/btn:text-white transition-colors tracking-wide truncate max-w-[78px]">
                                                                {baseMarket === 'All' ? token.symbol : token.symbol.replace(baseMarket, '')}
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center shrink-0">
                                                            {renderSparkline(token.priceHistory, isPositive)}
                                                            <div className="flex flex-col items-end min-w-[62px]">
                                                                <span className="text-[11.5px] font-mono font-bold text-white tracking-tight">
                                                                    ${token.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                                                                </span>
                                                                <div className={`flex items-center gap-0.5 text-[10px] font-bold ${isPositive ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                                                    {isPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                                    <span>{Math.abs(token.priceChangePercent).toFixed(2)}%</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="w-full mt-1.5 flex items-center gap-1.5 opacity-65 group-hover/btn:opacity-100 transition-opacity relative z-10">
                                                        <span className="text-[8px] font-black tracking-widest text-[#4ade80] w-5">BUY</span>
                                                        <div className="flex-1 h-1 bg-black/50 rounded-full overflow-hidden flex border border-white/5">
                                                            <div className="h-full bg-[#4ade80]" style={{ width: `${token.buyPressure ?? 50}%` }} />
                                                            <div className="h-full bg-[#f87171]" style={{ width: `${100 - (token.buyPressure ?? 50)}%` }} />
                                                        </div>
                                                        <span className="text-[8px] font-black tracking-widest text-[#f87171] w-5 text-right">SELL</span>
                                                    </div>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
            {renderMagnifierOverlay()}
        </>
    );

    return createPortal(modalContent, document.body);
};
