import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
    Activity,
    ChevronDown,
    KeyRound,
    RefreshCw,
    Search,
    ShieldCheck,
    TrendingDown,
    TrendingUp,
    Wallet,
    X,
    Zap,
} from 'lucide-react';
import apiClient from '@/services/client';
import { manualTradeService, FastBalanceResponse } from '@/services/manualTradeService';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/context/ToastContext';
import { useSettings } from '@/context/SettingsContext';
import { useMarketStore } from '@/store/marketStore';
import CoinLogo, { useSharedCoinLogoMap } from '@/components/common/CoinLogo';
import {
    SUPPORTED_EXCHANGES,
    ExpandIcon,
    CollapseIcon,
    MOCK_CRYPTO_NEWS,
} from '@/constants';
import type { Trade, Exchange, Timeframe } from '@/types';
import SmartOrderForm from '@/components/features/trading/SmartOrderForm';
import { getThermalProfile, isThermalGuardActive } from '@/utils/deviceProfile';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { useViewportProfile } from '@/hooks/useViewportProfile';

interface OrderBookEntry {
    price: number;
    amount: number;
    total: number;
}
type TradeWithStatus = Trade & { isNew?: boolean };

const CHART_TIMEFRAMES: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

const formatAdaptivePrice = (price: number): string => {
    if (!Number.isFinite(price) || price <= 0) return '0.00';
    if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    if (price >= 0.001) return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 5 });
    return price.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 });
};

