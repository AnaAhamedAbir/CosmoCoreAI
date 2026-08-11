import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Activity, TrendingUp, TrendingDown, Maximize2, AlertTriangle, ArrowRightLeft } from 'lucide-react';
import Button from '@/components/common/Button';
import { TradingViewWidget } from '@/components/features/market/TradingViewWidget';

import { ChevronDown } from 'lucide-react';

const ForexPairs = () => {
  const [selectedBroker, setSelectedBroker] = useState('Exness');
  const [selectedPair, setSelectedPair] = useState('EUR/USD');
  const [isBrokerDropdownOpen, setIsBrokerDropdownOpen] = useState(false);

  const brokers = ['Exness', 'OANDA', 'IC Markets', 'IG', 'Pepperstone'];

  // Demo pairs specific to brokers to show dynamic behavior
  const brokerPairsData: Record<string, any[]> = {
    'Exness': [
      { symbol: 'EUR/USD', bid: '1.09241', ask: '1.09241', spread: 0.0, change: '+0.15%', broker: 'Exness' },
      { symbol: 'XAU/USD', bid: '2024.50', ask: '2024.55', spread: 0.5, change: '+1.20%', broker: 'Exness' },
      { symbol: 'BTC/USD', bid: '64200.1', ask: '64200.5', spread: 0.4, change: '-2.10%', broker: 'Exness' },
    ],
    'OANDA': [
      { symbol: 'EUR/USD', bid: '1.09245', ask: '1.09247', spread: 0.2, change: '+0.15%', broker: 'OANDA' },
      { symbol: 'GBP/USD', bid: '1.26410', ask: '1.26413', spread: 0.3, change: '-0.08%', broker: 'OANDA' },
      { symbol: 'USD/JPY', bid: '149.325', ask: '149.328', spread: 0.3, change: '+0.42%', broker: 'OANDA' },
    ],
    'IC Markets': [
      { symbol: 'EUR/USD', bid: '1.09242', ask: '1.09243', spread: 0.1, change: '+0.15%', broker: 'IC Markets' },
      { symbol: 'AUD/USD', bid: '0.65210', ask: '0.65211', spread: 0.1, change: '-0.25%', broker: 'IC Markets' },
      { symbol: 'XAU/USD', bid: '2024.50', ask: '2024.60', spread: 1.0, change: '+1.20%', broker: 'IC Markets' },
    ],
    'IG': [
      { symbol: 'GBP/JPY', bid: '188.450', ask: '188.465', spread: 1.5, change: '+0.80%', broker: 'IG' },
      { symbol: 'EUR/GBP', bid: '0.85410', ask: '0.85420', spread: 1.0, change: '-0.12%', broker: 'IG' },
      { symbol: 'EUR/USD', bid: '1.09240', ask: '1.09246', spread: 0.6, change: '+0.15%', broker: 'IG' },
    ],
    'Pepperstone': [
      { symbol: 'USD/CAD', bid: '1.34520', ask: '1.34525', spread: 0.5, change: '+0.30%', broker: 'Pepperstone' },
      { symbol: 'NZD/USD', bid: '0.60850', ask: '0.60855', spread: 0.5, change: '-0.40%', broker: 'Pepperstone' },
      { symbol: 'EUR/USD', bid: '1.09243', ask: '1.09245', spread: 0.2, change: '+0.15%', broker: 'Pepperstone' },
    ]
  };

  const [livePairs, setLivePairs] = useState<any[]>(brokerPairsData['Exness']);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Reset initial data immediately on broker change
    setLivePairs(brokerPairsData[selectedBroker] || []);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/v1/forex/ws/market-data?broker=${encodeURIComponent(selectedBroker)}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'tick_update' && payload.broker === selectedBroker) {
          // We can map the incoming data and compute 'change' since the simulated data doesn't have it
          const updatedPairs = payload.data.map((tick: any) => {
            // Find old pair to keep previous change or calculate flash
            const oldPair = livePairs.find(p => p.symbol === tick.symbol);
            const oldBid = oldPair ? parseFloat(oldPair.bid) : parseFloat(tick.bid);
            const newBid = parseFloat(tick.bid);
            
            let flashClass = '';
            if (newBid > oldBid) flashClass = 'bg-emerald-500/20';
            else if (newBid < oldBid) flashClass = 'bg-red-500/20';
            
            return {
              ...tick,
              change: oldPair ? oldPair.change : '+0.00%', // Keep static change for demo or calculate
              flashClass
            };
          });
          setLivePairs(updatedPairs);
        }
      } catch (e) {
        console.error(e);
      }
    };

    return () => {
      if (ws.readyState === 1) {
        ws.close();
      }
    };
  }, [selectedBroker]);

  // Map our UI broker names to TradingView compatible exchange names for forex
  const tvExchangeMap: Record<string, string> = {
    'OANDA': 'OANDA',
    'IG': 'OANDA', // TradingView uses OANDA/FX_IDC mostly for forex
    'Exness': 'FX_IDC',
    'IC Markets': 'FX_IDC',
    'Pepperstone': 'FX_IDC',
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-[calc(100vh-120px)] flex flex-col gap-6"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-3">
            <LineChart className="text-[#D4AF37]" size={28} />
            Forex Advanced Charting
          </h1>
          <p className="text-gray-500 mt-1">Live market data, spread monitoring, and institutional order flow.</p>
        </div>
        
        <div className="flex gap-3 relative">
          <div 
            className="bg-white/5 border border-white/10 rounded-lg px-4 py-2 flex items-center gap-3 cursor-pointer hover:bg-white/10 transition-colors"
            onClick={() => setIsBrokerDropdownOpen(!isBrokerDropdownOpen)}
          >
            <span className="text-xs text-gray-500">Broker:</span>
            <span className="text-sm font-bold text-[#D4AF37]">{selectedBroker} (Live)</span>
            <ChevronDown size={14} className="text-gray-400" />
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse ml-1" />
          </div>

          {isBrokerDropdownOpen && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-[#0A101D] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
              {brokers.map((broker) => (
                <div
                  key={broker}
                  className={`px-4 py-3 text-sm cursor-pointer hover:bg-white/5 transition-colors ${selectedBroker === broker ? 'text-[#D4AF37] font-bold bg-[#D4AF37]/5' : 'text-gray-300'}`}
                  onClick={() => {
                    setSelectedBroker(broker);
                    setSelectedPair(brokerPairsData[broker][0].symbol); // Auto select first pair
                    setIsBrokerDropdownOpen(false);
                  }}
                >
                  {broker}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area - Split Layout */}
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* Left Sidebar - Pairs List */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          <div className="p-4 rounded-2xl bg-white/5 dark:bg-[#0A101D]/80 border border-gray-200 dark:border-white/10 flex-1 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white">Watchlist</h3>
              <Button variant="outline" className="!p-1.5 border-white/10 text-gray-400 hover:text-white">
                <Maximize2 size={14} />
              </Button>
            </div>
            
            <div className="space-y-2">
              {livePairs.map((pair) => (
                <div 
                  key={pair.symbol} 
                  onClick={() => setSelectedPair(pair.symbol)}
                  className={`p-3 rounded-xl border cursor-pointer transition-all duration-300 ${
                    selectedPair === pair.symbol 
                      ? 'bg-[#D4AF37]/10 border-[#D4AF37]/30 shadow-[0_0_15px_rgba(212,175,55,0.05)]' 
                      : 'bg-transparent border-transparent hover:bg-white/5'
                  } ${pair.flashClass || ''}`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`font-bold ${selectedPair === pair.symbol ? 'text-[#D4AF37]' : 'text-white'}`}>{pair.symbol}</span>
                      {pair.broker && (
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-gray-400">
                          {pair.broker}
                        </span>
                      )}
                    </div>
                    <span className={`text-xs font-bold ${(pair.change || '').startsWith('+') ? 'text-emerald-500' : 'text-red-500'}`}>{pair.change || '+0.00%'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs font-mono">
                    <div className="flex gap-2">
                      <span className="text-red-400">{pair.bid}</span>
                      <span className="text-gray-500">/</span>
                      <span className="text-emerald-400">{pair.ask}</span>
                    </div>
                    <span className="text-gray-500 bg-white/5 px-1.5 py-0.5 rounded">{pair.spread}p</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Spread Warning Widget */}
          <div className="p-4 rounded-2xl bg-orange-500/5 border border-orange-500/20">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="text-orange-500" size={16} />
              <h4 className="font-bold text-orange-500 text-sm">Spread Monitor</h4>
            </div>
            <p className="text-xs text-gray-400 mb-3">Monitoring real-time spreads across all active algorithmic pairs.</p>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white">Avg Spread: <span className="font-mono text-emerald-400">0.8 pips</span></span>
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded text-xs font-bold">NORMAL</span>
            </div>
          </div>
        </div>

        {/* Right Area - Chart and Order Entry (Read Only for Bots) */}
        <div className="flex-1 flex flex-col gap-6">
          {/* Chart Area */}
          <div className="flex-1 rounded-2xl bg-[#131722] border border-white/10 relative overflow-hidden group">
            <TradingViewWidget 
                symbol={selectedPair.replace('/', '')} 
                interval="15m" 
                exchange={tvExchangeMap[selectedBroker] || 'FX_IDC'} 
                theme="dark"
            />
          </div>
          
          {/* Active Bot Operations panel under the chart */}
          <div className="h-32 rounded-2xl bg-white/5 border border-white/10 p-4 flex gap-6 overflow-x-auto">
             <div className="flex-shrink-0 w-64 p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col justify-between">
               <div className="flex justify-between items-center">
                 <span className="text-xs text-gray-400">Current Algorithm</span>
                 <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
               </div>
               <h4 className="text-sm font-bold text-white mt-1">London Scalper v2</h4>
               <div className="flex justify-between items-end mt-2">
                 <span className="text-xs text-gray-500">Status: <span className="text-emerald-400">Searching setup...</span></span>
               </div>
             </div>
             
             <div className="flex-shrink-0 w-64 p-3 rounded-xl bg-white/5 border border-white/5 flex flex-col justify-between opacity-50">
               <div className="flex justify-between items-center">
                 <span className="text-xs text-gray-400">Manual Override</span>
               </div>
               <h4 className="text-sm font-bold text-white mt-1">Direct Execution</h4>
               <div className="flex gap-2 mt-2">
                 <button className="flex-1 py-1 bg-red-500/20 text-red-500 text-xs font-bold rounded">SELL</button>
                 <button className="flex-1 py-1 bg-emerald-500/20 text-emerald-500 text-xs font-bold rounded">BUY</button>
               </div>
             </div>
          </div>
        </div>

      </div>
    </motion.div>
  );
};

export default ForexPairs;
