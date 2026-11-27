import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../services/api';
import { Search, ChevronDown, Check, Activity, Star, Clock, X, Layers } from 'lucide-react';
import CoinLogo, { ensureCoinLogoMapLoaded } from '@/components/common/CoinLogo';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export interface HeatmapSymbolSelectorProps {
    symbol: string;
    exchange: string;
    onSymbolChange: (newSymbol: string) => void;
    onExchangeChange: (newExchange: string) => void;
    compact?: boolean;
}

type MarketFilterTab = 'all' | 'favorites' | 'spot' | 'futures';

interface SavedPairEntry {
    exchange: string;
    symbol: string;
}

const FAV_STORAGE_KEY = 'cosmo_fav_pairs_v1';
const RECENT_STORAGE_KEY = 'cosmo_recent_pairs_v1';

const EXCHANGE_META: Record<string, { label: string; tag: string; dot: string }> = {
    binance:  { label: 'Binance',  tag: 'Spot · Perp', dot: 'bg-amber-400' },
    bybit:    { label: 'Bybit',    tag: 'Spot · Perp', dot: 'bg-orange-400' },
    okx:      { label: 'OKX',      tag: 'Spot · Perp', dot: 'bg-sky-400' },
    kucoin:   { label: 'KuCoin',   tag: 'Spot · Perp', dot: 'bg-emerald-400' },
    kraken:   { label: 'Kraken',   tag: 'Spot · Perp', dot: 'bg-violet-400' },
    coinbase: { label: 'Coinbase', tag: 'Spot',        dot: 'bg-blue-500' },
    gate:     { label: 'Gate.io',  tag: 'Spot · Perp', dot: 'bg-teal-400' },
    bitfinex: { label: 'Bitfinex', tag: 'Spot',        dot: 'bg-lime-400' },
    htx:      { label: 'HTX',      tag: 'Spot',        dot: 'bg-cyan-400' },
    mexc:     { label: 'MEXC',     tag: 'Spot',        dot: 'bg-indigo-400' },
    oanda:    { label: 'OANDA',    tag: 'Forex FX',    dot: 'bg-emerald-500' },
};

function loadSavedList(key: string): SavedPairEntry[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (item): item is SavedPairEntry =>
                item && typeof item.exchange === 'string' && typeof item.symbol === 'string'
        );
    } catch {
        return [];
    }
}

function saveList(key: string, items: SavedPairEntry[]) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(key, JSON.stringify(items));
    } catch {}
}

function normalizeSearchToken(value: string): string {
    return value.toLowerCase().replace(/[\s/_\-:]+/g, '');
}

