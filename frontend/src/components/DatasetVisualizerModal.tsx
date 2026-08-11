import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createChart, IChartApi, ISeriesApi, Time, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { X, Maximize2, Minimize2, Activity } from 'lucide-react';

interface DatasetVisualizerModalProps {
    isOpen: boolean;
    onClose: () => void;
    symbol: string;
}

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/api/v1';

export const DatasetVisualizerModal: React.FC<DatasetVisualizerModalProps> = ({
    isOpen,
    onClose,
    symbol
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const histogramSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const tpSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const slSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    
    const [isExpanded, setIsExpanded] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const [stats, setStats] = useState({ rows: 0, lastPrice: 0, type: 'Waiting for data...' });
    const wsRef = useRef<WebSocket | null>(null);

    // Initialize chart
    useEffect(() => {
        if (!isOpen || !chartContainerRef.current) return;

        const handleResize = () => {
            if (chartContainerRef.current && chartRef.current) {
                chartRef.current.applyOptions({ 
                    width: chartContainerRef.current.clientWidth,
                    height: chartContainerRef.current.clientHeight 
                });
            }
        };

        const chart = createChart(chartContainerRef.current, {
            layout: {
                background: { color: 'transparent' },
                textColor: '#9CA3AF',
            },
            grid: {
                vertLines: { color: 'rgba(31, 41, 55, 0.5)' },
                horzLines: { color: 'rgba(31, 41, 55, 0.5)' },
            },
            timeScale: {
                timeVisible: true,
                secondsVisible: true,
                borderColor: 'rgba(31, 41, 55, 0.5)',
            },
            rightPriceScale: {
                borderColor: 'rgba(31, 41, 55, 0.5)',
            },
            crosshair: {
                mode: 0,
            }
        });

        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: '#10B981',
            downColor: '#EF4444',
            borderVisible: false,
            wickUpColor: '#10B981',
            wickDownColor: '#EF4444',
        });

        const histogramSeries = chart.addSeries(HistogramSeries, {
            color: '#3B82F6',
            priceFormat: {
                type: 'volume',
            },
            priceScaleId: 'histogram_scale',
        });
        
        const tpSeries = chart.addSeries(LineSeries, {
            color: 'rgba(16, 185, 129, 0.6)',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            crosshairMarkerVisible: false,
            lastValueVisible: false,
        });

        const slSeries = chart.addSeries(LineSeries, {
            color: 'rgba(239, 68, 68, 0.6)',
            lineWidth: 1,
            lineStyle: 2, // Dashed
            crosshairMarkerVisible: false,
            lastValueVisible: false,
        });
        
        chart.priceScale('histogram_scale').applyOptions({
            scaleMargins: {
                top: 0.8,
                bottom: 0,
            },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        histogramSeriesRef.current = histogramSeries;
        tpSeriesRef.current = tpSeries as any;
        slSeriesRef.current = slSeries as any;

        window.addEventListener('resize', handleResize);
        
        // Let it layout first, then resize
        setTimeout(handleResize, 100);

        return () => {
            window.removeEventListener('resize', handleResize);
            chart.remove();
        };
    }, [isOpen, isExpanded]);

    // WebSocket Connection
    useEffect(() => {
        if (!isOpen) {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            return;
        }

        const connectWs = () => {
            setConnectionStatus('connecting');
            const ws = new WebSocket(`${WS_URL}/model-training/ws/training-visualizer`);
            
            ws.onopen = () => {
                setConnectionStatus('connected');
                setStats(s => ({ ...s, type: 'Listening for Live Ticks...' }));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    
                    if (data.type === 'live_tick' && data.symbol === symbol) {
                        const ts = new Date(data.timestamp).getTime() / 1000 as Time;
                        const price = data.Close;
                        
                        // Treat ticks as tiny 1ms candles to draw them on lightweight-charts
                        // Or just update the latest candle if they share the same timestamp (which they won't, 100ms apart)
                        if (candleSeriesRef.current) {
                            candleSeriesRef.current.update({
                                time: ts,
                                open: price,
                                high: price,
                                low: price,
                                close: price
                            });
                        }
                        
                        if (histogramSeriesRef.current && data.obi !== undefined) {
                            histogramSeriesRef.current.update({
                                time: ts,
                                value: data.obi,
                                color: data.obi > 0.5 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.5)'
                            });
                        }

                        setStats(prev => ({
                            rows: prev.rows + 1,
                            lastPrice: price,
                            type: 'Live Scraping...'
                        }));
                    }
                    else if (data.type === 'final_dataset' && data.symbol === symbol) {
                        setStats(s => ({ ...s, type: 'Final Merged Dataset Rendered!' }));
                        
                        if (!candleSeriesRef.current || !histogramSeriesRef.current) return;
                        
                        // Parse the final historical dataset
                        const candleData = [];
                        const histData = [];
                        const tpData = [];
                        const slData = [];
                        
                        for (const row of data.data) {
                            const ts = new Date(row.timestamp).getTime() / 1000 as Time;
                            candleData.push({
                                time: ts,
                                open: row.Open || row.Close, // fallback
                                high: row.High || row.Close,
                                low: row.Low || row.Close,
                                close: row.Close
                            });
                            
                            // Map RSI or Spread to histogram
                            const featureVal = row.RSI || row.Spread || row.obi || 0;
                            histData.push({
                                time: ts,
                                value: featureVal,
                                color: featureVal > 50 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(59, 130, 246, 0.8)'
                            });

                            // If advanced_setup targets exist, plot them as upper/lower bands
                            if (row.Target_TP !== undefined && row.Target_TP !== null) {
                                tpData.push({
                                    time: ts,
                                    value: row.Close + row.Target_TP
                                });
                            }
                            if (row.Target_SL !== undefined && row.Target_SL !== null) {
                                slData.push({
                                    time: ts,
                                    value: row.Close - row.Target_SL
                                });
                            }
                        }
                        
                        candleSeriesRef.current.setData(candleData);
                        histogramSeriesRef.current.setData(histData);
                        
                        if (tpSeriesRef.current && tpData.length > 0) {
                            tpSeriesRef.current.setData(tpData);
                        }
                        if (slSeriesRef.current && slData.length > 0) {
                            slSeriesRef.current.setData(slData);
                        }
                        
                        if (chartRef.current) {
                            chartRef.current.timeScale().fitContent();
                        }
                    }
                } catch (e) {
                    console.error("Error parsing WS message in visualizer", e);
                }
            };

            ws.onclose = () => {
                setConnectionStatus('disconnected');
            };

            wsRef.current = ws;
        };

        connectWs();

        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
        };
    }, [isOpen, symbol]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: 50, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 50, scale: 0.95 }}
                className={`fixed z-[9999] bg-gray-900 border border-gray-700 shadow-2xl overflow-hidden flex flex-col ${
                    isExpanded 
                        ? 'inset-4 rounded-xl' 
                        : 'bottom-6 right-6 w-[500px] h-[350px] rounded-lg'
                }`}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 select-none">
                    <div className="flex items-center gap-2">
                        <Activity className={`w-4 h-4 ${connectionStatus === 'connected' ? 'text-green-400 animate-pulse' : 'text-gray-500'}`} />
                        <h3 className="text-sm font-semibold text-white">
                            Dataset Visualizer <span className="text-gray-400 font-normal">({symbol})</span>
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-blue-400 mr-2 bg-blue-900/30 px-2 py-0.5 rounded">
                            {stats.type}
                        </span>
                        <button 
                            onClick={() => setIsExpanded(!isExpanded)}
                            className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                        >
                            {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-1 hover:bg-red-500/20 rounded text-gray-400 hover:text-red-400 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Stats Bar */}
                <div className="flex px-4 py-1.5 bg-gray-800/50 border-b border-gray-700 gap-4 text-xs">
                    <div className="flex flex-col">
                        <span className="text-gray-500">Rows Scraped</span>
                        <span className="font-mono text-white">{stats.rows}</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-gray-500">Last Price</span>
                        <span className="font-mono text-green-400">{stats.lastPrice.toFixed(4)}</span>
                    </div>
                </div>

                {/* Chart Container */}
                <div className="flex-1 relative bg-[#131722]">
                    <div ref={chartContainerRef} className="absolute inset-0" />
                </div>
            </motion.div>
        </AnimatePresence>
    );
};
