import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Activity, RefreshCcw, Layers, BarChart2, Check, ChevronsUpDown } from 'lucide-react';
import Button from '@/components/common/Button';
import { useTheme } from '@/context/ThemeContext';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickData, IPriceLine, CandlestickSeries, Time } from 'lightweight-charts';
import { Combobox, Transition } from '@headlessui/react';
import { useMarketStore } from '@/store/marketStore';

interface OrderBucket {
    price: number;
    volume: number;
}

interface MarketDepthData {
    symbol: string;
    exchange: string;
    current_price: number;
    bids: OrderBucket[];
    asks: OrderBucket[];
}

// Sub-component for Searchable Symbol Select
const SymbolSelector: React.FC<{
    selected: string;
    setSelected: (s: string) => void;
    options: string[];
}> = ({ selected, setSelected, options }) => {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const lowerQuery = query.toLowerCase();
        const results = query === ''
            ? options
            : options.filter((s) => s.toLowerCase().includes(lowerQuery));
        return results.slice(0, 50);
    }, [query, options]);

    return (
        <Combobox value={selected} onChange={setSelected}>
            <div className="relative">
                <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-transparent text-left focus:outline-none sm:text-sm">
                    <Combobox.Input
                        className="w-full border-none bg-transparent py-0 pl-0 pr-6 text-xs font-bold text-slate-700 dark:text-gray-200 focus:ring-0 uppercase placeholder-slate-400 dark:placeholder-gray-500"
                        displayValue={(s: string) => s}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search..."
                    />
                    <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
                        <ChevronsUpDown className="h-3 w-3 text-slate-400 dark:text-gray-400" aria-hidden="true" />
                    </Combobox.Button>
                </div>
                <Transition
                    as={React.Fragment}
                    leave="transition ease-in duration-100"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                    afterLeave={() => setQuery('')}
                >
                    <Combobox.Options className="absolute mt-1 max-h-60 min-w-[150px] overflow-auto rounded-md bg-white dark:bg-[#0A0A0A] py-1 text-base shadow-lg ring-1 ring-slate-200 dark:ring-black dark:ring-opacity-5 border border-slate-200 dark:border-gray-800 focus:outline-none sm:text-sm z-50 custom-scrollbar">
                        {filtered.length === 0 && query !== '' ? (
                            <div className="relative cursor-default select-none py-2 px-4 text-slate-600 dark:text-gray-400">
                                Nothing found.
                            </div>
                        ) : (
                            filtered.map((s) => (
                                <Combobox.Option
                                    key={s}
                                    className={({ active }) =>
                                        `relative cursor-default select-none py-2 pl-10 pr-4 ${active ? 'bg-brand-primary text-white' : 'text-slate-900 dark:text-gray-100'
                                        }`
                                    }
                                    value={s}
                                >
                                    {({ selected, active }) => (
                                        <>
                                            <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                                {s}
                                            </span>
                                            {selected ? (
                                                <span
                                                    className={`absolute inset-y-0 left-0 flex items-center pl-3 ${active ? 'text-white' : 'text-brand-primary'
                                                        }`}
                                                >
                                                    <Check className="h-3 w-3" aria-hidden="true" />
                                                </span>
                                            ) : null}
                                        </>
                                    )}
                                </Combobox.Option>
                            ))
                        )}
                        {filtered.length === 50 && (
                            <div className="relative cursor-default select-none py-2 px-4 text-xs text-slate-500 dark:text-gray-400 italic text-center border-t border-slate-200 dark:border-gray-700">
                                Keep typing to see more...
                            </div>
                        )}
                    </Combobox.Options>
                </Transition>
            </div>
        </Combobox>
    );
};