export const HeatmapSymbolSelector: React.FC<HeatmapSymbolSelectorProps> = ({
    symbol,
    exchange,
    onSymbolChange,
    onExchangeChange,
    compact = false,
}) => {
    const [exchanges, setExchanges] = useState<string[]>(['binance']);
    const [markets, setMarkets] = useState<string[]>(['BTC/USDT']);
    const [loadingMarkets, setLoadingMarkets] = useState(false);

    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [browsingExchange, setBrowsingExchange] = useState<string>(exchange);
    const [activeTab, setActiveTab] = useState<MarketFilterTab>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [highlightedIndex, setHighlightedIndex] = useState(0);
    const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 480 });

    const [favorites, setFavorites] = useState<SavedPairEntry[]>(() => loadSavedList(FAV_STORAGE_KEY));
    const [recents, setRecents] = useState<SavedPairEntry[]>(() => loadSavedList(RECENT_STORAGE_KEY));

    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const symbolRef = useRef<string>(symbol);
    symbolRef.current = symbol;
    const onSymbolChangeRef = useRef(onSymbolChange);
    onSymbolChangeRef.current = onSymbolChange;

    const isTouchDevice =
        typeof window !== 'undefined' &&
        ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));
    const thermalGuard = isThermalGuardActive();

    const isForexVenue = browsingExchange.toLowerCase() === 'oanda';

    // Keep browsingExchange synced with active exchange whenever prop changes or dropdown closes
    useEffect(() => {
        setBrowsingExchange(exchange);
    }, [exchange]);

    useEffect(() => {
        if (!isDropdownOpen) {
            setBrowsingExchange(exchange);
            setHighlightedIndex(0);
        }
    }, [isDropdownOpen, exchange]);

    // Reset spot/futures filter when switching to OANDA
    useEffect(() => {
        if (isForexVenue && (activeTab === 'spot' || activeTab === 'futures')) {
            setActiveTab('all');
        }
    }, [isForexVenue, activeTab]);

    const computeDropdownPosition = useCallback(() => {
        if (!triggerRef.current || typeof window === 'undefined') return;
        const rect = triggerRef.current.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const desiredWidth = compact ? Math.min(390, vw - 16) : Math.min(500, vw - 16);
        const clampedLeft = Math.max(8, Math.min(rect.left, vw - desiredWidth - 8));
        const estimatedHeight = compact ? 360 : 475;
        const spaceBelow = vh - rect.bottom - 10;
        const top =
            spaceBelow < 240 && rect.top > estimatedHeight * 0.65
                ? Math.max(8, rect.top - estimatedHeight - 8)
                : rect.bottom + 8;

        setDropdownPos({ top, left: clampedLeft, width: desiredWidth });
    }, [compact]);

    const openDropdown = () => {
        ensureCoinLogoMapLoaded();
        computeDropdownPosition();
        setSearchQuery('');
        setHighlightedIndex(0);
        setIsDropdownOpen(true);
    };

    // Close on outside click or Escape key
    useEffect(() => {
        if (!isDropdownOpen) return;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (
                triggerRef.current &&
                !triggerRef.current.contains(target) &&
                dropdownRef.current &&
                !dropdownRef.current.contains(target)
            ) {
                setIsDropdownOpen(false);
            }
        };
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [isDropdownOpen]);

    // Reposition portal on external scroll/resize (ignore scrolls inside the dropdown list itself for 60fps perf)
    useEffect(() => {
        if (!isDropdownOpen) return;
        const handleScroll = (event: Event) => {
            if (dropdownRef.current && event.target instanceof Node && dropdownRef.current.contains(event.target)) {
                return;
            }
            computeDropdownPosition();
        };
        const handleResize = () => computeDropdownPosition();
        window.addEventListener('scroll', handleScroll, true);
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('scroll', handleScroll, true);
            window.removeEventListener('resize', handleResize);
        };
    }, [isDropdownOpen, computeDropdownPosition]);

    // Auto-focus search on desktop when opened
    useEffect(() => {
        if (isDropdownOpen && !isTouchDevice) {
            requestAnimationFrame(() => searchInputRef.current?.focus());
        }
    }, [isDropdownOpen, isTouchDevice]);

    // Fetch exchanges on mount
    useEffect(() => {
        const fetchExchanges = async () => {
            try {
                const res = await api.get('/market-depth/exchanges');
                if (res.data && Array.isArray(res.data)) {
                    setExchanges(res.data);
                }
            } catch (err) {
                console.error('Failed to fetch exchanges:', err);
            }
        };
        fetchExchanges();
    }, []);

    // Fetch markets for the currently browsed exchange
    useEffect(() => {
        const targetExchange = browsingExchange || exchange;
        if (!targetExchange) return;
        let isCancelled = false;

        const pickFallbackSymbol = (pairs: string[], ex: string): string | null => {
            if (!pairs.length) return null;
            const preferred =
                ex.toLowerCase() === 'oanda'
                    ? ['EUR/USD', 'GBP/USD', 'USD/JPY']
                    : ['BTC/USDT', 'BTC/USDT:USDT', 'BTC/USD', 'ETH/USDT', 'ETH/USD'];
            for (const cand of preferred) {
                const match = pairs.find((p) => p.toUpperCase() === cand);
                if (match) return match;
            }
            return pairs[0];
        };

        const reconcileSymbolForActiveExchange = (pairs: string[]) => {
            if (targetExchange !== exchange || !pairs.length) return;
            const currentSym = (symbolRef.current || '').toUpperCase();
            const exists = pairs.some((p) => p.toUpperCase() === currentSym);
            if (!exists) {
                const fallback = pickFallbackSymbol(pairs, targetExchange);
                if (fallback) {
                    onSymbolChangeRef.current(fallback);
                }
            }
        };

        const fetchMarkets = async () => {
            const cacheKey = `cached_markets_${targetExchange.toLowerCase()}`;
            let hadCache = false;
            try {
                const cached = sessionStorage.getItem(cacheKey);
                if (cached) {
                    const parsed = JSON.parse(cached);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        setMarkets(parsed);
                        hadCache = true;
                        reconcileSymbolForActiveExchange(parsed);
                    }
                }
            } catch {}

            if (!hadCache) {
                setMarkets([]);
            }

            setLoadingMarkets(true);
            try {
                const res = await api.get('/market-depth/markets', { params: { exchange: targetExchange } });
                if (isCancelled) return;
                if (res.data && Array.isArray(res.data) && res.data.length > 0) {
                    const allPairs = [...res.data].sort();
                    setMarkets(allPairs);
                    reconcileSymbolForActiveExchange(allPairs);
                    try {
                        sessionStorage.setItem(cacheKey, JSON.stringify(allPairs));
                    } catch {}
                } else if (!hadCache) {
                    setMarkets([]);
                }
            } catch (err) {
                if (!isCancelled) {
                    console.error(`Failed to fetch markets for ${targetExchange}:`, err);
                    if (!hadCache) setMarkets([]);
                }
            } finally {
                if (!isCancelled) setLoadingMarkets(false);
            }
        };
        fetchMarkets();

        return () => {
            isCancelled = true;
        };
    }, [browsingExchange, exchange]);

    // Preload CoinGecko cached symbol -> logo map
    useEffect(() => {
        ensureCoinLogoMapLoaded();
    }, []);

    const isFavorited = useCallback(
        (ex: string, sym: string) =>
            favorites.some(
                (f) => f.exchange.toLowerCase() === ex.toLowerCase() && f.symbol.toUpperCase() === sym.toUpperCase()
            ),
        [favorites]
    );

    const toggleFavorite = useCallback((ex: string, sym: string, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        setFavorites((prev) => {
            const exists = prev.some(
                (f) => f.exchange.toLowerCase() === ex.toLowerCase() && f.symbol.toUpperCase() === sym.toUpperCase()
            );
            const next = exists
                ? prev.filter(
                      (f) =>
                          !(
                              f.exchange.toLowerCase() === ex.toLowerCase() &&
                              f.symbol.toUpperCase() === sym.toUpperCase()
                          )
                  )
                : [{ exchange: ex.toLowerCase(), symbol: sym }, ...prev].slice(0, 40);
            saveList(FAV_STORAGE_KEY, next);
            return next;
        });
    }, []);

    const commitPairSelection = useCallback(
        (targetEx: string, targetSym: string) => {
            const normEx = targetEx.toLowerCase();
            if (normEx !== exchange.toLowerCase()) {
                onExchangeChange(normEx);
            }
            onSymbolChange(targetSym);
            setIsDropdownOpen(false);
            setRecents((prev) => {
                const filtered = prev.filter(
                    (r) =>
                        !(
                            r.exchange.toLowerCase() === normEx &&
                            r.symbol.toUpperCase() === targetSym.toUpperCase()
                        )
                );
                const next = [{ exchange: normEx, symbol: targetSym }, ...filtered].slice(0, 6);
                saveList(RECENT_STORAGE_KEY, next);
                return next;
            });
        },
        [exchange, onExchangeChange, onSymbolChange]
    );

    // Filtered rows (supports slash-less search like "btcusdt", "solperp", "eurusd", plus Watchlist tab across all venues)
    const { visibleRows, totalMatchingCount, spotCount, futuresCount } = useMemo(() => {
        const qRaw = searchQuery.trim().toLowerCase();
        const qCompact = normalizeSearchToken(qRaw);
        const wantsPerp = qRaw.includes('perp') || qRaw.includes('fut');
        const qClean = qCompact.replace(/(perp|fut)$/g, '');

        let sCount = 0;
        let fCount = 0;
        for (let i = 0; i < markets.length; i++) {
            if (markets[i].includes(':')) fCount++;
            else sCount++;
        }

        const sourceRows: SavedPairEntry[] =
            activeTab === 'favorites'
                ? favorites
                : markets
                      .filter((m) => {
                          if (activeTab === 'spot') return !m.includes(':');
                          if (activeTab === 'futures') return m.includes(':');
                          return true;
                      })
                      .map((m) => ({ exchange: browsingExchange, symbol: m }));

        const matches = qRaw
            ? sourceRows
                  .filter((row) => {
                      const symLower = row.symbol.toLowerCase();
                      const symCompact = normalizeSearchToken(row.symbol);
                      const baseSym = row.symbol.split('/')[0]?.toLowerCase() || '';
                      if (wantsPerp && !row.symbol.includes(':')) return false;
                      if (!qClean) return true;
                      return (
                          symLower.includes(qRaw) ||
                          symCompact.includes(qClean) ||
                          baseSym.startsWith(qClean) ||
                          (activeTab === 'favorites' && row.exchange.toLowerCase().includes(qRaw))
                      );
                  })
                  .sort((a, b) => {
                      const aBase = (a.symbol.split('/')[0] || '').toLowerCase();
                      const bBase = (b.symbol.split('/')[0] || '').toLowerCase();
                      const aExact = aBase === qClean ? 0 : aBase.startsWith(qClean) ? 1 : 2;
                      const bExact = bBase === qClean ? 0 : bBase.startsWith(qClean) ? 1 : 2;
                      if (aExact !== bExact) return aExact - bExact;
                      // Prioritize USDT pairs for fast trader ergonomics
                      const aUsdt = a.symbol.includes('/USDT') ? 0 : 1;
                      const bUsdt = b.symbol.includes('/USDT') ? 0 : 1;
                      if (aUsdt !== bUsdt) return aUsdt - bUsdt;
                      return a.symbol.localeCompare(b.symbol);
                  })
            : activeTab === 'favorites'
              ? sourceRows
              : [...sourceRows].sort((a, b) => {
                    // Surface favorites first, then major USDT pairs
                    const aFav = isFavorited(a.exchange, a.symbol) ? 0 : 1;
                    const bFav = isFavorited(b.exchange, b.symbol) ? 0 : 1;
                    if (aFav !== bFav) return aFav - bFav;
                    const majors = ['BTC/USDT', 'BTC/USDT:USDT', 'ETH/USDT', 'ETH/USDT:USDT', 'SOL/USDT', 'SOL/USDT:USDT', 'DOGE/USDT', 'DOGE/USDT:USDT', 'EUR/USD', 'GBP/USD', 'USD/JPY'];
                    const aMaj = majors.indexOf(a.symbol);
                    const bMaj = majors.indexOf(b.symbol);
                    if (aMaj !== -1 || bMaj !== -1) {
                        return (aMaj === -1 ? 999 : aMaj) - (bMaj === -1 ? 999 : bMaj);
                    }
                    return a.symbol.localeCompare(b.symbol);
                });

        return {
            visibleRows: matches.slice(0, thermalGuard ? 60 : 120),
            totalMatchingCount: matches.length,
            spotCount: sCount,
            futuresCount: fCount,
        };
    }, [markets, favorites, activeTab, browsingExchange, searchQuery, thermalGuard, isFavorited]);

    // Keep highlighted index valid when results change
    useEffect(() => {
        setHighlightedIndex(0);
    }, [searchQuery, activeTab, browsingExchange]);

    // Scroll highlighted row into view during keyboard navigation
    useEffect(() => {
        if (!isDropdownOpen) return;
        const el = itemRefs.current[highlightedIndex];
        if (el) {
            el.scrollIntoView({ block: 'nearest' });
        }
    }, [highlightedIndex, isDropdownOpen]);

    // Global keyboard navigation while dropdown is open (works even after clicking venue or filter tabs)
    useEffect(() => {
        if (!isDropdownOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIndex((prev) => (visibleRows.length > 0 ? (prev + 1) % visibleRows.length : 0));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIndex((prev) =>
                    visibleRows.length > 0 ? (prev - 1 + visibleRows.length) % visibleRows.length : 0
                );
            } else if (e.key === 'Enter') {
                // Allow normal clicks on focused venue/tab buttons unless user is in search input or body
                const activeEl = document.activeElement;
                const isSearchFocused = activeEl === searchInputRef.current;
                const isInsideDropdownButton =
                    activeEl &&
                    activeEl.tagName === 'BUTTON' &&
                    dropdownRef.current?.contains(activeEl);
                if (!isSearchFocused && isInsideDropdownButton) return;
                e.preventDefault();
                const chosen = visibleRows[highlightedIndex] || visibleRows[0];
                if (chosen) {
                    commitPairSelection(chosen.exchange, chosen.symbol);
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isDropdownOpen, visibleRows, highlightedIndex, commitPairSelection]);

    const getMarketBadge = (sym: string, ex: string) => {
        if (ex.toLowerCase() === 'oanda') {
            return (
                <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 font-mono font-black tracking-wider uppercase shrink-0">
                    FX
                </span>
            );
        }
        if (sym.includes(':')) {
            return (
                <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 font-mono font-black tracking-wider uppercase shrink-0">
                    PERP
                </span>
            );
        }
        return (
            <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border border-cyan-500/25 font-mono font-black tracking-wider uppercase shrink-0">
                SPOT
            </span>
        );
    };

    const renderSymbolPairText = (sym: string, isTrigger = false) => {
        const displaySym = sym.replace(/:.*/, '');
        if (!displaySym.includes('/')) {
            return (
                <span className={`font-mono font-black tracking-tight text-slate-900 dark:text-white truncate ${isTrigger ? (compact ? 'text-xs' : 'text-[13.5px]') : 'text-xs'}`}>
                    {displaySym}
                </span>
            );
        }
        const [base, quote] = displaySym.split('/');
        return (
            <span className="flex items-baseline font-mono truncate">
                <span className={`font-black tracking-tight text-slate-900 dark:text-white ${isTrigger ? (compact ? 'text-xs' : 'text-[13.5px]') : 'text-[12.5px]'}`}>
                    {base}
                </span>
                <span className={`font-semibold text-slate-400 dark:text-slate-500 ${isTrigger ? 'text-[10px]' : 'text-[10px]'}`}>
                    /{quote}
                </span>
            </span>
        );
    };

    const activeVenueMeta = EXCHANGE_META[exchange.toLowerCase()] || {
        label: exchange,
        tag: 'Exchange',
        dot: 'bg-cyan-400',
    };

    const dropdownPortal = isDropdownOpen ? (
        <div
            ref={dropdownRef}
            style={{
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: dropdownPos.width,
                position: 'fixed',
                zIndex: 200000,
            }}
            className={`rounded-2xl overflow-hidden border border-slate-200 dark:border-white/15 bg-white dark:bg-[#070b14] ${
                thermalGuard ? '' : 'dark:bg-[#070b14]/95 backdrop-blur-2xl'
            } shadow-[0_24px_60px_-12px_rgba(0,0,0,0.28)] dark:shadow-[0_28px_70px_-12px_rgba(0,0,0,0.85)]`}
        >
            {/* Top Accent Hairline */}
            <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-85" />

            {/* Search Header */}
            <div className={`${compact ? 'p-2' : 'p-3'} border-b border-slate-100 dark:border-white/10 bg-slate-50/70 dark:bg-black/30`}>
                <div className="relative flex items-center bg-white dark:bg-[#0b101d] border border-slate-200 dark:border-white/10 focus-within:border-cyan-500/70 focus-within:ring-2 focus-within:ring-cyan-500/20 rounded-xl transition-all">
                    <Search size={compact ? 14 : 16} className="ml-3 text-slate-400 shrink-0" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search pair (e.g. btcusdt, sol perp, eurusd)..."
                        className={`w-full bg-transparent font-mono font-medium text-slate-900 dark:text-white outline-none placeholder-slate-400 dark:placeholder-slate-500 ${
                            compact ? 'px-2 py-2 text-xs' : 'px-2.5 py-2.5 text-[13px]'
                        }`}
                    />
                    {searchQuery ? (
                        <button
                            type="button"
                            onClick={() => {
                                setSearchQuery('');
                                searchInputRef.current?.focus();
                            }}
                            className="mr-2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
                            title="Clear search"
                        >
                            <X size={13} />
                        </button>
                    ) : (
                        <span className="mr-2.5 hidden sm:inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[9px] font-mono font-bold text-slate-400">
                            ESC
                        </span>
                    )}
                </div>

                {/* Quick Filter Tabs */}
                <div className="flex items-center justify-between gap-1.5 mt-2">
                    <div className="flex items-center gap-1 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setActiveTab('all')}
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors ${
                                activeTab === 'all'
                                    ? 'bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                            }`}
                        >
                            All
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('favorites')}
                            className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold flex items-center gap-1 transition-colors ${
                                activeTab === 'favorites'
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                            }`}
                        >
                            <Star size={10} className={activeTab === 'favorites' ? 'fill-slate-950' : 'text-amber-400'} />
                            Watchlist
                            {favorites.length > 0 && (
                                <span className={`text-[9px] px-1 rounded ${activeTab === 'favorites' ? 'bg-black/15' : 'bg-slate-200 dark:bg-white/10'}`}>
                                    {favorites.length}
                                </span>
                            )}
                        </button>
                        {!isForexVenue && spotCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setActiveTab('spot')}
                                className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors ${
                                    activeTab === 'spot'
                                        ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                                }`}
                            >
                                Spot <span className="opacity-60">({spotCount})</span>
                            </button>
                        )}
                        {!isForexVenue && futuresCount > 0 && (
                            <button
                                type="button"
                                onClick={() => setActiveTab('futures')}
                                className={`px-2 py-1 rounded-lg text-[10px] font-mono font-bold transition-colors ${
                                    activeTab === 'futures'
                                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40'
                                        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-white/10'
                                }`}
                            >
                                Perp <span className="opacity-60">({futuresCount})</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* Recent Pairs Strip */}
                {recents.length > 0 && !searchQuery && (
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-200/60 dark:border-white/5 overflow-x-auto custom-scrollbar">
                        <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400 shrink-0">
                            <Clock size={10} />
                            Recent
                        </span>
                        {recents.map((item) => {
                            const isCurrent =
                                item.exchange.toLowerCase() === exchange.toLowerCase() &&
                                item.symbol.toUpperCase() === symbol.toUpperCase();
                            const shortSym = item.symbol.replace(/:.*/, '');
                            return (
                                <button
                                    key={`${item.exchange}:${item.symbol}`}
                                    type="button"
                                    onClick={() => commitPairSelection(item.exchange, item.symbol)}
                                    className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold shrink-0 border transition-colors ${
                                        isCurrent
                                            ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-700 dark:text-cyan-300'
                                            : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:border-cyan-500/40'
                                    }`}
                                >
                                    <span>{shortSym}</span>
                                    {item.symbol.includes(':') && (
                                        <span className="text-[8px] text-amber-500 font-black">P</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Two-Column Body */}
            <div className={`flex ${compact ? 'h-[225px]' : 'h-[320px]'}`}>
                {/* Left Venue Rail */}
                <div
                    className={`${
                        compact ? 'w-[112px] p-1.5' : 'w-[146px] p-2'
                    } bg-slate-50/90 dark:bg-[#050810] border-r border-slate-100 dark:border-white/10 flex flex-col gap-0.5 overflow-y-auto custom-scrollbar shrink-0`}
                >
                    <div className="text-[9px] font-mono font-black uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500 px-2 py-1.5 flex items-center gap-1.5">
                        <Layers size={10} />
                        Venues
                    </div>
                    {exchanges.map((ex) => {
                        const meta = EXCHANGE_META[ex.toLowerCase()] || {
                            label: ex,
                            tag: 'Market',
                            dot: 'bg-slate-400',
                        };
                        const isBrowsing = browsingExchange.toLowerCase() === ex.toLowerCase() && activeTab !== 'favorites';
                        const isActiveVenue = exchange.toLowerCase() === ex.toLowerCase();
                        return (
                            <button
                                type="button"
                                key={ex}
                                onClick={() => {
                                    setBrowsingExchange(ex);
                                    if (activeTab === 'favorites') setActiveTab('all');
                                }}
                                className={`w-full text-left rounded-xl transition-all relative flex items-center justify-between gap-1.5 ${
                                    compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
                                } ${
                                    isBrowsing
                                        ? 'bg-cyan-500/15 text-slate-900 dark:text-white border border-cyan-500/35'
                                        : 'text-slate-600 dark:text-slate-400 border border-transparent hover:bg-white dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                                    <div className="flex flex-col leading-tight min-w-0">
                                        <span className={`font-bold truncate ${compact ? 'text-[10.5px]' : 'text-[11.5px]'}`}>
                                            {meta.label}
                                        </span>
                                        {!compact && (
                                            <span className="text-[8.5px] font-mono text-slate-400 dark:text-slate-500 truncate">
                                                {meta.tag}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {isActiveVenue && (
                                    <span
                                        className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"
                                        title="Active venue"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Right Pair List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 bg-white dark:bg-transparent">
                    <div className="sticky top-0 z-10 flex items-center justify-between px-2 py-1.5 mb-1 rounded-lg bg-white/95 dark:bg-[#070b14]/95 text-[9.5px] font-mono font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <span>
                            {activeTab === 'favorites'
                                ? 'Saved Watchlist'
                                : `${EXCHANGE_META[browsingExchange.toLowerCase()]?.label || browsingExchange} Markets`}{' '}
                            <span className="text-slate-300 dark:text-slate-600">({totalMatchingCount})</span>
                        </span>
                        {loadingMarkets && activeTab !== 'favorites' && (
                            <Activity size={12} className="animate-spin text-cyan-400" />
                        )}
                    </div>

                    {visibleRows.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-44 text-center px-4">
                            {activeTab === 'favorites' ? (
                                <>
                                    <Star size={24} className="text-slate-300 dark:text-slate-700 mb-2" />
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                        No pairs in Watchlist yet
                                    </p>
                                    <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">
                                        Click ★ on any pair to pin it for 1-click access
                                    </p>
                                </>
                            ) : (
                                <>
                                    <Search size={24} className="text-slate-300 dark:text-slate-700 mb-2" />
                                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                                        {loadingMarkets ? 'Loading live markets...' : 'No matching pairs found'}
                                    </p>
                                    {!loadingMarkets && (
                                        <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1">
                                            Try typing e.g. btcusdt, eth, sol perp
                                        </p>
                                    )}
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-0.5 pb-2">
                            {visibleRows.map((row, idx) => {
                                const isSelected =
                                    row.symbol.toUpperCase() === symbol.toUpperCase() &&
                                    row.exchange.toLowerCase() === exchange.toLowerCase();
                                const isHighlighted = idx === highlightedIndex;
                                const fav = isFavorited(row.exchange, row.symbol);
                                const cleanLogoSym = row.symbol.replace(/:.*/, '');
                                return (
                                    <button
                                        key={`${row.exchange}:${row.symbol}`}
                                        ref={(el) => {
                                            itemRefs.current[idx] = el;
                                        }}
                                        type="button"
                                        onMouseEnter={() => setHighlightedIndex(idx)}
                                        onClick={() => commitPairSelection(row.exchange, row.symbol)}
                                        className={`w-full flex items-center justify-between gap-2 rounded-xl transition-all group border ${
                                            compact ? 'px-2 py-1.5' : 'px-2.5 py-2'
                                        } ${
                                            isSelected
                                                ? 'bg-cyan-500/15 dark:bg-cyan-500/20 border-cyan-500/45 shadow-sm'
                                                : isHighlighted
                                                  ? 'bg-slate-100 dark:bg-white/10 border-slate-200 dark:border-white/15'
                                                  : 'border-transparent hover:bg-slate-50 dark:hover:bg-white/5'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            <CoinLogo
                                                symbol={cleanLogoSym}
                                                className={compact ? 'h-4 w-4 shrink-0' : 'h-5 w-5 shrink-0'}
                                            />
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {renderSymbolPairText(row.symbol)}
                                                {getMarketBadge(row.symbol, row.exchange)}
                                                {activeTab === 'favorites' && (
                                                    <span className="text-[8.5px] font-mono uppercase text-slate-400 dark:text-slate-500">
                                                        {row.exchange}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                            {isSelected && (
                                                <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                                                    <Check size={10} strokeWidth={3} />
                                                </span>
                                            )}
                                            <span
                                                role="button"
                                                tabIndex={-1}
                                                onClick={(e) => toggleFavorite(row.exchange, row.symbol, e)}
                                                title={fav ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                                className={`p-1 rounded-md transition-colors ${
                                                    fav
                                                        ? 'text-amber-400 hover:bg-amber-500/15'
                                                        : 'text-slate-400 dark:text-slate-500 opacity-50 sm:opacity-0 sm:group-hover:opacity-100 hover:text-amber-400 hover:bg-white/5'
                                                }`}
                                            >
                                                <Star size={12} className={fav ? 'fill-amber-400' : ''} />
                                            </span>
                                        </div>
                                    </button>
                                );
                            })}

                            {totalMatchingCount > visibleRows.length && (
                                <p className="text-[10px] font-mono text-center text-slate-400 dark:text-slate-500 py-2">
                                    Showing {visibleRows.length} of {totalMatchingCount} pairs — type to narrow down
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer Keyboard Hints */}
            <div className="px-3 py-1.5 border-t border-slate-100 dark:border-white/10 bg-slate-50/80 dark:bg-[#050810] flex items-center justify-between text-[9.5px] font-mono text-slate-400 dark:text-slate-500">
                <div className="flex items-center gap-3">
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            ↑↓
                        </kbd>{' '}
                        Navigate
                    </span>
                    <span>
                        <kbd className="px-1 py-0.5 rounded bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300">
                            ↵
                        </kbd>{' '}
                        Select
                    </span>
                </div>
                <span className="text-[9px] text-cyan-600 dark:text-cyan-400/80 font-bold">★ Star to save</span>
            </div>
        </div>
    ) : null;

    return (
        <div className="relative">
            {/* Sleek Pro Terminal Trigger Pill */}
            <button
                ref={triggerRef}
                type="button"
                onClick={() => (isDropdownOpen ? setIsDropdownOpen(false) : openDropdown())}
                className={`group flex items-center justify-between border transition-all duration-200 cursor-pointer ${
                    compact ? 'gap-2 px-2 py-1 rounded-lg h-8' : 'gap-2.5 px-2.5 py-1.5 rounded-xl h-10'
                } ${
                    isDropdownOpen
                        ? 'bg-white dark:bg-[#0b101d] border-cyan-500/70 shadow-[0_0_0_2px_rgba(6,182,212,0.16)]'
                        : 'bg-white dark:bg-[#0b101d] border-slate-200 dark:border-white/10 hover:border-cyan-500/45 hover:bg-slate-50 dark:hover:bg-[#0f1628]'
                }`}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div
                        className={`${
                            compact ? 'w-5 h-5 rounded-md' : 'w-7 h-7 rounded-lg'
                        } flex items-center justify-center shrink-0 bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10`}
                    >
                        <CoinLogo symbol={symbol.replace(/:.*/, '')} className={compact ? 'h-3.5 w-3.5' : 'h-[18px] w-[18px]'} />
                    </div>
                    <div className="flex flex-col items-start leading-none min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                            {renderSymbolPairText(symbol, true)}
                            {getMarketBadge(symbol, exchange)}
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${activeVenueMeta.dot}`} />
                            <span className="text-[9px] font-mono font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
                                {activeVenueMeta.label}
                            </span>
                        </div>
                    </div>
                </div>
                <ChevronDown
                    size={compact ? 12 : 14}
                    className={`text-slate-400 shrink-0 transition-transform duration-200 ${
                        isDropdownOpen ? 'rotate-180 text-cyan-400' : 'group-hover:text-slate-600 dark:group-hover:text-slate-200'
                    }`}
                />
            </button>

            {/* Portal escapes any overflow:hidden toolbar or modal container */}
            {typeof document !== 'undefined' && createPortal(dropdownPortal, document.body)}
        </div>
    );
};
