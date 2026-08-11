import React from 'react';
import { motion } from 'framer-motion';
import { Play, Square, Settings, Trash2, Activity, TrendingUp, TrendingDown, Target, ShieldAlert } from 'lucide-react';
import Button from '@/components/common/Button';

export interface ForexBot {
  id: number | string;
  name: string;
  pair: string;
  strategy: string;
  status: 'active' | 'stopped';
  pnl_usd: number;
  pnl_pips: number;
  lot_size: number;
  leverage: number;
  max_drawdown: number;
}

interface ForexBotCardProps {
  bot: ForexBot;
  onToggleStatus: (id: string | number, status: 'active' | 'stopped') => void;
  onSettings: (bot: ForexBot) => void;
  onDelete: (id: string | number) => void;
  onDetails?: (bot: ForexBot) => void;
}

const ForexBotCard: React.FC<ForexBotCardProps> = ({ bot, onToggleStatus, onSettings, onDelete, onDetails }) => {
  const isRunning = bot.status === 'active';
  const isProfitable = bot.pnl_usd >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative p-5 rounded-3xl border backdrop-blur-xl transition-all duration-300 group ${
        isRunning 
          ? 'bg-[#0A101D]/90 border-[#D4AF37]/30 shadow-[0_0_20px_rgba(212,175,55,0.05)]' 
          : 'bg-white/5 dark:bg-[#0A101D]/60 border-gray-200 dark:border-white/10 hover:border-white/20'
      }`}
    >
      {/* Decorative Glow if Running */}
      {isRunning && (
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 animate-ping opacity-75" />
      )}

      {/* Header: Name, Pair, Status */}
      <div className="flex justify-between items-start mb-4" onClick={() => onDetails?.(bot)}>
        <div className="cursor-pointer">
          <h3 className="text-lg font-extrabold text-slate-900 dark:text-white group-hover:text-[#D4AF37] transition-colors flex items-center gap-2">
            {bot.name}
            {isRunning && <Activity size={16} className="text-emerald-500 animate-pulse" />}
          </h3>
          <div className="flex flex-wrap gap-2 mt-1">
            <span className="text-xs font-mono font-bold px-2 py-0.5 bg-white/10 rounded-md text-gray-300 border border-white/5">
              {bot.pair}
            </span>
            <span className="text-xs px-2 py-0.5 bg-[#D4AF37]/10 text-[#D4AF37] rounded-md border border-[#D4AF37]/20">
              {bot.strategy}
            </span>
          </div>
        </div>
        
        {/* PnL Widget */}
        <div className="text-right">
          <p className={`text-xl font-bold font-mono flex items-center justify-end gap-1 ${isProfitable ? 'text-emerald-500' : 'text-red-500'}`}>
            {isProfitable ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
            {isProfitable ? '+' : ''}${Math.abs(bot.pnl_usd).toFixed(2)}
          </p>
          <p className={`text-xs font-mono mt-0.5 ${isProfitable ? 'text-emerald-500/70' : 'text-red-500/70'}`}>
            {isProfitable ? '+' : ''}{bot.pnl_pips.toFixed(1)} Pips
          </p>
        </div>
      </div>

      {/* Market/Risk Context Specs */}
      <div className="grid grid-cols-3 gap-2 mb-5 py-3 border-y border-white/5">
        <div className="text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex justify-center items-center gap-1"><Target size={10}/> Lots</p>
          <p className="text-sm font-bold text-gray-300 font-mono">{bot.lot_size}</p>
        </div>
        <div className="text-center border-x border-white/5">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex justify-center items-center gap-1"><Activity size={10}/> Lev</p>
          <p className="text-sm font-bold text-gray-300 font-mono">1:{bot.leverage}</p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 flex justify-center items-center gap-1"><ShieldAlert size={10}/> Max DD</p>
          <p className="text-sm font-bold text-gray-300 font-mono">{bot.max_drawdown}%</p>
        </div>
      </div>

      {/* Action Controls */}
      <div className="flex items-center justify-between gap-3 mt-4">
        <Button 
          variant="outline" 
          onClick={() => onToggleStatus(bot.id, bot.status)}
          className={`flex-1 flex justify-center items-center gap-2 font-bold transition-all ${
            isRunning 
              ? 'border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500' 
              : 'border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/10 hover:border-emerald-500'
          }`}
        >
          {isRunning ? (
            <><Square size={16} fill="currentColor" /> Halt Algo</>
          ) : (
            <><Play size={16} fill="currentColor" /> Initialize</>
          )}
        </Button>
        
        <div className="flex gap-2">
          <button 
            onClick={() => onSettings(bot)}
            className="p-2.5 rounded-xl border border-white/10 text-gray-400 hover:text-[#D4AF37] hover:border-[#D4AF37]/50 hover:bg-[#D4AF37]/5 transition-colors"
            title="Bot Settings"
          >
            <Settings size={18} />
          </button>
          <button 
            onClick={() => onDelete(bot.id)}
            className="p-2.5 rounded-xl border border-white/10 text-gray-400 hover:text-red-500 hover:border-red-500/50 hover:bg-red-500/5 transition-colors"
            title="Decommission Bot"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default ForexBotCard;