const MarketDepthWidget: React.FC = () => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    // API Config
    const API_BASE = '/api/v1/market-depth';

    // State - Selection
    const { globalExchange: selectedExchange, setGlobalExchange: setSelectedExchange, globalSymbol: selectedSymbol, setGlobalSymbol: setSelectedSymbol, globalInterval: selectedTimeframe, setGlobalInterval: setSelectedTimeframe } = useMarketStore();
    const [bucketSize, setBucketSize] = useState(50);

    // State - Data Lists
    const [availableExchanges, setAvailableExchanges] = useState<string[]>([]);
    const [availableMarkets, setAvailableMarkets] = useState<string[]>([]);

    // State - Chart Data
    const [ohlcvData, setOhlcvData] = useState<CandlestickData[]>([]);
    const [depthData, setDepthData] = useState<MarketDepthData | null>(null);

    // State - UI
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Refs
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const priceLinesRef = useRef<IPriceLine[]>([]);
    const shouldAutoAdjustBucket = useRef(true);

    // Constants
    const timeframeOptions = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const bucketOptions = [0.0001, 0.001, 0.01, 0.1, 1, 5, 10, 50, 100, 500, 1000];

    // Helper: Auto-calculate bucket size
    const getSmartBucketSize = (price: number) => {
        if (price < 0.01) return 0.0001;
        if (price < 0.1) return 0.001;
        if (price < 1) return 0.01;
        if (price < 10) return 0.1;
        if (price < 100) return 1;
        if (price < 1000) return 5;
        if (price < 10000) return 10;
        return 50;
    };

    // --- 1. Fetch Available Exchanges ---
    useEffect(() => {
        const fetchExchanges = async () => {
            try {
                const res = await fetch(`${API_BASE}/exchanges`);
                if (res.ok) {
                    const data = await res.json();
                    setAvailableExchanges(data);
                }
            } catch (e) {
                console.error("Failed to load exchanges", e);
            }
        };
        fetchExchanges();
    }, []);

    // --- 2. Fetch Markets for Exchange ---
    useEffect(() => {
        const fetchMarkets = async () => {
            if (!selectedExchange) return;
            try {
                const res = await fetch(`${API_BASE}/markets?exchange=${selectedExchange}`);
                if (res.ok) {
                    const data = await res.json();
                    setAvailableMarkets(data);
                    // Default to first symbol if current selection not in list
                    if (!data.includes(selectedSymbol)) {
                        setSelectedSymbol(data[0] || 'BTC/USDT');
                    }
                }
            } catch (e) {
                console.error("Failed to load markets", e);
            }
        };
        fetchMarkets();
    }, [selectedExchange]);

    // Reset auto-adjust on symbol change
    useEffect(() => {
        shouldAutoAdjustBucket.current = true;
    }, [selectedSymbol]);

    // --- 3. Fetch Data (OHLCV + Depth) ---
    const fetchData = async () => {
        if (!selectedSymbol || !selectedExchange) return;

        setLoading(true);
        setError(null);

        try {
            // Parallel Fetch
            const [ohlcvRes, depthRes] = await Promise.all([
                fetch(`${API_BASE}/ohlcv?symbol=${encodeURIComponent(selectedSymbol)}&exchange=${selectedExchange}&timeframe=${selectedTimeframe}&limit=1000`),
                fetch(`${API_BASE}/heatmap?symbol=${encodeURIComponent(selectedSymbol)}&exchange=${selectedExchange}&bucket_size=${bucketSize}`)
            ]);

            if (!ohlcvRes.ok) throw new Error("Failed to fetch Chart Data");
            if (!depthRes.ok) throw new Error("Failed to fetch Liquidity Data");

            const ohlcv = await ohlcvRes.json();
            const depth = await depthRes.json();

            setOhlcvData(ohlcv);
            setDepthData(depth);

            // Auto-Adjust Bucket Size
            if (shouldAutoAdjustBucket.current && depth.current_price) {
                const smartBucket = getSmartBucketSize(depth.current_price);
                if (smartBucket !== bucketSize) {
                    setBucketSize(smartBucket);
                }
                shouldAutoAdjustBucket.current = false;
            }

            // Update Chart Data immediately
            if (candleSeriesRef.current) {
                // Ensure time is unique and sorted
                const uniqueData = ohlcv.filter((v: any, i: number, a: any[]) =>
                    a.findIndex((t: any) => t.time === v.time) === i
                ).sort((a: any, b: any) => (a.time as number) - (b.time as number));

                candleSeriesRef.current.setData(uniqueData as CandlestickData<Time>[]);
                chartRef.current?.timeScale().fitContent();
            }

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Error fetching data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // Load Data on Change
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000); // Poll every 10s
        return () => clearInterval(interval);
    }, [selectedExchange, selectedSymbol, selectedTimeframe, bucketSize]);

    // --- 4. Chart Initialization ---
    useEffect(() => {
        if (!chartContainerRef.current) return;

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { type: ColorType.Solid, color: isDark ? '#111827' : '#ffffff' },
                textColor: isDark ? '#D1D5DB' : '#475569',
            },
            grid: {
                vertLines: { color: isDark ? '#374151' : '#f1f5f9', style: 1 },
                horzLines: { color: isDark ? '#374151' : '#f1f5f9', style: 1 },
            },
            width: chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: isDark ? '#374151' : '#cbd5e1',
            },
            rightPriceScale: {
                borderColor: isDark ? '#374151' : '#cbd5e1',
            }
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#26a69a',
            downColor: '#ef5350',
            borderVisible: false,
            wickUpColor: '#26a69a',
            wickDownColor: '#ef5350',
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;

        // Resize
        const handleResize = () => {
            if (chartContainerRef.current) {
                chart.applyOptions({ width: chartContainerRef.current.clientWidth });
            }
        };
        window.addEventListener('resize', handleResize);
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(chartContainerRef.current);

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            chart.remove();
        };
    }, []);

    // Dynamically update lightweight-charts options when theme changes
    useEffect(() => {
        if (!chartRef.current) return;
        chartRef.current.applyOptions({
            layout: {
                background: { type: ColorType.Solid, color: isDark ? '#111827' : '#ffffff' },
                textColor: isDark ? '#D1D5DB' : '#475569',
            },
            grid: {
                vertLines: { color: isDark ? '#374151' : '#f1f5f9', style: 1 },
                horzLines: { color: isDark ? '#374151' : '#f1f5f9', style: 1 },
            },
            timeScale: {
                borderColor: isDark ? '#374151' : '#cbd5e1',
            },
            rightPriceScale: {
                borderColor: isDark ? '#374151' : '#cbd5e1',
            }
        });
    }, [isDark]);

    // --- 5. Draw Liquidity Zones ---
    useEffect(() => {
        if (!candleSeriesRef.current || !depthData) return;

        // Clear old lines
        priceLinesRef.current.forEach(line => candleSeriesRef.current?.removePriceLine(line));
        priceLinesRef.current = [];

        const addLines = (buckets: OrderBucket[], color: string, titlePrefix: string) => {
            const top = [...buckets].sort((a, b) => b.volume - a.volume).slice(0, 5);
            top.forEach(bucket => {
                const line = candleSeriesRef.current?.createPriceLine({
                    price: bucket.price,
                    color: color,
                    lineWidth: 2,
                    lineStyle: 2,
                    axisLabelVisible: true,
                    title: `${titlePrefix}: ${bucket.volume.toFixed(2)}`,
                });
                if (line) priceLinesRef.current.push(line);
            });
        };

        addLines(depthData.bids, '#00C853', 'Buy');
        addLines(depthData.asks, '#FF3D00', 'Sell');

    }, [depthData]);


    return (
        <div className="h-full flex flex-col p-6 laptop:p-3 space-y-4 laptop:space-y-2.5">
            {/* Header Section */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-[#0A0A0A] p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-gray-700">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Activity className="text-brand-primary w-5 h-5" />
                        Market Depth Integration
                    </h2>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    {/* Controls Group */}
                    <div className='flex items-center gap-2 bg-slate-50 dark:bg-[#0A0A0A] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700'>
                        {/* Exchange */}
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 dark:text-gray-500 uppercase font-bold">Exchange</span>
                            <select
                                value={selectedExchange}
                                onChange={(e) => setSelectedExchange(e.target.value)}
                                className="bg-transparent text-xs font-bold text-slate-700 dark:text-gray-200 focus:outline-none cursor-pointer max-w-[80px]"
                            >
                                {availableExchanges.map(ex => <option key={ex} value={ex} className="bg-white dark:bg-[#0A0A0A] text-slate-800 dark:text-gray-200">{ex.toUpperCase()}</option>)}
                            </select>
                        </div>
                        <div className="w-px h-6 bg-slate-300 dark:bg-gray-600 mx-1"></div>

                        {/* Symbol (Searchable) */}
                        <div className="flex flex-col relative min-w-[120px]">
                            <span className="text-[10px] text-slate-500 dark:text-gray-500 uppercase font-bold">Symbol</span>
                            <SymbolSelector
                                selected={selectedSymbol}
                                setSelected={setSelectedSymbol}
                                options={availableMarkets}
                            />
                        </div>
                    </div>

                    {/* Timeframe & Bucket */}
                    <div className='flex items-center gap-2 bg-slate-50 dark:bg-[#0A0A0A] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700'>
                        {/* Timeframe */}
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 dark:text-gray-500 uppercase font-bold">Time</span>
                            <select
                                value={selectedTimeframe}
                                onChange={(e) => setSelectedTimeframe(e.target.value)}
                                className="bg-transparent text-xs font-bold text-brand-primary focus:outline-none cursor-pointer"
                            >
                                {timeframeOptions.map(tf => <option key={tf} value={tf} className="bg-white dark:bg-[#0A0A0A] text-slate-800 dark:text-gray-200">{tf}</option>)}
                            </select>
                        </div>
                        <div className="w-px h-6 bg-slate-300 dark:bg-gray-600 mx-1"></div>

                        {/* Bucket */}
                        <div className="flex flex-col">
                            <span className="text-[10px] text-slate-500 dark:text-gray-500 uppercase font-bold">Bucket</span>
                            <select
                                value={bucketSize}
                                onChange={(e) => setBucketSize(parseFloat(e.target.value))}
                                className="bg-transparent text-xs font-bold text-brand-primary focus:outline-none cursor-pointer"
                            >
                                {bucketOptions.map(b => <option key={b} value={b} className="bg-white dark:bg-[#0A0A0A] text-slate-800 dark:text-gray-200">${b}</option>)}
                            </select>
                        </div>
                    </div>

                    <Button variant="secondary" onClick={fetchData} className="!p-2">
                        <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {/* Main Chart Area */}
            <div className="flex-1 bg-white dark:bg-[#111827] rounded-2xl shadow-lg border border-slate-200 dark:border-gray-800 overflow-hidden relative min-h-[240px]">
                {loading && !depthData && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 dark:bg-black/50 backdrop-blur-sm">
                        <div className="text-brand-primary animate-pulse font-mono">Fetching Market Data...</div>
                    </div>
                )}
                {error && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/90 dark:bg-black/80 backdrop-blur-sm">
                        <div className="text-red-500 font-bold">{error}</div>
                    </div>
                )}

                <div ref={chartContainerRef} className="w-full h-full" />

                {/* Overlay Info */}
                <div className="absolute top-4 left-4 z-10 pointer-events-none">
                    <div className="flex items-baseline gap-2">
                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white font-mono">{selectedSymbol}</h1>
                        <span className="text-sm text-slate-500 dark:text-gray-400 font-mono">{selectedExchange.toUpperCase()} {selectedTimeframe}</span>
                    </div>
                    <div className="text-3xl font-bold text-[#26a69a] font-mono mt-1">
                        ${depthData?.current_price?.toLocaleString() || '---'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MarketDepthWidget;
