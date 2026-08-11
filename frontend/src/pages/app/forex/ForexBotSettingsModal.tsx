import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Settings, ShieldAlert, Target } from 'lucide-react';
import Button from '@/components/common/Button';
import { ForexBot } from '@/components/features/forex/ForexBotCard';

interface ForexBotSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bot: ForexBot | null;
  onUpdate: (bot: ForexBot) => void;
}

const ForexBotSettingsModal: React.FC<ForexBotSettingsModalProps> = ({ isOpen, onClose, bot, onUpdate }) => {
  const [lotSize, setLotSize] = useState(0.1);
  const [maxDrawdown, setMaxDrawdown] = useState(5.0);
  const [takeProfit, setTakeProfit] = useState(20);
  const [stopLoss, setStopLoss] = useState(10);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (bot) {
      setLotSize(bot.lot_size || 0.1);
      setMaxDrawdown(bot.max_drawdown || 5.0);
      // We don't have default_take_profit in the ForexBot type yet, but we will assume 20/10 for UI mapping
      // or we can fetch full bot details in a real scenario
      setTakeProfit(20); 
      setStopLoss(10);   
    }
  }, [bot]);

  if (!isOpen || !bot) return null;

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const payload = {
        lot_size: lotSize,
        max_drawdown_percent: maxDrawdown,
        default_take_profit: takeProfit,
        default_stop_loss: stopLoss
      };

      const res = await fetch(`/api/v1/forex/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error('Failed to update settings');
      const data = await res.json();
      
      const updatedBot = {
        ...bot,
        lot_size: data.lot_size,
        max_drawdown: data.max_drawdown_percent,
        // Since frontend bot doesn't currently display TP/SL in the card, we just pass the rest
      };
      
      onUpdate(updatedBot);
      onClose();
    } catch (error) {
      console.error(error);
      alert('Error updating bot settings.');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#0A101D] border border-white/10 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Settings className="text-[#D4AF37]" size={24} />
              Algorithm Parameters
            </h2>
            <p className="text-sm text-gray-400 mt-1">Adjust risk and execution logic for <span className="text-white font-mono">{bot.name}</span></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Main settings */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2"><Target size={14}/> Lot Sizing</label>
              <div className="flex gap-2">
                <input 
                  type="number" 
                  value={lotSize} 
                  onChange={(e) => setLotSize(parseFloat(e.target.value))}
                  step="0.01"
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37] font-mono" 
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2"><ShieldAlert size={14}/> Max Drawdown %</label>
              <input 
                type="number" 
                value={maxDrawdown} 
                onChange={(e) => setMaxDrawdown(parseFloat(e.target.value))}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-[#D4AF37] font-mono" 
              />
            </div>
          </div>

          <div className="border-t border-white/10 pt-6">
             <h3 className="text-sm font-bold text-gray-300 mb-4">Advanced Execution (Pips)</h3>
             <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-emerald-500 mb-1">Take Profit</label>
                  <input 
                    type="number" 
                    value={takeProfit} 
                    onChange={(e) => setTakeProfit(parseFloat(e.target.value))}
                    className="w-full bg-black/50 border border-emerald-500/20 rounded-xl p-2.5 text-white focus:outline-none focus:border-emerald-500 font-mono" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-red-500 mb-1">Stop Loss</label>
                  <input 
                    type="number" 
                    value={stopLoss} 
                    onChange={(e) => setStopLoss(parseFloat(e.target.value))}
                    className="w-full bg-black/50 border border-red-500/20 rounded-xl p-2.5 text-white focus:outline-none focus:border-red-500 font-mono" 
                  />
                </div>
             </div>
          </div>
        </div>

        <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3">
          <Button variant="outline" onClick={onClose} className="border-white/10 text-gray-400 hover:text-white">Cancel</Button>
          <Button 
            onClick={handleUpdate} 
            disabled={isUpdating}
            className="bg-[#D4AF37]/10 text-[#D4AF37] border-[#D4AF37]/30 hover:bg-[#D4AF37]/20 font-bold px-6 transition-colors"
          >
            {isUpdating ? 'Applying...' : 'Apply Changes'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default ForexBotSettingsModal;
