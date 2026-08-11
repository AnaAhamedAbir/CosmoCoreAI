import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Plus, Settings, Activity, Zap, Server } from 'lucide-react';
import Button from '@/components/common/Button';
import ForexBotCard, { ForexBot } from '@/components/features/forex/ForexBotCard';
import ForexBotLabModal from './ForexBotLabModal';
import ForexBotSettingsModal from './ForexBotSettingsModal';

const ForexBotLab = () => {
  const [bots, setBots] = useState<ForexBot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Modal States
  const [isCreating, setIsCreating] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedBotForSettings, setSelectedBotForSettings] = useState<ForexBot | null>(null);

  // Fetch from backend
  const fetchBots = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/v1/forex/bots');
      if (response.ok) {
        const data = await response.json();
        const mappedBots = data.map((b: any) => ({
          ...b,
          pnl_usd: b.total_pnl || 0,
          pnl_pips: b.total_pips || 0,
        }));
        setBots(mappedBots);
      }
    } catch (error) {
      console.error("Failed to load bots:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBots();
  }, []);

  const handleToggleStatus = async (id: string | number, currentStatus: 'active' | 'stopped') => {
    const newStatus = currentStatus === 'active' ? 'stopped' : 'active';
    // Optimistic UI update
    setBots(prev => prev.map(b => b.id === id ? { ...b, status: newStatus } : b));
    
    try {
      await fetch(`/api/v1/forex/bots/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteBot = async (id: string | number) => {
    if (!window.confirm('Are you sure you want to permanently decommission this forex bot?')) return;
    
    // Optimistic UI update
    setBots(prev => prev.filter(b => b.id !== id));
    
    try {
      await fetch(`/api/v1/forex/bots/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateBotSettings = (updatedBot: ForexBot) => {
    setBots(prev => prev.map(b => b.id === updatedBot.id ? updatedBot : b));
  };

  const handleCreationSuccess = () => {
    setIsCreating(false);
    fetchBots();
  };

  // Aggregate Metrics
  const activeBotsCount = bots.filter(b => b.status === 'active').length;
  const totalPnL = bots.reduce((sum, b) => sum + b.pnl_usd, 0);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-10 relative"
    >
      {/* Background Decor */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#D4AF37]/5 rounded-full blur-[120px] pointer-events-none -z-10" />

      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-white to-gray-400 flex items-center gap-3">
            <Server className="text-[#D4AF37]" size={28} />
            Forex Global Bot Manager
          </h1>
          <p className="text-sm text-gray-400 mt-2 font-light">
            Centralized Command for High-Frequency FX Algorithms
          </p>
        </div>

        <div className="flex gap-3 items-center">
           {/* Mini Aggregate Stats Widget */}
           <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl px-4 py-2 mr-2">
             <div className="text-center">
               <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Active</p>
               <p className="text-sm font-bold text-white flex items-center gap-1 justify-center">
                 <Activity size={12} className="text-emerald-500" /> {activeBotsCount}/{bots.length}
               </p>
             </div>
             <div className="w-px h-8 bg-white/10"></div>
             <div className="text-center">
               <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Net PnL</p>
               <p className={`text-sm font-bold font-mono ${totalPnL >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                 {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
               </p>
             </div>
           </div>

          <Button 
            onClick={() => setIsCreating(true)}
            className="bg-gradient-to-r from-[#D4AF37] to-[#B8942E] text-slate-900 font-bold px-6 py-2.5 rounded-xl hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] border-none flex items-center gap-2"
          >
            <Plus size={18} /> Deploy New Bot
          </Button>
        </div>
      </div>

      {/* Bot Grid */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 text-[#D4AF37]">
          <Activity size={40} className="animate-spin mb-4" />
          <p className="text-sm text-gray-400">Syncing with Forex execution servers...</p>
        </div>
      ) : bots.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-3xl p-12 flex flex-col items-center justify-center text-center bg-white/5">
          <Zap size={48} className="text-gray-600 mb-4" />
          <h3 className="text-xl font-bold text-white mb-2">No Active Algorithms</h3>
          <p className="text-gray-400 mb-6 max-w-md">Your Global Bot Manager is currently empty. Deploy a new FX algorithmic unit to start automating your trades.</p>
          <Button onClick={() => setIsCreating(true)} className="border-[#D4AF37] text-[#D4AF37] hover:bg-[#D4AF37]/10">
             Initialize First Bot
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {bots.map((bot) => (
            <ForexBotCard 
              key={bot.id} 
              bot={bot} 
              onToggleStatus={handleToggleStatus}
              onSettings={(b) => {
                setSelectedBotForSettings(b);
                setIsSettingsOpen(true);
              }}
              onDelete={handleDeleteBot}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      <ForexBotLabModal 
        isOpen={isCreating} 
        onClose={() => setIsCreating(false)} 
        onSuccess={handleCreationSuccess} 
      />
      
      <ForexBotSettingsModal 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        bot={selectedBotForSettings}
        onUpdate={handleUpdateBotSettings}
      />
    </motion.div>
  );
};

export default ForexBotLab;
