import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Activity, Play, Square, TrendingUp, DollarSign, FastForward, Wifi, AlertTriangle, BarChart2, Settings2, SlidersHorizontal, Globe, Layers } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import SimulationChart, { SimulationChartHandle } from '@/components/features/simulation/SimulationChart';
import EquityCurve from '@/components/features/simulation/EquityCurve';
import OrderBookWidget from '@/components/features/simulation/OrderBookWidget';
import LogConsole, { LogMessage } from '@/components/features/simulation/LogConsole';
import { CandlestickData, Time, SeriesMarker } from 'lightweight-charts';
import { useMarketStore } from '@/store/marketStore';

const EventDrivenSimulator: React.FC = () => {
    const [isRunning, setIsRunning] = useState(false);
    const { globalSymbol: symbol, setGlobalSymbol: setSymbol } = useMarketStore();
    const [logs, setLogs] = useState<LogMessage[]>([]);
    const [marketData, setMarketData] = useState<CandlestickData[]>([]);
    const [equityData, setEquityData] = useState<{ time: string; value: number; timestamp: number }[]>([]);
    const [markers, setMarkers] = useState<SeriesMarker<Time>[]>([]);
    const [pnl, setPnl] = useState(0);
    const [holdings, setHoldings] = useState(0);
    const [price, setPrice] = useState(0);
    const [bids, setBids] = useState<number[][]>([]);
    const [asks, setAsks] = useState<number[][]>([]);
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(0); // 0 = Max
    const [isPaused, setIsPaused] = useState(false);
    const [latency, setLatency] = useState<number>(0); // Network Latency in ms
    const [slippage, setSlippage] = useState<number>(0); // Slippage in %
    const [makerFee, setMakerFee] = useState<number>(0.001); // Maker Fee (0.1%)
    const [takerFee, setTakerFee] = useState<number>(0.002); // Taker Fee (0.2%)
    const [volumeParticipation, setVolumeParticipation] = useState<number>(100); // 100% (Full Fill)

    // Strategy Parameters State
    const [strategyParams, setStrategyParams] = useState({
        stop_loss: 0.01,
        take_profit: 0.02,
        buy_probability: 0.2
    });

    const [activeConfigTab, setActiveConfigTab] = useState<'strategy' | 'execution' | 'environment'>('strategy');

    const chartRef = useRef<SimulationChartHandle>(null);
    const socketRef = useRef<WebSocket | null>(null);

    // WebSocket Connection Logic
    const connect = useCallback(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsParams = isRunning ? `?symbol=${symbol}` : "";
        const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/simulation/ws/simulation${wsParams}`);

        ws.onopen = () => {
            addLog("System: Connected to Simulation Server", 'INFO');
            if (isRunning) {
                ws.send(JSON.stringify({ action: "START", symbol }));
                ws.send(JSON.stringify({ type: "UPDATE_SPEED", speed: playbackSpeed }));
                ws.send(JSON.stringify({ type: "UPDATE_PARAMS", params: strategyParams }));
                ws.send(JSON.stringify({ type: "UPDATE_LATENCY", latency: latency }));
                ws.send(JSON.stringify({ type: "UPDATE_SLIPPAGE", slippage: slippage }));
                ws.send(JSON.stringify({ type: "UPDATE_FEES", maker: makerFee, taker: takerFee }));
                ws.send(JSON.stringify({ type: "UPDATE_PARTICIPATION", rate: volumeParticipation / 100.0 }));
            }
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "MARKET") {
                const time = (new Date(data.time).getTime() / 1000) as Time;
                const candle: CandlestickData = {
                    time: time,
                    open: data.open,
                    high: data.high,
                    low: data.low,
                    close: data.close,
                };

                setPrice(data.close);

                setMarketData(prev => {
                    const lastCandle = prev[prev.length - 1];
                    if (lastCandle && (lastCandle.time === time)) {
                        const updated = [...prev];
                        updated[updated.length - 1] = candle;
                        return updated;
                    } else {
                        const newData = [...prev, candle];
                        if (newData.length > 200) return newData.slice(newData.length - 200);
                        return newData;
                    }
                });

                if (chartRef.current) {
                    chartRef.current.updateCandle(candle);
                }
            } else if (data.type === "ORDER_BOOK") {
                setBids(data.bids);
                setAsks(data.asks);
            } else if (data.type === "system_log") {
                setLogs(prev => [...prev, {
                    timestamp: data.timestamp,
                    level: data.level,
                    message: data.message,
                    metadata: data.metadata
                }]);
            } else if (data.type === "LOG") {
                addLog(data.message, 'INFO');
            } else if (data.type === "FILL") {
                const time = (new Date(data.time).getTime() / 1000) as Time;
                const newMarker: SeriesMarker<Time> = {
                    time: time,
                    position: data.direction === 'BUY' ? 'belowBar' : 'aboveBar',
                    color: data.direction === 'BUY' ? '#2196F3' : '#E91E63',
                    shape: data.direction === 'BUY' ? 'arrowUp' : 'arrowDown',
                    text: `${data.direction} @ ${data.price}`
                };

                setMarkers(prev => {
                    const updated = [...prev, newMarker];
                    if (chartRef.current) {
                        chartRef.current.setMarkers(updated);
                    }
                    return updated;
                });

                if (data.direction === 'BUY') {
                    setHoldings(h => h + data.quantity);
                    setPnl(p => p - data.commission);
                } else {
                    setHoldings(h => h - data.quantity);
                    setPnl(p => p - data.commission);
                }
            } else if (data.type === "EQUITY_UPDATE") {
                setEquityData(prev => {
                    const newPoint = {
                        time: data.time,
                        value: data.value,
                        timestamp: new Date(data.time).getTime()
                    };
                    const updated = [...prev, newPoint];
                    if (updated.length > 100) return updated.slice(updated.length - 100);
                    return updated;
                });
            } else if (data.type === "SYSTEM") {
                addLog(data.message, 'INFO');
            } else if (data.type === "PAUSED_STATE") {
                setIsPaused(data.value);
            }
        };

        ws.onclose = () => {
            addLog("System: Disconnected", 'INFO');
            setIsRunning(false);
            setIsPaused(false);
        };

        socketRef.current = ws;
    }, [isRunning, symbol, playbackSpeed, strategyParams, latency, slippage, makerFee, takerFee, volumeParticipation]);

    useEffect(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_SPEED", speed: playbackSpeed }));
        }
    }, [playbackSpeed]);

    useEffect(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_LATENCY", latency: latency }));
        }
    }, [latency]);

    useEffect(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_SLIPPAGE", slippage: slippage }));
        }
    }, [slippage]);

    useEffect(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_FEES", maker: makerFee, taker: takerFee }));
        }
    }, [makerFee, takerFee]);

    useEffect(() => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_PARTICIPATION", rate: volumeParticipation / 100.0 }));
        }
    }, [volumeParticipation]);

    useEffect(() => {
        return () => {
            if (socketRef.current) {
                socketRef.current.close();
            }
        };
    }, []);

    const addLog = (message: string, level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR') => {
        setLogs(prev => [...prev, {
            timestamp: new Date().toISOString(),
            level: level,
            message: message
        }]);
    };

    const handleStart = () => {
        setIsRunning(true);
        setLogs([]);
        setMarketData([]);
        setEquityData([]);
        setMarkers([]);
        if (chartRef.current) {
            chartRef.current.reset();
        }
        setPnl(0);
        setHoldings(0);
        setIsPaused(false);

        if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            connect();
            setTimeout(() => {
                if (socketRef.current?.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ action: "START", symbol }));
                }
            }, 100);
        } else {
            socketRef.current.send(JSON.stringify({ action: "START", symbol }));
        }
    };

    const handleStop = () => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ action: "STOP" }));
        }
        setIsRunning(false);
        setIsPaused(false);
    };

    const handlePause = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "PAUSE" }));
        }
    };

    const handleResume = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "RESUME" }));
        }
    };

    const handleStep = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "STEP" }));
        }
    };

    const handleUpdateParams = () => {
        if (socketRef.current?.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type: "UPDATE_PARAMS", params: strategyParams }));
        }
    };

    const speedOptions = [
        { label: '1x', value: 1.0 },
        { label: '10x', value: 10.0 },
        { label: '100x', value: 100.0 },
        { label: 'MAX', value: 0 },
    ];

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] gap-4 p-2">
            
            {/* Top Bar - Stats & Controls */}
            <Card className="flex-shrink-0 flex justify-between items-center bg-white/80 dark:bg-[#0A0A0A]/80 backdrop-blur-xl p-4 border border-slate-200 dark:border-[#1F1F1F] shadow-sm rounded-2xl">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full shadow-[0_0_8px] ${isRunning ? (isPaused ? 'bg-yellow-400 shadow-yellow-400/50' : 'bg-emerald-500 shadow-emerald-500/50 animate-pulse') : 'bg-slate-300 dark:bg-slate-600 shadow-transparent'}`}></div>
                        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            <Activity className="text-brand-primary" />
                            Live Simulation
                        </h2>
                    </div>
                    <div className="h-6 w-px bg-slate-200 dark:bg-[#1F1F1F] mx-2"></div>
                    <div className="flex items-center gap-3">
                        <label className="text-sm font-medium text-slate-500">Asset</label>
                        <input
                            type="text"
                            value={symbol}
                            onChange={(e) => setSymbol(e.target.value)}
                            className="bg-slate-100 dark:bg-[#111] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm font-bold text-slate-900 dark:text-white focus:ring-2 focus:ring-brand-primary outline-none uppercase w-24 text-center"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="flex flex-col items-end">
                        <span className="text-xs text-slate-500 font-medium">Last Price</span>
                        <span className="text-lg font-mono font-bold text-slate-800 dark:text-white">${price.toFixed(2)}</span>
                    </div>
                    <div className="h-8 w-px bg-slate-200 dark:bg-[#1F1F1F]"></div>
                    <div className="flex flex-col items-end">
                        <span className="text-xs text-slate-500 font-medium">Net PnL</span>
                        <span className={`text-lg font-mono font-bold ${pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {pnl >= 0 ? '+' : '-'}${Math.abs(pnl).toFixed(2)}
                        </span>
                    </div>
                    <div className="h-8 w-px bg-slate-200 dark:bg-[#1F1F1F]"></div>
                    <div className="flex flex-col items-end">
                        <span className="text-xs text-slate-500 font-medium">Holdings</span>
                        <span className="text-lg font-mono font-bold text-blue-500">{holdings}</span>
                    </div>
                </div>
            </Card>

            {/* Main Content Area */}
            <div className="flex-1 flex gap-4 min-h-0">
                
                {/* Left Sidebar - Configuration */}
                <Card className="w-80 flex-shrink-0 flex flex-col bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-[#1F1F1F] shadow-sm rounded-2xl overflow-hidden">
                    {/* Main Actions */}
                    <div className="p-4 border-b border-slate-100 dark:border-[#1F1F1F] bg-slate-50/50 dark:bg-white/5">
                        {!isRunning ? (
                            <Button
                                onClick={handleStart}
                                className="w-full bg-brand-primary hover:bg-brand-secondary text-white py-3 rounded-xl font-bold shadow-lg shadow-brand-primary/20 flex items-center justify-center gap-2 transition-all hover:scale-[1.02]"
                            >
                                <Play size={18} fill="currentColor" />
                                START SIMULATION
                            </Button>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <div className="flex gap-2">
                                    {!isPaused ? (
                                        <Button
                                            onClick={handlePause}
                                            className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-yellow-500/20 flex items-center justify-center gap-2"
                                        >
                                            <span className="font-mono">||</span> PAUSE
                                        </Button>
                                    ) : (
                                        <div className="flex flex-1 gap-2">
                                            <Button
                                                onClick={handleResume}
                                                className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-1 text-sm"
                                            >
                                                <Play size={14} fill="currentColor" /> RESUME
                                            </Button>
                                            <Button
                                                onClick={handleStep}
                                                className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/20 flex items-center justify-center gap-1 text-sm"
                                            >
                                                <FastForward size={14} /> STEP
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                <Button
                                    onClick={handleStop}
                                    className="w-full bg-red-500 hover:bg-red-600 text-white py-2 rounded-xl font-bold text-sm shadow-lg shadow-red-500/20 flex items-center justify-center gap-2"
                                >
                                    <Square size={14} fill="currentColor" /> STOP
                                </Button>
                            </div>
                        )}
                    </div>

                    {/* Tabs Header */}
                    <div className="flex border-b border-slate-200 dark:border-[#1F1F1F]">
                        <button 
                            onClick={() => setActiveConfigTab('strategy')} 
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex justify-center items-center gap-1.5 transition-colors ${activeConfigTab === 'strategy' ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <TrendingUp size={14} /> Strategy
                        </button>
                        <button 
                            onClick={() => setActiveConfigTab('execution')} 
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex justify-center items-center gap-1.5 transition-colors ${activeConfigTab === 'execution' ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <SlidersHorizontal size={14} /> Exec
                        </button>
                        <button 
                            onClick={() => setActiveConfigTab('environment')} 
                            className={`flex-1 py-3 text-xs font-bold uppercase tracking-wider flex justify-center items-center gap-1.5 transition-colors ${activeConfigTab === 'environment' ? 'text-brand-primary border-b-2 border-brand-primary bg-brand-primary/5' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                        >
                            <Globe size={14} /> Env
                        </button>
                    </div>

                    {/* Tab Content */}
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        
                        {/* Strategy Tab */}
                        {activeConfigTab === 'strategy' && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Risk Parameters</label>
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Stop Loss</span>
                                            <span className="text-sm font-mono text-brand-primary">{strategyParams.stop_loss}%</span>
                                        </div>
                                        <input
                                            type="range" min="0.01" max="5.0" step="0.01"
                                            value={strategyParams.stop_loss}
                                            onChange={(e) => setStrategyParams({ ...strategyParams, stop_loss: parseFloat(e.target.value) })}
                                            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                        />
                                    </div>
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Take Profit</span>
                                            <span className="text-sm font-mono text-brand-primary">{strategyParams.take_profit}%</span>
                                        </div>
                                        <input
                                            type="range" min="0.01" max="10.0" step="0.01"
                                            value={strategyParams.take_profit}
                                            onChange={(e) => setStrategyParams({ ...strategyParams, take_profit: parseFloat(e.target.value) })}
                                            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Signal Generation</label>
                                    <div>
                                        <div className="flex justify-between mb-1">
                                            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Buy Probability</span>
                                            <span className="text-sm font-mono text-brand-primary">{(strategyParams.buy_probability * 100).toFixed(0)}%</span>
                                        </div>
                                        <input
                                            type="range" min="0" max="1" step="0.05"
                                            value={strategyParams.buy_probability}
                                            onChange={(e) => setStrategyParams({ ...strategyParams, buy_probability: parseFloat(e.target.value) })}
                                            className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                        />
                                    </div>
                                </div>

                                <Button
                                    onClick={handleUpdateParams}
                                    className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 text-sm py-2 rounded-lg font-bold transition-all flex items-center justify-center gap-2 mt-4"
                                    disabled={!isRunning}
                                >
                                    <Settings2 size={16} /> APPLY TO LIVE
                                </Button>
                            </div>
                        )}

                        {/* Execution Tab */}
                        {activeConfigTab === 'execution' && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><BarChart2 size={14}/> Volume Participation</label>
                                    <input
                                        type="range" min="1" max="100" step="1"
                                        value={volumeParticipation}
                                        onChange={(e) => setVolumeParticipation(parseInt(e.target.value))}
                                        className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                    />
                                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                                        <span>Drip Feed (1%)</span>
                                        <span className="text-brand-primary font-bold">{volumeParticipation}%</span>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><DollarSign size={14}/> Commission Structure</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] text-slate-400">Maker Fee (%)</label>
                                            <input
                                                type="number" step="0.01"
                                                value={makerFee}
                                                onChange={(e) => setMakerFee(parseFloat(e.target.value))}
                                                className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-primary transition-colors"
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-slate-400">Taker Fee (%)</label>
                                            <input
                                                type="number" step="0.01"
                                                value={takerFee}
                                                onChange={(e) => setTakerFee(parseFloat(e.target.value))}
                                                className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-primary transition-colors"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Environment Tab */}
                        {activeConfigTab === 'environment' && (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Timeframe</label>
                                        <select className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-primary transition-colors text-slate-700 dark:text-slate-300">
                                            <option>1m</option>
                                            <option>5m</option>
                                            <option>1h</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 block">Initial Cash</label>
                                        <input
                                            type="number"
                                            defaultValue={10000}
                                            className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-brand-primary transition-colors text-slate-700 dark:text-slate-300"
                                        />
                                    </div>
                                </div>

                                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><Wifi size={14}/> Network Latency</label>
                                    <input
                                        type="range" min="0" max="2000" step="50"
                                        value={latency}
                                        onChange={(e) => setLatency(parseInt(e.target.value))}
                                        className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                    />
                                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                                        <span>Instant</span>
                                        <span className="text-brand-primary font-bold">{latency}ms</span>
                                    </div>
                                </div>

                                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><AlertTriangle size={14}/> Simulation Slippage</label>
                                    <input
                                        type="range" min="0" max="5" step="0.1"
                                        value={slippage}
                                        onChange={(e) => setSlippage(parseFloat(e.target.value))}
                                        className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-brand-primary"
                                    />
                                    <div className="flex justify-between text-xs text-slate-500 font-medium">
                                        <span>Zero</span>
                                        <span className="text-brand-primary font-bold">{slippage}%</span>
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-1">Adds price drift and execution noise to simulate real conditions.</p>
                                </div>

                                <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-[#1F1F1F]">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5"><FastForward size={14}/> Playback Engine</label>
                                    <div className="flex bg-slate-100 dark:bg-[#111] p-1 rounded-lg">
                                        {speedOptions.map((opt) => (
                                            <button
                                                key={opt.label}
                                                onClick={() => setPlaybackSpeed(opt.value)}
                                                className={`flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${playbackSpeed === opt.value
                                                    ? 'bg-white dark:bg-[#222] text-brand-primary shadow-sm'
                                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </Card>

                {/* Right Area - Charts & Data */}
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    
                    {/* Top Chart Area */}
                    <Card className="flex-1 bg-white dark:bg-[#0A0A0A] p-4 relative overflow-hidden flex flex-col border border-slate-200 dark:border-[#1F1F1F] rounded-2xl shadow-sm">
                        <div className="absolute top-4 left-4 z-10">
                            <div className="bg-white/50 dark:bg-black/50 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 shadow-sm flex items-center gap-2">
                                <Activity size={14} className={isRunning ? 'text-brand-primary animate-pulse' : 'text-slate-400'} />
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                    {isPaused ? 'PAUSED' : (isRunning ? 'LIVE FEED' : 'READY')} 
                                    {isRunning && <span className="text-brand-primary ml-1">{playbackSpeed === 0 ? '(MAX)' : `(${playbackSpeed}x)`}</span>}
                                </span>
                            </div>
                        </div>
                        <div className="flex-1 w-full h-full mt-2">
                            <SimulationChart
                                ref={chartRef}
                                data={marketData}
                                colors={{
                                    backgroundColor: 'transparent',
                                    textColor: '#94a3b8' // slate-400
                                }}
                            />
                        </div>
                    </Card>

                    {/* Bottom Data Grid */}
                    <div className="h-64 grid grid-cols-3 gap-4 flex-shrink-0">
                        {/* Order Book */}
                        <Card className="col-span-1 bg-white dark:bg-[#0A0A0A] p-0 relative overflow-hidden flex flex-col border border-slate-200 dark:border-[#1F1F1F] rounded-2xl shadow-sm">
                            <div className="bg-slate-50 dark:bg-[#111] border-b border-slate-200 dark:border-[#1F1F1F] px-4 py-2 flex items-center justify-between z-10">
                                <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                                    <Layers size={14} /> Order Book
                                </span>
                            </div>
                            <div className="flex-1 overflow-hidden relative">
                                <OrderBookWidget
                                    bids={bids}
                                    asks={asks}
                                    currentPrice={price}
                                    symbol={symbol}
                                />
                            </div>
                        </Card>

                        {/* Equity Curve */}
                        <Card className="col-span-1 bg-white dark:bg-[#0A0A0A] p-3 relative overflow-hidden flex flex-col border border-slate-200 dark:border-[#1F1F1F] rounded-2xl shadow-sm">
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <TrendingUp size={14} /> Equity Curve
                            </span>
                            <div className="flex-1 w-full relative">
                                <EquityCurve data={equityData} />
                            </div>
                        </Card>

                        {/* System Terminal */}
                        <Card className="col-span-1 bg-slate-900 border border-slate-800 p-0 relative overflow-hidden flex flex-col rounded-2xl shadow-sm">
                            <LogConsole
                                logs={logs}
                                onClear={() => setLogs([])}
                                className="flex-1 bg-transparent"
                            />
                        </Card>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default EventDrivenSimulator;
