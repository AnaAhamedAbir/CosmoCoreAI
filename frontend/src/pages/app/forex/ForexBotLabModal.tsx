import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Zap, Sliders, ShieldAlert, Globe } from 'lucide-react';
import Button from '@/components/common/Button';

// Import Tabs
import { ForexBotGeneralTab } from './ForexBotGeneralTab';
import { ForexBotRiskTab } from './ForexBotRiskTab';
import { ForexBotFilterTab } from './ForexBotFilterTab';

interface ForexBotLabModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const ForexBotLabModal: React.FC<ForexBotLabModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [activeTab, setActiveTab] = useState<'general' | 'risk' | 'filters'>('general');
  const [isDeploying, setIsDeploying] = useState(false);

  // --- General Tab State ---
  const [botName, setBotName] = useState('My Forex Algo');
  const [pair, setPair] = useState('EUR/USD');
  const [lotSize, setLotSize] = useState(0.1);
  const [leverage, setLeverage] = useState(100);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('Custom');

  // --- Risk Tab State ---
  const [maxDrawdown, setMaxDrawdown] = useState(5.0);
  const [stopLoss, setStopLoss] = useState(50);
  const [takeProfit, setTakeProfit] = useState(100);
  const [enableTrailingStop, setEnableTrailingStop] = useState(false);
  const [trailingDistance, setTrailingDistance] = useState(20);
  const [enableBreakeven, setEnableBreakeven] = useState(false);
  const [breakevenTrigger, setBreakevenTrigger] = useState(30);

  // --- Filter Tab State ---
  const [useNewsFilter, setUseNewsFilter] = useState(true);
  const [maxSpread, setMaxSpread] = useState(2.5);
  const [sessions, setSessions] = useState({ london: true, ny: true, tokyo: false, sydney: false });
  const [enableAiTrend, setEnableAiTrend] = useState(false);

  if (!isOpen) return null;

  const handleDeploy = async () => {
    setIsDeploying(true);
    try {
      const payload = {
        name: botName,
        pair: pair,
        strategy: selectedStrategy || 'Custom',
        lot_size: lotSize,
        leverage: leverage,
        max_drawdown_percent: maxDrawdown,
        use_news_filter: useNewsFilter,
        max_spread_pips: maxSpread,
        status: 'active',
        config: {
          stop_loss_pips: stopLoss,
          take_profit_pips: takeProfit,
          trailing_stop: enableTrailingStop ? trailingDistance : 0,
          breakeven_trigger: enableBreakeven ? breakevenTrigger : 0,
          trading_sessions: sessions,
          ai_trend_filter: enableAiTrend
        }
      };

      const response = await fetch('/api/v1/forex/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error('Failed to deploy bot');
      
      onSuccess();
    } catch (error) {
      console.error(error);
      alert('Error deploying bot. Check console.');
    } finally {
      setIsDeploying(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General Settings', icon: Sliders },
    { id: 'risk', label: 'Risk Control', icon: ShieldAlert },
    { id: 'filters', label: 'AI & Filters', icon: Globe }
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-[#0A101D] border border-white/10 rounded-3xl w-full max-w-5xl overflow-hidden shadow-2xl flex flex-col max-h-[95vh]"
      >
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-white/5">
          <div>
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap className="text-[#D4AF37]" size={24} />
              Initialize New Forex Unit
            </h2>
            <p className="text-sm text-gray-400 mt-1">Configure parameters for algorithmic deployment</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-full hover:bg-white/10 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 bg-black/20">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-4 px-6 flex items-center justify-center gap-2 text-sm font-semibold transition-all border-b-2 ${
                  isActive 
                    ? 'border-[#D4AF37] text-[#D4AF37] bg-white/5' 
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-6 min-h-[450px]">
          {activeTab === 'general' && (
            <ForexBotGeneralTab 
              botName={botName} setBotName={setBotName}
              pair={pair} setPair={setPair}
              lotSize={lotSize} setLotSize={setLotSize}
              leverage={leverage} setLeverage={setLeverage}
              selectedStrategy={selectedStrategy} setSelectedStrategy={setSelectedStrategy}
            />
          )}

          {activeTab === 'risk' && (
            <ForexBotRiskTab 
              maxDrawdown={maxDrawdown} setMaxDrawdown={setMaxDrawdown}
              stopLoss={stopLoss} setStopLoss={setStopLoss}
              takeProfit={takeProfit} setTakeProfit={setTakeProfit}
              enableTrailingStop={enableTrailingStop} setEnableTrailingStop={setEnableTrailingStop}
              trailingDistance={trailingDistance} setTrailingDistance={setTrailingDistance}
              enableBreakeven={enableBreakeven} setEnableBreakeven={setEnableBreakeven}
              breakevenTrigger={breakevenTrigger} setBreakevenTrigger={setBreakevenTrigger}
            />
          )}

          {activeTab === 'filters' && (
            <ForexBotFilterTab 
              useNewsFilter={useNewsFilter} setUseNewsFilter={setUseNewsFilter}
              maxSpread={maxSpread} setMaxSpread={setMaxSpread}
              sessions={sessions} setSessions={setSessions}
              enableAiTrend={enableAiTrend} setEnableAiTrend={setEnableAiTrend}
            />
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3 mt-auto">
          <Button variant="outline" onClick={onClose} className="border-white/10 text-gray-400 hover:text-white">Cancel</Button>
          <Button 
            onClick={handleDeploy} 
            disabled={isDeploying}
            className="bg-gradient-to-r from-[#D4AF37] to-[#B8942E] text-slate-900 font-bold px-8 hover:shadow-[0_0_20px_rgba(212,175,55,0.4)] border-none"
          >
            {isDeploying ? 'Deploying...' : 'Deploy AI Bot'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

export default ForexBotLabModal;
