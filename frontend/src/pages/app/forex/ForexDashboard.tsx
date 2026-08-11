import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, DollarSign, Percent, TrendingUp, BarChart2, Zap, ShieldAlert, Crosshair, ArrowUpRight, ArrowDownRight, Trash2 } from 'lucide-react';
import Button from '@/components/common/Button';

// Modular Widgets for Forex
const MetricCard = ({ title, value, subtext, icon, trend, isWarning = false }: any) => (
  <motion.div 
    whileHover={{ y: -5 }}
    className={`p-6 rounded-2xl border backdrop-blur-xl ${
      isWarning 
        ? 'bg-red-500/10 border-red-500/20' 
        : 'bg-white/5 dark:bg-[#0A101D]/80 border-gray-200 dark:border-white/10'
    }`}
  >
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-lg ${isWarning ? 'bg-red-500/20 text-red-500' : 'bg-[#D4AF37]/20 text-[#D4AF37]'}`}>
        {icon}
      </div>
      {trend && (
        <span className={`flex items-center text-sm font-bold ${trend === 'up' ? 'text-emerald-500' : 'text-red-500'}`}>
          {trend === 'up' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          {trend === 'up' ? '+2.4%' : '-1.2%'}
        </span>
      )}
    </div>
    <div>
      <h3 className="text-gray-500 dark:text-gray-400 text-sm font-medium mb-1">{title}</h3>
      <p className={`text-2xl font-bold ${isWarning ? 'text-red-500' : 'text-slate-900 dark:text-white'}`}>{value}</p>
      {subtext && <p className="text-xs text-gray-400 mt-2">{subtext}</p>}
    </div>
  </motion.div>
);

const CurrencyStrengthMeter = () => {
  const currencies = [
    { name: 'USD', strength: 85, color: 'bg-emerald-500' },
    { name: 'EUR', strength: 42, color: 'bg-orange-500' },
    { name: 'JPY', strength: 15, color: 'bg-red-500' },
    { name: 'GBP', strength: 65, color: 'bg-emerald-400' },
    { name: 'CHF', strength: 70, color: 'bg-emerald-400' },
    { name: 'AUD', strength: 30, color: 'bg-orange-400' },
  ];

  return (
    <div className="p-6 rounded-2xl border bg-white/5 dark:bg-[#0A101D]/80 border-gray-200 dark:border-white/10">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <BarChart2 className="text-[#D4AF37]" size={20} />
          Live Currency Strength
        </h3>
        <span className="text-xs px-2 py-1 bg-[#D4AF37]/10 text-[#D4AF37] rounded-md font-mono">15m Timeframe</span>
      </div>
      <div className="space-y-4">
        {currencies.map((c) => (
          <div key={c.name} className="flex items-center gap-4">
            <span className="w-10 text-sm font-bold text-gray-500 dark:text-gray-300">{c.name}</span>
            <div className="flex-1 h-3 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${c.strength}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                className={`h-full ${c.color}`}
              />
            </div>
            <span className="w-8 text-right text-xs font-mono text-gray-400">{c.strength}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const ActiveBotsSummary = () => {
  const [bots, setBots] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBots = async () => {
    try {
      const res = await fetch('/api/v1/forex/bots');
      const data = await res.json();
      setBots(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    fetchBots();
    // Auto-refresh every 10 seconds
    const interval = setInterval(fetchBots, 10000);
    return () => clearInterval(interval);
  }, []);

  const toggleStatus = async (botId: number, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'stopped' : 'active';
    try {
      await fetch(`/api/v1/forex/bots/${botId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      fetchBots();
    } catch (err) {
      console.error("Failed to update bot status", err);
    }
  };

  const deleteBot = async (botId: number) => {
    if (!confirm("Are you sure you want to permanently delete this bot?")) return;
    try {
      await fetch(`/api/v1/forex/bots/${botId}`, {
        method: 'DELETE'
      });
      fetchBots();
    } catch (err) {
      console.error("Failed to delete bot", err);
    }
  };

  return (
    <div className="p-6 rounded-2xl border bg-white/5 dark:bg-[#0A101D]/80 border-gray-200 dark:border-white/10">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Zap className="text-[#D4AF37]" size={20} />
          Active Algo Fleet
        </h3>
        <Button variant="outline" className="text-xs border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37]/10" onClick={fetchBots}>Refresh</Button>
      </div>
      <div className="space-y-3">
        {isLoading ? (
            <p className="text-gray-500 text-sm">Loading fleet...</p>
        ) : bots.length === 0 ? (
            <p className="text-gray-500 text-sm">No bots deployed yet.</p>
        ) : (
            bots.slice(0, 5).map((bot: any) => (
            <div key={bot.id} className="flex flex-col p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 gap-3">
                <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${bot.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                    <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{bot.name}</p>
                    <p className="text-xs text-gray-500">{bot.pair} | {bot.strategy}</p>
                    </div>
                </div>
                <div className="text-right flex items-center gap-4">
                    <div>
                        <p className={`text-sm font-bold font-mono ${bot.total_pnl >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {bot.total_pnl >= 0 ? '+' : ''}{bot.total_pnl} PnL
                        </p>
                        <p className="text-xs text-gray-500 uppercase">{bot.status}</p>
                    </div>
                </div>
                </div>
                
                {/* Control Action */}
                <div className="flex justify-between items-center border-t border-white/5 pt-2 mt-1">
                    <button 
                        onClick={() => deleteBot(bot.id)}
                        className="text-gray-500 hover:text-red-500 transition-colors p-1"
                        title="Delete Bot"
                    >
                        <Trash2 size={16} />
                    </button>
                    <button 
                        onClick={() => toggleStatus(bot.id, bot.status)}
                        className={`text-xs px-3 py-1 rounded-md font-bold transition-colors ${bot.status === 'active' ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30'}`}
                    >
                        {bot.status === 'active' ? 'STOP BOT' : 'START BOT'}
                    </button>
                </div>
            </div>
            ))
        )}
      </div>
    </div>
  );
};

const ForexDashboard = () => {
  const [metrics, setMetrics] = useState({
    floating_pnl: 0,
    floating_pips: 0,
    margin_level_percent: 0,
    free_margin: 0,
    daily_swap_fees: 0,
    active_bots_count: 0,
    total_bots_count: 0
  });

  React.useEffect(() => {
    fetch('/api/v1/forex/dashboard')
      .then(res => res.json())
      .then(data => setMetrics(data))
      .catch(err => console.error("Failed to load forex metrics", err));
  }, []);

  const handleEmergencyStop = async () => {
    if (!confirm("EMERGENCY STOP: This will halt all active algorithms immediately. Proceed?")) return;
    try {
      await fetch('/api/v1/forex/bots/emergency-stop', { method: 'POST' });
      alert("All active bots have been successfully halted.");
      window.location.reload();
    } catch (err) {
      console.error("Failed to execute emergency stop", err);
      alert("Failed to execute emergency stop. Check console.");
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-[#0A101D] to-[#121A2F] p-8 rounded-3xl border border-[#D4AF37]/20 shadow-[0_0_40px_rgba(212,175,55,0.05)] relative overflow-hidden">
        {/* Decorative Gold Glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/10 rounded-full blur-[80px] pointer-events-none" />
        
        <div className="z-10">
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 mb-2">Forex Command Center</h1>
          <p className="text-gray-400">100% Automated Algorithmic Trading Desk</p>
        </div>
        <div className="flex gap-3 z-10">
          <Button onClick={handleEmergencyStop} variant="secondary" className="bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 hover:text-red-500 hover:border-red-500 transition-colors">
            <ShieldAlert size={16} className="mr-2" />
            Global Emergency Stop
          </Button>
          <Button className="bg-gradient-to-r from-[#D4AF37] to-[#B8942E] text-slate-900 font-bold hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] border-none">
            <Crosshair size={16} className="mr-2" />
            Deploy New Bot
          </Button>
        </div>
      </div>

      {/* Top Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard 
          title="Floating PnL" 
          value={metrics.floating_pnl >= 0 ? `+$${metrics.floating_pnl.toFixed(2)}` : `-$${Math.abs(metrics.floating_pnl).toFixed(2)}`} 
          subtext={`${metrics.floating_pips >= 0 ? '+' : ''}${metrics.floating_pips.toFixed(1)} Pips across ${metrics.active_bots_count} pairs`} 
          icon={<DollarSign size={24} />} 
          trend={metrics.floating_pnl >= 0 ? "up" : "down"} 
        />
        <MetricCard 
          title="Margin Level" 
          value={`${metrics.margin_level_percent.toFixed(1)}%`} 
          subtext="Healthy. Liquidation at 100%" 
          icon={<Percent size={24} />} 
        />
        <MetricCard 
          title="Free Margin" 
          value={`$${metrics.free_margin.toFixed(2)}`} 
          subtext="Available for new bot deployments" 
          icon={<Activity size={24} />} 
        />
        <MetricCard 
          title="Daily Swap Fees" 
          value={`$${metrics.daily_swap_fees.toFixed(2)}`} 
          subtext="Rollover costs for open positions" 
          icon={<TrendingUp size={24} />} 
          isWarning={metrics.daily_swap_fees < -10}
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
           {/* Placeholder for TradingView Chart - Will build in ForexPairs */}
           <div className="p-6 rounded-2xl border bg-white/5 dark:bg-[#0A101D]/80 border-gray-200 dark:border-white/10 h-[400px] flex flex-col items-center justify-center relative overflow-hidden group">
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5"></div>
             <Activity className="text-gray-600 mb-4 animate-bounce" size={48} />
             <h3 className="text-xl font-bold text-gray-400">Master Portfolio Chart</h3>
             <p className="text-sm text-gray-500 mt-2">Aggregated equity curve of all active algorithms</p>
             <Button variant="outline" className="mt-6 border-gray-600 text-gray-400 group-hover:border-[#D4AF37] group-hover:text-[#D4AF37] transition-colors">
               Connect Broker API to View
             </Button>
           </div>
        </div>
        <div className="space-y-6">
          <CurrencyStrengthMeter />
          <ActiveBotsSummary />
        </div>
      </div>
    </motion.div>
  );
};

export default ForexDashboard;