// --- SaaS Thermal-Safe NewsTickerBar ---
const NewsTickerBar: React.FC<{ thermalGuard: boolean }> = ({ thermalGuard }) => {
    const [selectedNews, setSelectedNews] = useState<any>(null);
    const [newsData, setNewsData] = useState<any[]>(MOCK_CRYPTO_NEWS);

    useEffect(() => {
        let mounted = true;
        const fetchNews = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try {
                const response = await apiClient.get('/trading/news');
                if (mounted && Array.isArray(response.data) && response.data.length > 0) {
                    setNewsData(response.data);
                }
            } catch {
                // Keep cached/fallback news silently
            }
        };

        fetchNews();
        const interval = setInterval(fetchNews, 60_000);
        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        if (!selectedNews) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedNews(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedNews]);

    const tickerItems = thermalGuard ? newsData.slice(0, 8) : [...newsData, ...newsData];

    return (
        <>
            <div className="flex items-center gap-3 overflow-hidden bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 rounded-xl px-2.5 py-1.5 shadow-sm flex-shrink-0">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-rose-500/10 border border-rose-500/25 rounded-lg flex-shrink-0">
                    <span className="relative flex h-2 w-2">
                        {!thermalGuard && (
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                        )}
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                    </span>
                    <span className="text-[10px] font-mono font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider whitespace-nowrap">
                        Live Wire
                    </span>
                </div>

                {thermalGuard ? (
                    <div className="flex-1 overflow-x-auto no-scrollbar flex items-center gap-6 py-0.5">
                        {tickerItems.map((news, i) => (
                            <button
                                key={`${news.id}-${i}`}
                                type="button"
                                onClick={() => setSelectedNews(news)}
                                className="flex items-center shrink-0 text-left hover:text-cyan-500 transition-colors cursor-pointer"
                            >
                                <span className="text-[10.5px] font-mono font-black text-cyan-600 dark:text-cyan-400 mr-1.5">
                                    [{news.source}]
                                </span>
                                <span className="text-xs text-slate-600 dark:text-gray-300 font-medium whitespace-nowrap">
                                    {news.text}
                                </span>
                            </button>
                        ))}
                    </div>
                ) : (
                    <div className="flex-1 overflow-hidden relative h-6">
                        <div
                            className="animate-marquee-slow whitespace-nowrap absolute top-0 left-0 flex items-center h-full"
                            style={{ animationDuration: '80s' }}
                        >
                            {tickerItems.map((news, i) => (
                                <button
                                    key={`${news.id}-${i}`}
                                    type="button"
                                    onClick={() => setSelectedNews(news)}
                                    className="flex items-center mx-6 cursor-pointer hover:text-cyan-400 transition-colors"
                                >
                                    <span className="text-[11px] font-mono font-black text-cyan-600 dark:text-cyan-400 mr-2">
                                        [{news.source}]
                                    </span>
                                    <span className="text-xs text-slate-600 dark:text-gray-300 font-medium">
                                        {news.text}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {selectedNews && (
                <div
                    className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 ${
                        thermalGuard ? '' : 'backdrop-blur-md'
                    }`}
                    onClick={() => setSelectedNews(null)}
                >
                    <div
                        className="relative bg-white dark:bg-[#070b14] w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-cyan-500/30 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-rose-500" />
                        <div className="p-5 space-y-4">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/30 text-[10px] font-mono font-black uppercase">
                                        {selectedNews.source}
                                    </span>
                                    <span className="text-[11px] text-slate-500 dark:text-gray-400 font-mono">
                                        {new Date().toLocaleTimeString()}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedNews(null)}
                                    className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>

                            <h3 className="text-base font-black text-slate-900 dark:text-white leading-snug">
                                {selectedNews.text}
                            </h3>

                            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-gray-300 leading-relaxed">
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                    <span className="uppercase text-slate-500 dark:text-gray-400 font-bold">
                                        Sentiment Classification
                                    </span>
                                    <span
                                        className={`font-black uppercase ${
                                            selectedNews.sentiment === 'positive'
                                                ? 'text-emerald-500'
                                                : selectedNews.sentiment === 'negative'
                                                  ? 'text-rose-500'
                                                  : 'text-amber-500'
                                        }`}
                                    >
                                        {selectedNews.sentiment || 'Neutral'}
                                    </span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={() => setSelectedNews(null)}
                                className="w-full py-2.5 rounded-xl bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 text-xs font-mono font-black uppercase tracking-wider cursor-pointer"
                            >
                                Dismiss Brief
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// --- Interactive L2 OrderBook ---
const OrderBook: React.FC<{
    bids: OrderBookEntry[];
    asks: OrderBookEntry[];
    spread: number;
    spreadPercent: number;
    baseCoin: string;
    quoteCoin: string;
    thermalGuard: boolean;
    onSelectPrice: (price: number) => void;
}> = ({
    bids,
    asks,
    spread,
    spreadPercent,
    baseCoin,
    quoteCoin,
    thermalGuard,
    onSelectPrice,
}) => {
    const visibleAsks = thermalGuard ? asks.slice(-16) : asks;
    const visibleBids = thermalGuard ? bids.slice(0, 16) : bids;

    const maxTotal = Math.max(
        visibleBids[visibleBids.length - 1]?.total || visibleBids[0]?.total || 0,
        visibleAsks[0]?.total || visibleAsks[visibleAsks.length - 1]?.total || 0,
        1
    );

    const OrderRow: React.FC<OrderBookEntry & { type: 'bid' | 'ask' }> = ({
        price,
        amount,
        total,
        type,
    }) => {
        const depthPct = Math.min(100, Math.max(2, (total / maxTotal) * 100));
        const isBid = type === 'bid';

        return (
            <div
                onClick={() => onSelectPrice(price)}
                title={`Click to set Limit Price @ $${formatAdaptivePrice(price)}`}
                className="relative grid grid-cols-3 text-[11px] font-mono py-1 px-2.5 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer transition-colors"
            >
                <div
                    className={`absolute top-0 bottom-0 right-0 pointer-events-none ${
                        isBid ? 'bg-emerald-500/15' : 'bg-rose-500/15'
                    }`}
                    style={{ width: `${depthPct}%` }}
                />
                <span
                    className={`relative z-10 font-bold ${
                        isBid
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                    }`}
                >
                    {formatAdaptivePrice(price)}
                </span>
                <span className="relative z-10 text-right text-slate-700 dark:text-gray-300">
                    {amount.toFixed(4)}
                </span>
                <span className="relative z-10 text-right text-slate-500 dark:text-gray-400">
                    {total.toFixed(2)}
                </span>
            </div>
        );
    };

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-[#050811] rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <div className="grid grid-cols-3 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-400 px-2.5 py-2 border-b border-slate-200 dark:border-white/10 font-bold">
                <span>Price ({quoteCoin})</span>
                <span className="text-right">Size ({baseCoin})</span>
                <span className="text-right">Cum. Total</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {visibleAsks.length === 0 && visibleBids.length === 0 ? (
                    <div className="h-full flex items-center justify-center p-6 text-xs font-mono text-slate-400 dark:text-gray-500">
                        Waiting for L2 depth stream...
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col-reverse">
                            {visibleAsks.map((ask, idx) => (
                                <OrderRow key={`ask-${idx}`} {...ask} type="ask" />
                            ))}
                        </div>
                        <div className="py-1.5 px-2.5 my-0.5 flex items-center justify-between border-y border-slate-200 dark:border-white/10 bg-white dark:bg-[#0b101d] sticky top-0 bottom-0 z-20">
                            <span className="text-[10px] font-mono uppercase text-slate-500 dark:text-gray-400 font-bold">
                                Spread
                            </span>
                            <span
                                className={`text-[11px] font-bold font-mono ${
                                    spread >= 0
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                ${formatAdaptivePrice(Math.abs(spread))} (
                                {Math.abs(spreadPercent).toFixed(3)}%)
                            </span>
                        </div>
                        <div>
                            {visibleBids.map((bid, idx) => (
                                <OrderRow key={`bid-${idx}`} {...bid} type="bid" />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// --- Recent Market Trades ---
const RecentTrades: React.FC<{
    trades: TradeWithStatus[];
    baseCoin: string;
    quoteCoin: string;
    thermalGuard: boolean;
    onSelectPrice: (price: number) => void;
}> = ({ trades, baseCoin, quoteCoin, thermalGuard, onSelectPrice }) => {
    const visibleTrades = thermalGuard ? trades.slice(0, 25) : trades;

    return (
        <div className="flex flex-col h-full bg-slate-50 dark:bg-[#050811] rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <div className="grid grid-cols-3 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-gray-400 px-2.5 py-2 border-b border-slate-200 dark:border-white/10 font-bold">
                <span>Time</span>
                <span className="text-right">Price ({quoteCoin})</span>
                <span className="text-right">Size ({baseCoin})</span>
            </div>
            <div className="flex-1 overflow-y-auto">
                {visibleTrades.length === 0 ? (
                    <div className="h-full flex items-center justify-center p-6 text-xs font-mono text-slate-400 dark:text-gray-500">
                        Waiting for market tape...
                    </div>
                ) : (
                    visibleTrades.map((trade) => (
                        <div
                            key={trade.id}
                            onClick={() => onSelectPrice(trade.price)}
                            className={`grid grid-cols-3 text-[11px] font-mono py-1 px-2.5 hover:bg-slate-100 dark:hover:bg-white/[0.06] cursor-pointer transition-colors ${
                                trade.isNew && !thermalGuard ? 'bg-cyan-500/5' : ''
                            }`}
                        >
                            <span className="text-slate-500 dark:text-gray-400">{trade.time}</span>
                            <span
                                className={`text-right font-bold ${
                                    trade.type === 'buy'
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {formatAdaptivePrice(trade.price)}
                            </span>
                            <span
                                className={`text-right ${
                                    trade.amount > 0.1
                                        ? 'text-slate-900 dark:text-white font-bold'
                                        : 'text-slate-600 dark:text-gray-400'
                                }`}
                            >
                                {trade.amount.toFixed(4)}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

// --- SaaS Exchange Manager Modal ---
const ConnectExchangeModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    exchanges: Exchange[];
    onToggleConnect: (
        id: string,
        keys?: { apiKey: string; apiSecret: string }
    ) => Promise<boolean>;
    onSetActive: (id: string) => void;
    activeExchangeId: string;
    thermalGuard: boolean;
}> = ({
    isOpen,
    onClose,
    exchanges,
    onToggleConnect,
    onSetActive,
    activeExchangeId,
    thermalGuard,
}) => {
    const [apiKey, setApiKey] = useState('');
    const [apiSecret, setApiSecret] = useState('');
    const [isTesting, setIsTesting] = useState(false);
    const [testError, setTestError] = useState('');
    const [selectedExchangeId, setSelectedExchangeId] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleConnect = async (exchangeId: string) => {
        setIsTesting(true);
        setTestError('');
        try {
            const success = await onToggleConnect(exchangeId, { apiKey, apiSecret });
            if (success) {
                setApiKey('');
                setApiSecret('');
                setSelectedExchangeId(null);
            } else {
                setTestError('Connection failed or API credentials rejected.');
            }
        } catch (err: any) {
            setTestError(err.response?.data?.detail || 'Connection failed.');
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/75 ${
                thermalGuard ? '' : 'backdrop-blur-md'
            }`}
            onClick={onClose}
        >
            <div
                className="relative w-full max-w-xl rounded-2xl bg-white dark:bg-[#070b14] shadow-2xl border border-slate-200 dark:border-cyan-500/30 flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="h-[2px] w-full bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400" />
                <header className="flex justify-between items-center px-5 py-4 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-cyan-500/15 border border-cyan-500/30 text-cyan-600 dark:text-cyan-300">
                            <KeyRound className="w-4 h-4" />
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-900 dark:text-white">
                                Exchange Execution Venue
                            </h2>
                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400">
                                Switch active exchange or validate API credentials
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10 cursor-pointer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </header>

                <div className="p-4 sm:p-5 space-y-2.5 overflow-y-auto max-h-[65vh]">
                    {exchanges.map((exchange) => {
                        const isActive = activeExchangeId === exchange.id;
                        const isExpanded = selectedExchangeId === exchange.id && !exchange.isConnected;
                        return (
                            <div
                                key={exchange.id}
                                className={`flex flex-col gap-3 p-3.5 rounded-xl border transition-colors ${
                                    isActive
                                        ? 'bg-cyan-500/5 border-cyan-500/40'
                                        : 'bg-slate-50 dark:bg-[#0b101d] border-slate-200 dark:border-white/10'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 rounded-lg">
                                            {exchange.logo}
                                        </div>
                                        <div>
                                            <span className="block text-sm font-black text-slate-900 dark:text-white">
                                                {exchange.name}
                                            </span>
                                            <span className="text-[11px] font-mono text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
                                                <span
                                                    className={`w-1.5 h-1.5 rounded-full ${
                                                        exchange.isConnected
                                                            ? 'bg-emerald-500'
                                                            : 'bg-slate-400'
                                                    }`}
                                                />
                                                {exchange.isConnected ? 'Connected' : 'Disconnected'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2">
                                        {exchange.isConnected ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => onSetActive(exchange.id)}
                                                    disabled={isActive}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                                                        isActive
                                                            ? 'bg-cyan-500 text-slate-950 cursor-default'
                                                            : 'bg-slate-200 dark:bg-white/10 hover:bg-cyan-500 hover:text-slate-950 text-slate-800 dark:text-white cursor-pointer'
                                                    }`}
                                                >
                                                    {isActive ? 'Active' : 'Use Venue'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="text-xs font-mono font-bold text-rose-500 hover:text-rose-400 px-2 py-1 cursor-pointer"
                                                    onClick={() => onToggleConnect(exchange.id)}
                                                >
                                                    Disconnect
                                                </button>
                                            </>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setSelectedExchangeId(
                                                        selectedExchangeId === exchange.id
                                                            ? null
                                                            : exchange.id
                                                    )
                                                }
                                                className="px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-cyan-500 text-white dark:text-slate-950 text-xs font-mono font-bold cursor-pointer"
                                            >
                                                {isExpanded ? 'Cancel' : 'Connect'}
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="pt-3 border-t border-slate-200 dark:border-white/10 space-y-2.5">
                                        <input
                                            type="text"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            className="w-full px-3 py-2 bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg text-xs font-mono text-slate-900 dark:text-white outline-none"
                                            placeholder="Enter Exchange API Key"
                                        />
                                        <input
                                            type="password"
                                            value={apiSecret}
                                            onChange={(e) => setApiSecret(e.target.value)}
                                            className="w-full px-3 py-2 bg-white dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg text-xs font-mono text-slate-900 dark:text-white outline-none"
                                            placeholder="Enter Exchange Secret Key"
                                        />
                                        {testError && (
                                            <p className="text-xs font-mono text-rose-500 font-bold">
                                                {testError}
                                            </p>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleConnect(exchange.id)}
                                            disabled={!apiKey || !apiSecret || isTesting}
                                            className="w-full py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-mono font-black uppercase tracking-wider cursor-pointer disabled:opacity-50"
                                        >
                                            {isTesting ? 'Validating Keys...' : 'Validate & Connect'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const Market: React.FC = () => {
    const { theme } = useTheme();
    const { showToast } = useToast();
    const { apiKeys } = useSettings();
    const deviceProfile = useDeviceProfile();
    const viewportProfile = useViewportProfile();
    const isPhoneMobileUI = deviceProfile.isPhoneMobileUI;
    const stackMarketVertically =
        isPhoneMobileUI || (deviceProfile.isTablet && viewportProfile.metrics.width < 960);
    const thermalGuard = isThermalGuardActive();

    const {
        activeMarket,
        globalSymbol: activePair,
        setGlobalSymbol: setActivePair,
        globalInterval,
        setGlobalInterval,
        globalExchange: activeExchangeId,
        setGlobalExchange: setActiveExchangeId,
    } = useMarketStore();

    const activeTimeframe = globalInterval as Timeframe;
    const setActiveTimeframe = setGlobalInterval;

    const baseCoin = useMemo(
        () => (activePair.includes('/') ? activePair.split('/')[0] : activePair.replace('USDT', '')),
        [activePair]
    );
    const quoteCoin = useMemo(
        () => (activePair.includes('/') ? activePair.split('/')[1] : 'USDT'),
        [activePair]
    );

    const [lastPrice, setLastPrice] = useState(0);
    const [priceUpdateStatus, setPriceUpdateStatus] = useState<'up' | 'down' | 'none'>('none');
    const [price24hAgo, setPrice24hAgo] = useState(0);
    const [volume24h, setVolume24h] = useState(0);
    const [high24h, setHigh24h] = useState(0);
    const [low24h, setLow24h] = useState(0);
    const [wsConnected, setWsConnected] = useState(false);

    const [orderBookData, setOrderBookData] = useState<{
        bids: OrderBookEntry[];
        asks: OrderBookEntry[];
    }>({ bids: [], asks: [] });
    const [recentTrades, setRecentTrades] = useState<TradeWithStatus[]>([]);
    const [activeSidePanelTab, setActiveSidePanelTab] = useState<'trade' | 'orderBook' | 'trades'>(
        'trade'
    );
    const [activeOrderFormTab, setActiveOrderFormTab] = useState<'buy' | 'sell'>('buy');
    const [activeOrderType, setActiveOrderType] = useState<'Market' | 'Limit' | 'SmartPeg'>('Market');
    const [isSmartOrderMode, setIsSmartOrderMode] = useState(false);
    const [orderAmount, setOrderAmount] = useState('');
    const [orderPrice, setOrderPrice] = useState('');
    const [orderAmountSlider, setOrderAmountSlider] = useState(0);
    const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

    // Real wallet balance sync for active exchange API key
    const [walletBalance, setWalletBalance] = useState<FastBalanceResponse | null>(null);
    const [isLoadingBalance, setIsLoadingBalance] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [exchanges, setExchanges] = useState<Exchange[]>(SUPPORTED_EXCHANGES);

    // Keep exchanges list synced with SettingsContext apiKeys
    useEffect(() => {
        if (!Array.isArray(apiKeys) || apiKeys.length === 0) return;
        const connectedExSet = new Set(apiKeys.map((k) => String(k.exchange || '').toLowerCase()));
        setExchanges((prev) =>
            prev.map((ex) => ({
                ...ex,
                isConnected: ex.isConnected || connectedExSet.has(ex.id.toLowerCase()),
            }))
        );
    }, [apiKeys]);

    const matchingApiKey = useMemo(() => {
        if (!Array.isArray(apiKeys) || apiKeys.length === 0) return null;
        return (
            apiKeys.find(
                (k) => String(k.exchange || '').toLowerCase() === String(activeExchangeId || '').toLowerCase()
            ) || apiKeys[0]
        );
    }, [apiKeys, activeExchangeId]);

    const fetchWalletBalance = useCallback(
        async (forceRefresh = false) => {
            if (!matchingApiKey?.id) {
                setWalletBalance(null);
                return;
            }
            setIsLoadingBalance(true);
            try {
                const res = await manualTradeService.getFastBalance(
                    Number(matchingApiKey.id),
                    activePair,
                    forceRefresh
                );
                setWalletBalance(res);
            } catch {
                // Ignore silently when exchange endpoint temporarily rejects
            } finally {
                setIsLoadingBalance(false);
            }
        },
        [matchingApiKey?.id, activePair]
    );

    useEffect(() => {
        fetchWalletBalance(false);
    }, [fetchWalletBalance]);

    const [isChartFullScreen, setIsChartFullScreen] = useState(false);
    const [widgetKey, setWidgetKey] = useState(Date.now());
    const [isResizing, setIsResizing] = useState(false);
    const [leftPaneWidth, setLeftPaneWidth] = useState(72);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
    const [watchlistSearch, setWatchlistSearch] = useState('');
    const watchlistRef = useRef<HTMLDivElement>(null);
    const coinLogoMap = useSharedCoinLogoMap();

    useEffect(() => {
        if (!isWatchlistOpen) return;
        const onClickOutside = (e: MouseEvent) => {
            if (watchlistRef.current && !watchlistRef.current.contains(e.target as Node)) {
                setIsWatchlistOpen(false);
            }
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsWatchlistOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onClickOutside);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [isWatchlistOpen]);

    const watchlistData = {
        crypto: [
            'BTC/USDT',
            'ETH/USDT',
            'SOL/USDT',
            'BNB/USDT',
            'XRP/USDT',
            'ADA/USDT',
            'DOGE/USDT',
            'AVAX/USDT',
            'SUI/USDT',
            'PEPE/USDT',
        ],
        forex: ['EUR/USD', 'GBP/JPY', 'USD/JPY', 'AUD/USD'],
        stocks: ['AAPL', 'TSLA', 'NVDA', 'MSFT'],
        commodities: ['XAU/USD', 'USOIL', 'XAG/USD', 'NGAS'],
    };
    const baseWatchlist = watchlistData[activeMarket] || watchlistData.crypto;
    const cryptoExtraPairs =
        activeMarket === 'crypto'
            ? Object.keys(coinLogoMap)
                  .filter((sym) => sym !== 'USDT' && sym !== 'USDC' && sym !== 'POL')
                  .map((sym) => `${sym}/USDT`)
            : [];
    const mergedWatchlist =
        activeMarket === 'crypto'
            ? Array.from(new Set([...baseWatchlist, ...cryptoExtraPairs]))
            : baseWatchlist;

    const currentWatchlist = (
        watchlistSearch.trim()
            ? mergedWatchlist.filter((p) =>
                  p.toLowerCase().includes(watchlistSearch.trim().toLowerCase())
              )
            : mergedWatchlist
    ).slice(0, thermalGuard ? 35 : 60);

    const activeExchange = exchanges.find((ex) => ex.id === activeExchangeId);

    // Resizable pane handlers
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    const handleMouseUp = useCallback(() => {
        setIsResizing(false);
    }, []);

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (isResizing && containerRef.current) {
                const bounds = containerRef.current.getBoundingClientRect();
                const newWidth = ((e.clientX - bounds.left) / bounds.width) * 100;
                if (newWidth > 45 && newWidth < 85) {
                    setLeftPaneWidth(newWidth);
                }
            }
        },
        [isResizing]
    );

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing, handleMouseMove, handleMouseUp]);

    const toggleFullScreen = () => {
        setIsChartFullScreen((prev) => !prev);
        setWidgetKey(Date.now());
    };

    useEffect(() => {
        if (isChartFullScreen) {
            document.body.classList.add('body-no-scroll');
        } else {
            document.body.classList.remove('body-no-scroll');
        }
        return () => document.body.classList.remove('body-no-scroll');
    }, [isChartFullScreen]);

    const handleToggleConnect = async (
        id: string,
        keys?: { apiKey: string; apiSecret: string }
    ): Promise<boolean> => {
        if (keys) {
            try {
                await apiClient.post('/trading/test-connection', {
                    exchange_id: id,
                    api_key: keys.apiKey,
                    api_secret: keys.apiSecret,
                });
            } catch {
                return false;
            }
        }

        setExchanges((prev) =>
            prev.map((ex) => {
                if (ex.id === id) {
                    const nowConnected = !ex.isConnected;
                    if (nowConnected && !activeExchangeId) {
                        setActiveExchangeId(id);
                    } else if (!nowConnected && activeExchangeId === id) {
                        const nextAvailable = prev.find((p) => p.isConnected && p.id !== id);
                        setActiveExchangeId(nextAvailable?.id || '');
                    }
                    return { ...ex, isConnected: nowConnected };
                }
                return ex;
            })
        );
        return true;
    };

    const handleSetActive = (id: string) => {
        setActiveExchangeId(id);
        setIsModalOpen(false);
    };

    const ws = useRef<WebSocket | null>(null);
    const lastPriceRef = useRef(0);
    const priceFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingBatchRef = useRef<{
        ticker?: {
            price: number;
            high: number;
            low: number;
            volume: number;
            price24hAgo?: number;
        };
        depth?: { bids: OrderBookEntry[]; asks: OrderBookEntry[] };
        trades: TradeWithStatus[];
        legacyPrice?: number;
    }>({ trades: [] });

    // Live WebSocket for Ticker, Depth, Trades
    useEffect(() => {
        let socket: WebSocket | null = null;
        let timeoutId: ReturnType<typeof setTimeout>;
        let isMounted = true;
        setWsConnected(false);

        const triggerPriceFlash = (newPrice: number) => {
            const prevPrice = lastPriceRef.current;
            if (newPrice !== prevPrice) {
                setPriceUpdateStatus(newPrice > prevPrice ? 'up' : 'down');
                if (!isThermalGuardActive()) {
                    if (priceFlashTimerRef.current) clearTimeout(priceFlashTimerRef.current);
                    priceFlashTimerRef.current = setTimeout(() => {
                        priceFlashTimerRef.current = null;
                        if (isMounted) setPriceUpdateStatus('none');
                    }, 500);
                }
            }
            lastPriceRef.current = newPrice;
            setLastPrice(newPrice);
        };

        const flushPendingBatch = () => {
            flushTimerRef.current = null;
            if (!isMounted || document.hidden) {
                pendingBatchRef.current = { trades: [] };
                return;
            }
            const batch = pendingBatchRef.current;
            pendingBatchRef.current = { trades: [] };

            if (batch.ticker) {
                triggerPriceFlash(batch.ticker.price);
                setHigh24h(batch.ticker.high);
                setLow24h(batch.ticker.low);
                setVolume24h(batch.ticker.volume);
                if (batch.ticker.price24hAgo !== undefined) {
                    setPrice24hAgo(batch.ticker.price24hAgo);
                }
            } else if (batch.legacyPrice !== undefined) {
                lastPriceRef.current = batch.legacyPrice;
                setLastPrice(batch.legacyPrice);
            }

            if (batch.depth) {
                setOrderBookData(batch.depth);
            }

            if (batch.trades.length > 0) {
                const incoming = batch.trades;
                setRecentTrades((prevTrades) => [...incoming, ...prevTrades].slice(0, 50));
            }
        };

        const handleVisibilityChange = () => {
            if (document.hidden && isThermalGuardActive()) {
                if (flushTimerRef.current) {
                    clearTimeout(flushTimerRef.current);
                    flushTimerRef.current = null;
                }
                if (priceFlashTimerRef.current) {
                    clearTimeout(priceFlashTimerRef.current);
                    priceFlashTimerRef.current = null;
                }
                setPriceUpdateStatus('none');
                pendingBatchRef.current = { trades: [] };
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        const connect = () => {
            if (!isMounted) return;
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsHost = window.location.host;
            socket = new WebSocket(`${wsProtocol}//${wsHost}/ws/market-data/${activePair.replace('/', '')}`);
            ws.current = socket;

            socket.onopen = () => {
                if (isMounted) setWsConnected(true);
            };

            socket.onmessage = (event) => {
                if (!isMounted) return;
                const message = JSON.parse(event.data);

                if (isThermalGuardActive()) {
                    if (document.hidden) return;

                    if (message.type === 'ticker') {
                        const ticker = message.data;
                        const currentPrice = parseFloat(ticker.price);
                        const priceChange = parseFloat(ticker.change);
                        pendingBatchRef.current.ticker = {
                            price: currentPrice,
                            high: parseFloat(ticker.high),
                            low: parseFloat(ticker.low),
                            volume: parseFloat(ticker.volume),
                            price24hAgo: !isNaN(priceChange) ? currentPrice - priceChange : undefined,
                        };
                    } else if (message.type === 'depth') {
                        pendingBatchRef.current.depth = message.data;
                    } else if (message.type === 'trade') {
                        const newTrades: TradeWithStatus[] = message.data.map((t: any) => ({
                            id: t.id,
                            time: t.time,
                            price: parseFloat(t.price),
                            amount: parseFloat(t.amount),
                            type: t.type,
                            isNew: true,
                        }));
                        pendingBatchRef.current.trades = [
                            ...newTrades,
                            ...pendingBatchRef.current.trades,
                        ].slice(0, 50);
                    } else if (message.price) {
                        pendingBatchRef.current.legacyPrice = message.price;
                    }

                    if (!flushTimerRef.current) {
                        const flushMs = getThermalProfile().timings.marketTradeFlushMs || 250;
                        flushTimerRef.current = setTimeout(flushPendingBatch, flushMs);
                    }
                    return;
                }

                if (message.type === 'ticker') {
                    const ticker = message.data;
                    const currentPrice = parseFloat(ticker.price);
                    triggerPriceFlash(currentPrice);
                    setHigh24h(parseFloat(ticker.high));
                    setLow24h(parseFloat(ticker.low));
                    setVolume24h(parseFloat(ticker.volume));
                    const priceChange = parseFloat(ticker.change);
                    if (!isNaN(priceChange)) {
                        setPrice24hAgo(currentPrice - priceChange);
                    }
                } else if (message.type === 'depth') {
                    setOrderBookData(message.data);
                } else if (message.type === 'trade') {
                    setRecentTrades((prevTrades) => {
                        const newTrades = message.data.map((t: any) => ({
                            id: t.id,
                            time: t.time,
                            price: parseFloat(t.price),
                            amount: parseFloat(t.amount),
                            type: t.type,
                            isNew: true,
                        }));
                        return [...newTrades, ...prevTrades].slice(0, 50);
                    });
                } else if (message.price) {
                    lastPriceRef.current = message.price;
                    setLastPrice(message.price);
                }
            };

            socket.onerror = (error) => {
                console.error('WebSocket Error:', error);
            };
            socket.onclose = () => {
                if (!isMounted) return;
                setWsConnected(false);
                timeoutId = setTimeout(connect, 3000);
            };
        };

        connect();
        return () => {
            isMounted = false;
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            clearTimeout(timeoutId);
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
                flushTimerRef.current = null;
            }
            if (priceFlashTimerRef.current) {
                clearTimeout(priceFlashTimerRef.current);
                priceFlashTimerRef.current = null;
            }
            pendingBatchRef.current = { trades: [] };
            if (socket) {
                socket.onclose = null;
                socket.close();
            }
        };
    }, [activePair]);

    // TradingView Widget
    useEffect(() => {
        let retryTimer: ReturnType<typeof setTimeout> | null = null;
        let cancelled = false;

        const getTVInterval = (tf: string) => {
            if (tf.includes('m')) return tf.replace('m', '');
            if (tf.includes('h')) return (parseInt(tf, 10) * 60).toString();
            if (tf.includes('d')) return 'D';
            if (tf.includes('w')) return 'W';
            return '60';
        };

        const createWidget = () => {
            const containerId = isChartFullScreen
                ? `tv_chart_container_fullscreen_${widgetKey}`
                : `tv_chart_container_${widgetKey}`;
            const container = document.getElementById(containerId);

            if (container && window.TradingView?.widget) {
                container.innerHTML = '';
                new window.TradingView.widget({
                    autosize: true,
                    symbol: `BINANCE:${activePair.replace('/', '')}`,
                    interval: getTVInterval(activeTimeframe),
                    timezone: 'Etc/UTC',
                    theme: theme === 'dark' ? 'Dark' : 'Light',
                    style: '1',
                    locale: 'en',
                    toolbar_bg: theme === 'dark' ? '#070b14' : '#f8fafc',
                    enable_publishing: false,
                    allow_symbol_change: true,
                    container_id: containerId,
                    hide_side_toolbar: false,
                    studies: [],
                });
            }
        };

        const checkLibraryAndCreate = () => {
            if (cancelled) return;
            if (typeof window.TradingView !== 'undefined' && window.TradingView.widget) {
                createWidget();
            } else {
                retryTimer = setTimeout(checkLibraryAndCreate, 150);
            }
        };

        checkLibraryAndCreate();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [theme, activePair, activeTimeframe, isChartFullScreen, widgetKey]);

    const change24h = price24hAgo > 0 && lastPrice > 0 ? lastPrice - price24hAgo : 0;
    const changePercent24h = price24hAgo > 0 ? (change24h / price24hAgo) * 100 : 0;
    const isPositive = change24h >= 0;

    const { bids, asks } = orderBookData;
    const bestAsk = asks[asks.length - 1]?.price || 0;
    const bestBid = bids[0]?.price || 0;
    const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    const effectiveTradePrice = useMemo(() => {
        if (activeOrderType === 'Limit') {
            const p = parseFloat(orderPrice);
            if (Number.isFinite(p) && p > 0) return p;
        }
        return lastPrice > 0 ? lastPrice : 0;
    }, [activeOrderType, orderPrice, lastPrice]);

    const maxBuyBase = useMemo(() => {
        if (!walletBalance || effectiveTradePrice <= 0) return 0;
        return (walletBalance.quote_free || 0) / effectiveTradePrice;
    }, [walletBalance, effectiveTradePrice]);

    const maxSellBase = walletBalance?.base_free || 0;

    const handlePercentChange = (pct: number) => {
        setOrderAmountSlider(pct);
        const cap = activeOrderFormTab === 'buy' ? maxBuyBase : maxSellBase;
        if (cap > 0 && pct > 0) {
            const qty = (cap * pct) / 100;
            const dec = qty >= 1 ? 4 : 6;
            setOrderAmount(Number(qty.toFixed(dec)).toString());
        } else if (pct === 0) {
            setOrderAmount('');
        }
    };

    const handleSelectBookPrice = (px: number) => {
        setActiveOrderType('Limit');
        setOrderPrice(px.toString());
        setActiveSidePanelTab('trade');
    };

    const estOrderNotional = useMemo(() => {
        const amt = parseFloat(orderAmount);
        if (!Number.isFinite(amt) || amt <= 0 || effectiveTradePrice <= 0) return 0;
        return amt * effectiveTradePrice;
    }, [orderAmount, effectiveTradePrice]);

    const estFeeUsd = useMemo(() => {
        if (estOrderNotional <= 0) return 0;
        // SmartPeg targets 0% Maker; Market/Limit uses standard 0.1% spot estimate
        return activeOrderType === 'SmartPeg' ? 0 : estOrderNotional * 0.001;
    }, [estOrderNotional, activeOrderType]);

    const handleSubmitOrder = async () => {
        const amt = parseFloat(orderAmount);
        if (!Number.isFinite(amt) || amt <= 0) {
            showToast(`Enter a valid ${baseCoin} order quantity`, 'error');
            return;
        }
        if (activeOrderType === 'Limit') {
            const px = parseFloat(orderPrice);
            if (!Number.isFinite(px) || px <= 0) {
                showToast('Enter a valid Limit price', 'error');
                return;
            }
        }

        setIsSubmittingOrder(true);
        try {
            const res = await manualTradeService.placeOrder({
                symbol: activePair,
                side: activeOrderFormTab === 'buy' ? 'Buy' : 'Sell',
                type: activeOrderType,
                amount: amt,
                price: activeOrderType === 'Limit' ? parseFloat(orderPrice) : undefined,
                exchange_id: activeExchangeId || matchingApiKey?.exchange || 'binance',
                api_key_id: matchingApiKey?.id ? Number(matchingApiKey.id) : undefined,
                client_timestamp: Date.now(),
            });
            showToast(
                res?.message ||
                    `${activeOrderFormTab === 'buy' ? 'Buy' : 'Sell'} ${activeOrderType} order placed (${activePair})`,
                'success'
            );
            setOrderAmount('');
            setOrderAmountSlider(0);
            fetchWalletBalance(true);
        } catch (err: any) {
            showToast(
                err?.response?.data?.detail || err?.message || 'Order execution failed',
                'error'
            );
        } finally {
            setIsSubmittingOrder(false);
        }
    };

    const isBuySide = activeOrderFormTab === 'buy';

    return (
        <div
            data-viewport-lock={!stackMarketVertically ? 'true' : undefined}
            className={`flex flex-col ${
                stackMarketVertically ? 'min-h-full gap-3 overflow-y-auto pb-6' : 'h-full gap-3 overflow-hidden'
            }`}
        >
            {isModalOpen && (
                <ConnectExchangeModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    exchanges={exchanges}
                    onToggleConnect={handleToggleConnect}
                    onSetActive={handleSetActive}
                    activeExchangeId={activeExchangeId}
                    thermalGuard={thermalGuard}
                />
            )}

            {/* Breaking News Wire */}
            <NewsTickerBar thermalGuard={thermalGuard} />

            {/* ── SaaS Market Command Header HUD ──────────────────────────────── */}
            <div className="relative flex-shrink-0 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/25 p-3.5 sm:px-5 shadow-sm dark:shadow-[0_10px_28px_rgba(0,0,0,0.45)] z-30">
                <div className="h-[2px] w-full absolute top-0 left-0 rounded-t-2xl bg-gradient-to-r from-cyan-400 via-indigo-500 to-emerald-400 opacity-85" />

                <div className="flex flex-wrap items-center justify-between gap-4">
                    {/* Left: Exchange + Pair Selector */}
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="relative group cursor-pointer shrink-0"
                            title="Switch Exchange or Manage API Keys"
                        >
                            <div
                                className={`w-10 h-10 rounded-xl bg-slate-100 dark:bg-[#0b101d] border flex items-center justify-center transition-colors ${
                                    activeExchange?.isConnected
                                        ? 'border-emerald-500/50'
                                        : 'border-slate-200 dark:border-white/10'
                                }`}
                            >
                                {activeExchange?.logo}
                            </div>
                            <span
                                className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#070b14] ${
                                    wsConnected ? 'bg-emerald-500' : 'bg-amber-400'
                                }`}
                            />
                        </button>

                        <div ref={watchlistRef} className="relative min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                {activeMarket === 'crypto' && (
                                    <CoinLogo symbol={activePair} className="h-7 w-7 shrink-0" />
                                )}
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsWatchlistOpen((v) => !v);
                                        setWatchlistSearch('');
                                    }}
                                    className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-1.5 cursor-pointer hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                                >
                                    <span>{activePair}</span>
                                    <ChevronDown
                                        className={`w-4 h-4 text-slate-400 transition-transform ${
                                            isWatchlistOpen ? 'rotate-180' : ''
                                        }`}
                                    />
                                </button>
                                <span className="text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                                    {activeMarket === 'crypto'
                                        ? 'SPOT / PERP'
                                        : activeMarket.toUpperCase()}
                                </span>
                                <span
                                    className={`hidden sm:inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-md border ${
                                        wsConnected
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                            : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                                    }`}
                                >
                                    <span
                                        className={`w-1.5 h-1.5 rounded-full ${
                                            wsConnected ? 'bg-emerald-500' : 'bg-amber-400'
                                        }`}
                                    />
                                    {wsConnected ? 'WS Live' : 'Syncing'}
                                </span>
                            </div>

                            <p className="text-[11px] font-mono text-slate-500 dark:text-gray-400 mt-0.5">
                                {activeExchange?.name || 'Binance'} Oracle Feed
                            </p>

                            {/* Watchlist Selector Popover */}
                            {isWatchlistOpen && (
                                <div className="absolute top-full left-0 mt-2 w-72 bg-white dark:bg-[#070b14] border border-slate-200 dark:border-cyan-500/30 rounded-xl shadow-2xl z-[100] overflow-hidden">
                                    <div className="p-2.5 border-b border-slate-200 dark:border-white/10 space-y-2">
                                        <div className="flex items-center justify-between text-[10px] font-mono font-black text-slate-500 dark:text-gray-400 uppercase tracking-wider">
                                            <span>{activeMarket} Markets</span>
                                            <span>{currentWatchlist.length} Pairs</span>
                                        </div>
                                        <div className="relative">
                                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                            <input
                                                type="text"
                                                value={watchlistSearch}
                                                onChange={(e) => setWatchlistSearch(e.target.value)}
                                                placeholder="Search coin (BTC, SOL, PEPE)..."
                                                className="w-full bg-slate-50 dark:bg-[#0b101d] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-lg pl-8 pr-2.5 py-1.5 text-xs font-mono text-slate-900 dark:text-white outline-none"
                                            />
                                        </div>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-white/5">
                                        {currentWatchlist.length > 0 ? (
                                            currentWatchlist.map((pair) => (
                                                <button
                                                    key={pair}
                                                    type="button"
                                                    onClick={() => {
                                                        setActivePair(pair);
                                                        setIsWatchlistOpen(false);
                                                        setWatchlistSearch('');
                                                    }}
                                                    className={`w-full px-3.5 py-2.5 text-left text-xs font-mono font-bold transition-colors flex justify-between items-center gap-2 cursor-pointer ${
                                                        activePair === pair
                                                            ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300'
                                                            : 'text-slate-800 dark:text-gray-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                                                    }`}
                                                >
                                                    <span className="flex items-center gap-2.5 min-w-0">
                                                        {activeMarket === 'crypto' && (
                                                            <CoinLogo
                                                                symbol={pair}
                                                                className="h-5 w-5 shrink-0"
                                                            />
                                                        )}
                                                        <span className="truncate">{pair}</span>
                                                    </span>
                                                    {activePair === pair && (
                                                        <span className="w-2 h-2 rounded-full bg-cyan-400 shrink-0" />
                                                    )}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="px-3.5 py-5 text-xs font-mono text-slate-400 text-center">
                                                No matching pairs
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Center: Adaptive Price & 24h Telemetry */}
                    <div className="flex items-center gap-5 sm:gap-8 flex-wrap">
                        <div>
                            <p
                                className={`text-2xl sm:text-[26px] font-mono font-black transition-colors duration-200 ${
                                    priceUpdateStatus === 'up'
                                        ? 'text-emerald-500'
                                        : priceUpdateStatus === 'down'
                                          ? 'text-rose-500'
                                          : 'text-slate-900 dark:text-white'
                                }`}
                            >
                                ${formatAdaptivePrice(lastPrice)}
                            </p>
                            <p
                                className={`text-xs font-mono font-bold flex items-center gap-1 ${
                                    isPositive
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-rose-600 dark:text-rose-400'
                                }`}
                            >
                                {isPositive ? (
                                    <TrendingUp className="w-3.5 h-3.5" />
                                ) : (
                                    <TrendingDown className="w-3.5 h-3.5" />
                                )}
                                <span>
                                    {isPositive ? '+' : '-'}${formatAdaptivePrice(Math.abs(change24h))} (
                                    {isPositive ? '+' : '-'}
                                    {Math.abs(changePercent24h).toFixed(2)}%)
                                </span>
                            </p>
                        </div>

                        <div className="hidden md:flex items-center gap-6 text-xs font-mono">
                            <div>
                                <p className="text-[10px] uppercase text-slate-500 dark:text-gray-400 font-bold">
                                    24h High
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                                    ${formatAdaptivePrice(high24h)}
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase text-slate-500 dark:text-gray-400 font-bold">
                                    24h Low
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                                    ${formatAdaptivePrice(low24h)}
                                </p>
                            </div>
                            <div>
                                <p className="text-[10px] uppercase text-slate-500 dark:text-gray-400 font-bold">
                                    24h Vol ({baseCoin})
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white mt-0.5">
                                    {volume24h.toLocaleString(undefined, {
                                        maximumFractionDigits: 0,
                                    })}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Right: Quick Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-[#0b101d] hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-xs font-mono font-bold text-slate-700 dark:text-gray-200 cursor-pointer transition-colors"
                        >
                            <ShieldCheck className="w-3.5 h-3.5 text-cyan-500" />
                            <span className="hidden sm:inline">
                                {activeExchange?.name || 'Venue'}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveSidePanelTab('trade')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white text-xs font-mono font-black uppercase tracking-wider shadow-[0_4px_14px_rgba(6,182,212,0.28)] cursor-pointer transition-all"
                        >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            <span>Quick Trade</span>
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Main Workspace: Chart + OrderBook / Execution Dock ───────────── */}
            <div
                ref={containerRef}
                className={`flex-1 flex ${stackMarketVertically ? 'flex-col gap-3' : 'gap-2.5 min-h-0'} relative`}
            >
                {isResizing && <div className="absolute inset-0 z-50 cursor-col-resize" />}

                {/* Left: TradingView Chart Card */}
                <div
                    className={`flex flex-col ${
                        stackMarketVertically ? 'w-full h-[360px] min-h-[320px]' : 'h-full'
                    }`}
                    style={stackMarketVertically ? undefined : { width: `${leftPaneWidth}%` }}
                >
                    <div className="h-full rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 shadow-sm overflow-hidden flex flex-col">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02]">
                            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                                {CHART_TIMEFRAMES.map((tf) => (
                                    <button
                                        key={tf}
                                        type="button"
                                        onClick={() => setActiveTimeframe(tf)}
                                        className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg transition-colors cursor-pointer ${
                                            activeTimeframe === tf
                                                ? 'bg-cyan-500 text-slate-950'
                                                : 'text-slate-600 dark:text-gray-400 hover:bg-slate-200/70 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        {tf}
                                    </button>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={toggleFullScreen}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-200/70 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-700 dark:text-gray-300 text-[10.5px] font-mono font-bold cursor-pointer shrink-0 transition-colors"
                                title="Toggle Fullscreen Chart"
                            >
                                {isChartFullScreen ? <CollapseIcon /> : <ExpandIcon />}
                                <span className="hidden sm:inline">
                                    {isChartFullScreen ? 'Exit' : 'Expand'}
                                </span>
                            </button>
                        </div>

                        <div className="flex-1 w-full relative bg-white dark:bg-[#070b14]">
                            <div id={`tv_chart_container_${widgetKey}`} className="w-full h-full" />
                        </div>
                    </div>
                </div>

                {/* Desktop/Tablet Resizable Splitter */}
                {!stackMarketVertically && (
                    <div
                        className="w-1.5 cursor-col-resize flex items-center justify-center group flex-shrink-0"
                        onMouseDown={handleMouseDown}
                    >
                        <div
                            className={`h-16 w-1 rounded-full transition-colors ${
                                isResizing
                                    ? 'bg-cyan-500'
                                    : 'bg-slate-300 dark:bg-white/15 group-hover:bg-cyan-400'
                            }`}
                        />
                    </div>
                )}

                {/* Right: Execution, OrderBook & Tape Dock */}
                <div
                    className={`flex flex-col gap-2.5 ${
                        stackMarketVertically ? 'w-full min-h-[440px]' : 'h-full min-w-[300px]'
                    }`}
                    style={
                        stackMarketVertically
                            ? undefined
                            : { width: `calc(${100 - leftPaneWidth}% - 10px)` }
                    }
                >
                    {/* Dock Navigation */}
                    <div className="grid grid-cols-3 p-1 bg-slate-100 dark:bg-[#070b14] border border-slate-200 dark:border-white/10 rounded-xl gap-1">
                        {(
                            [
                                { id: 'trade', label: 'Trade' },
                                { id: 'orderBook', label: 'Order Book' },
                                { id: 'trades', label: 'Tape' },
                            ] as const
                        ).map((tab) => (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveSidePanelTab(tab.id)}
                                className={`py-1.5 text-[11px] font-mono font-black uppercase tracking-wider rounded-lg transition-colors cursor-pointer ${
                                    activeSidePanelTab === tab.id
                                        ? 'bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm'
                                        : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Dock Content Card */}
                    <div className="flex-1 min-h-0 rounded-2xl bg-white dark:bg-[#070b14] border border-slate-200 dark:border-white/10 shadow-sm p-3.5 flex flex-col overflow-hidden">
                        {activeSidePanelTab === 'trade' && (
                            <div className="h-full overflow-y-auto flex flex-col space-y-3.5">
                                {/* Buy / Sell Segmented Toggle */}
                                <div className="grid grid-cols-2 bg-slate-100 dark:bg-[#050811] p-1 rounded-xl border border-slate-200 dark:border-white/10 gap-1">
                                    <button
                                        type="button"
                                        onClick={() => setActiveOrderFormTab('buy')}
                                        className={`py-2 text-xs font-mono font-black uppercase rounded-lg transition-colors cursor-pointer ${
                                            isBuySide
                                                ? 'bg-emerald-500 text-white'
                                                : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        Buy / Long
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveOrderFormTab('sell')}
                                        className={`py-2 text-xs font-mono font-black uppercase rounded-lg transition-colors cursor-pointer ${
                                            !isBuySide
                                                ? 'bg-rose-600 text-white'
                                                : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                    >
                                        Sell / Short
                                    </button>
                                </div>

                                {/* Standard vs PRO Smart Order (TWAP/VWAP) */}
                                <div className="flex items-center gap-3 border-b border-slate-200 dark:border-white/10 pb-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsSmartOrderMode(false)}
                                        className={`text-[11px] font-mono font-black uppercase pb-1 border-b-2 transition-colors cursor-pointer ${
                                            !isSmartOrderMode
                                                ? 'text-cyan-600 dark:text-cyan-400 border-cyan-500'
                                                : 'text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-gray-200'
                                        }`}
                                    >
                                        Standard Order
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsSmartOrderMode(true)}
                                        className={`text-[11px] font-mono font-black uppercase pb-1 border-b-2 transition-colors flex items-center gap-1 cursor-pointer ${
                                            isSmartOrderMode
                                                ? 'text-purple-600 dark:text-purple-400 border-purple-500'
                                                : 'text-slate-400 border-transparent hover:text-slate-700 dark:hover:text-gray-200'
                                        }`}
                                    >
                                        <span className="px-1 py-0.2 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 text-[9px]">
                                            ALGO
                                        </span>
                                        TWAP / VWAP
                                    </button>
                                </div>

                                {!isSmartOrderMode ? (
                                    <div className="space-y-3 flex-1 flex flex-col">
                                        {/* Order Execution Mode */}
                                        <div className="grid grid-cols-3 bg-slate-100 dark:bg-[#050811] p-1 rounded-xl border border-slate-200 dark:border-white/10 gap-1">
                                            {(
                                                [
                                                    { key: 'Market', label: 'Market' },
                                                    { key: 'Limit', label: 'Limit' },
                                                    { key: 'SmartPeg', label: '⚡ SmartPeg' },
                                                ] as const
                                            ).map((t) => (
                                                <button
                                                    key={t.key}
                                                    type="button"
                                                    onClick={() => setActiveOrderType(t.key)}
                                                    className={`py-1.5 rounded-lg text-[10.5px] font-mono font-bold transition-colors cursor-pointer ${
                                                        activeOrderType === t.key
                                                            ? 'bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm'
                                                            : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                                    }`}
                                                >
                                                    {t.label}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Price Input */}
                                        <div
                                            className={`space-y-1 ${
                                                activeOrderType !== 'Limit' ? 'opacity-65' : ''
                                            }`}
                                        >
                                            <div className="flex items-center justify-between text-[11px] font-mono">
                                                <label className="text-slate-500 dark:text-gray-400 font-bold">
                                                    {activeOrderType === 'Limit'
                                                        ? `Limit Price (${quoteCoin})`
                                                        : activeOrderType === 'SmartPeg'
                                                          ? 'Execution Peg'
                                                          : 'Execution Price'}
                                                </label>
                                                {activeOrderType === 'Limit' && lastPrice > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setOrderPrice(lastPrice.toString())
                                                        }
                                                        className="text-cyan-600 dark:text-cyan-400 hover:underline font-bold cursor-pointer"
                                                    >
                                                        Last: ${formatAdaptivePrice(lastPrice)}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={
                                                        activeOrderType === 'Limit' ? orderPrice : ''
                                                    }
                                                    onChange={(e) => setOrderPrice(e.target.value)}
                                                    placeholder={
                                                        activeOrderType === 'Market'
                                                            ? 'Best Market Price'
                                                            : activeOrderType === 'SmartPeg'
                                                              ? 'Dynamic BBO Maker (0% Fee)'
                                                              : lastPrice > 0
                                                                ? formatAdaptivePrice(lastPrice)
                                                                : 'Enter Price'
                                                    }
                                                    disabled={activeOrderType !== 'Limit'}
                                                    className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-xl pl-3 pr-14 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none disabled:cursor-not-allowed"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 dark:text-gray-400 font-mono font-bold">
                                                    {quoteCoin}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Quantity Input */}
                                        <div className="space-y-1">
                                            <label className="text-[11px] font-mono font-bold text-slate-500 dark:text-gray-400 block">
                                                Quantity ({baseCoin})
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type="number"
                                                    step="any"
                                                    value={orderAmount}
                                                    onChange={(e) => {
                                                        setOrderAmount(e.target.value);
                                                        setOrderAmountSlider(0);
                                                    }}
                                                    placeholder="0.00"
                                                    className="w-full bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/15 focus:border-cyan-400 rounded-xl pl-3 pr-14 py-2 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none"
                                                />
                                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500 dark:text-gray-400 font-mono font-bold">
                                                    {baseCoin}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Interactive Percentage Quick-Fill & Slider */}
                                        <div className="space-y-2">
                                            <div className="grid grid-cols-4 gap-1.5">
                                                {[25, 50, 75, 100].map((pct) => (
                                                    <button
                                                        key={pct}
                                                        type="button"
                                                        onClick={() => handlePercentChange(pct)}
                                                        className={`py-1 rounded-lg text-[10.5px] font-mono font-bold border transition-colors cursor-pointer ${
                                                            orderAmountSlider === pct
                                                                ? isBuySide
                                                                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-700 dark:text-emerald-300'
                                                                    : 'bg-rose-500/20 border-rose-400 text-rose-700 dark:text-rose-300'
                                                                : 'bg-slate-50 dark:bg-[#0b101d] border-slate-200 dark:border-white/10 text-slate-600 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
                                                        }`}
                                                    >
                                                        {pct}%
                                                    </button>
                                                ))}
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max="100"
                                                step="25"
                                                value={orderAmountSlider}
                                                onChange={(e) =>
                                                    handlePercentChange(Number(e.target.value))
                                                }
                                                className={`w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-slate-200 dark:bg-white/10 ${
                                                    isBuySide
                                                        ? 'accent-emerald-500'
                                                        : 'accent-rose-500'
                                                }`}
                                            />
                                        </div>

                                        {/* Real Wallet Telemetry Summary */}
                                        <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#050811] border border-slate-200 dark:border-white/10 space-y-1.5 text-[11px] font-mono">
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500 dark:text-gray-400 flex items-center gap-1">
                                                    <Wallet className="w-3 h-3" />
                                                    Avail Balance
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    {walletBalance ? (
                                                        <span className="font-bold text-slate-900 dark:text-white">
                                                            {isBuySide
                                                                ? `${(walletBalance.quote_free || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${quoteCoin}`
                                                                : `${(walletBalance.base_free || 0).toLocaleString(undefined, { maximumFractionDigits: 5 })} ${baseCoin}`}
                                                        </span>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() => setIsModalOpen(true)}
                                                            className="text-cyan-600 dark:text-cyan-400 font-bold hover:underline cursor-pointer"
                                                        >
                                                            Connect API →
                                                        </button>
                                                    )}
                                                    {matchingApiKey?.id && (
                                                        <button
                                                            type="button"
                                                            onClick={() => fetchWalletBalance(true)}
                                                            className="text-slate-400 hover:text-cyan-400 cursor-pointer"
                                                            title="Refresh Balance"
                                                        >
                                                            <RefreshCw
                                                                className={`w-3 h-3 ${
                                                                    isLoadingBalance ? 'animate-spin' : ''
                                                                }`}
                                                            />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500 dark:text-gray-400">
                                                    Est. Total
                                                </span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                    {estOrderNotional > 0
                                                        ? `$${estOrderNotional.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                                                        : '--'}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500 dark:text-gray-400">
                                                    Est. Fee
                                                </span>
                                                <span className="text-slate-600 dark:text-gray-300 font-bold">
                                                    {activeOrderType === 'SmartPeg'
                                                        ? '0.00 (0% Maker)'
                                                        : estFeeUsd > 0
                                                          ? `~$${estFeeUsd.toFixed(3)}`
                                                          : '--'}
                                                </span>
                                            </div>
                                        </div>

                                        <button
                                            type="button"
                                            disabled={isSubmittingOrder}
                                            onClick={handleSubmitOrder}
                                            className={`w-full py-3 rounded-xl text-xs font-mono font-black uppercase tracking-wider text-white transition-all cursor-pointer active:scale-[0.99] disabled:opacity-50 mt-auto ${
                                                isBuySide
                                                    ? 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_6px_16px_rgba(16,185,129,0.28)]'
                                                    : 'bg-rose-600 hover:bg-rose-500 shadow-[0_6px_16px_rgba(225,29,72,0.28)]'
                                            }`}
                                        >
                                            {isSubmittingOrder
                                                ? 'Executing Order...'
                                                : `${isBuySide ? 'Buy / Long' : 'Sell / Short'} ${baseCoin}`}
                                        </button>
                                    </div>
                                ) : (
                                    <SmartOrderForm
                                        symbol={activePair}
                                        activeSide={activeOrderFormTab}
                                    />
                                )}
                            </div>
                        )}

                        {activeSidePanelTab === 'orderBook' && (
                            <OrderBook
                                bids={bids}
                                asks={asks}
                                spread={spread}
                                spreadPercent={spreadPercent}
                                baseCoin={baseCoin}
                                quoteCoin={quoteCoin}
                                thermalGuard={thermalGuard}
                                onSelectPrice={handleSelectBookPrice}
                            />
                        )}

                        {activeSidePanelTab === 'trades' && (
                            <RecentTrades
                                trades={recentTrades}
                                baseCoin={baseCoin}
                                quoteCoin={quoteCoin}
                                thermalGuard={thermalGuard}
                                onSelectPrice={handleSelectBookPrice}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* Fullscreen Chart Modal */}
            {isChartFullScreen && (
                <div className="fixed inset-0 z-[100] bg-white dark:bg-[#070b14] p-0">
                    <div
                        id={`tv_chart_container_fullscreen_${widgetKey}`}
                        className="w-full h-full"
                    />
                    <button
                        type="button"
                        onClick={toggleFullScreen}
                        className="fixed top-4 right-4 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/90 text-white border border-white/15 text-xs font-mono font-bold cursor-pointer hover:bg-slate-800"
                    >
                        <CollapseIcon />
                        <span>Exit Fullscreen</span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default Market;
