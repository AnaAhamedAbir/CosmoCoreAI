import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Rocket,
  Bot,
  Pin,
  PinOff,
  RefreshCw,
  Sliders,
  Loader2,
  Cpu,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { mlModelsService } from '@/services/mlModelsService';
import {
  trainingStudioToolsService,
  WallHunterBotItem,
  ManualTradePinInfo,
} from '@/services/trainingStudioToolsService';
import { CustomMLModel } from '@/types';

interface OneClickDeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialModelId?: string | null;
}

export const OneClickDeployModal: React.FC<OneClickDeployModalProps> = ({
  isOpen,
  onClose,
  initialModelId,
}) => {
  const [models, setModels] = useState<CustomMLModel[]>([]);
  const [bots, setBots] = useState<WallHunterBotItem[]>([]);
  const [pinned, setPinned] = useState<ManualTradePinInfo | null>(null);

  const [selectedModelId, setSelectedModelId] = useState<string>('');
  const [selectedBotId, setSelectedBotId] = useState<number | ''>('');
  const [minConfidence, setMinConfidence] = useState<number>(0.60);

  const [isLoading, setIsLoading] = useState(false);
  const [isDeployingBot, setIsDeployingBot] = useState(false);
  const [isPinning, setIsPinning] = useState(false);
  const [isUnpinning, setIsUnpinning] = useState(false);
  const [isRetraining, setIsRetraining] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [allModels, botList, pinInfo] = await Promise.all([
        mlModelsService.getModels(),
        trainingStudioToolsService.getWallHunterBots(),
        trainingStudioToolsService.getPinnedManualTradeModel().catch(() => null),
      ]);

      // Crypto-only models with an active trained version
      const cryptoModels = (allModels || []).filter(
        (m) => Boolean(m.activeVersionId) && m.marketType !== 'forex'
      );
      setModels(cryptoModels);
      setBots(botList || []);
      setPinned(pinInfo);

      setSelectedModelId((prev) => {
        if (initialModelId && cryptoModels.some((m) => m.id === initialModelId)) {
          return initialModelId;
        }
        if (prev && cryptoModels.some((m) => m.id === prev)) {
          return prev;
        }
        if (pinInfo?.model_id && cryptoModels.some((m) => m.id === pinInfo.model_id)) {
          return pinInfo.model_id;
        }
        return cryptoModels[0]?.id ?? '';
      });

      setSelectedBotId((prev) => {
        const list = botList || [];
        if (prev !== '' && list.some((b) => b.id === prev)) {
          return prev;
        }
        return list[0]?.id ?? '';
      });
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to load deployment targets');
    } finally {
      setIsLoading(false);
    }
  }, [initialModelId]);

  useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen, loadData]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) || null,
    [models, selectedModelId]
  );

  const selectedBot = useMemo(
    () => bots.find((b) => b.id === selectedBotId) || null,
    [bots, selectedBotId]
  );

  const resolveModelLabel = useCallback(
    (modelId?: string | null) => {
      if (!modelId) return 'None';
      const found = models.find((m) => m.id === modelId);
      return found ? `${found.name} (${found.modelType})` : modelId.slice(0, 8);
    },
    [models]
  );

  const handleDeployToWallHunter = async () => {
    if (!selectedModelId || selectedBotId === '') return;
    setIsDeployingBot(true);
    try {
      const res = await trainingStudioToolsService.deployToWallHunter({
        bot_id: Number(selectedBotId),
        model_id: selectedModelId,
        enable_ml_filter: true,
        min_confidence: minConfidence,
      });
      toast.success(
        res.live_reloaded ? 'Hot-reloaded active bot!' : 'Bot config updated!'
      );
      const refreshedBots = await trainingStudioToolsService.getWallHunterBots();
      setBots(refreshedBots || []);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to deploy model to WallHunter bot');
    } finally {
      setIsDeployingBot(false);
    }
  };

  const handlePinManualTrade = async () => {
    if (!selectedModelId) return;
    setIsPinning(true);
    try {
      const res = await trainingStudioToolsService.pinManualTradeModel({
        model_id: selectedModelId,
        min_confidence: minConfidence,
        enabled: true,
      });
      setPinned(res.pinned);
      toast.success(`Pinned "${res.pinned.model_name}" as default Manual Trade filter`);
      const refreshedPin = await trainingStudioToolsService
        .getPinnedManualTradeModel()
        .catch(() => res.pinned);
      setPinned(refreshedPin);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to pin model for Manual Trade');
    } finally {
      setIsPinning(false);
    }
  };

  const handleUnpinManualTrade = async () => {
    setIsUnpinning(true);
    try {
      await trainingStudioToolsService.unpinManualTradeModel();
      const refreshedPin = await trainingStudioToolsService
        .getPinnedManualTradeModel()
        .catch(() => null);
      setPinned(refreshedPin);
      toast.success('Unpinned Manual Trade ML filter model');
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to unpin Manual Trade model');
    } finally {
      setIsUnpinning(false);
    }
  };

  const handleOneClickRetrain = async () => {
    if (!selectedModelId) return;
    setIsRetraining(true);
    try {
      const res = await trainingStudioToolsService.triggerOneClickRetrain(selectedModelId);
      toast.success(
        `Retrain queued: ${res.symbol} (${res.algorithm}) · Job ${res.job_id.slice(0, 8)}`
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to trigger 1-Click Retrain');
    } finally {
      setIsRetraining(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-black/60 dark:bg-black/80 backdrop-blur-md">
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-3xl max-h-[90vh] bg-white dark:bg-[#0B0F17]/95 border border-emerald-200 dark:border-emerald-500/25 rounded-2xl shadow-2xl dark:shadow-[0_0_55px_rgba(16,185,129,0.18)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-emerald-50 dark:from-emerald-500/10 via-cyan-50/50 dark:via-cyan-500/5 to-transparent">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30">
                <Rocket className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-wide">
                    1-Click Crypto Model Deploy
                  </h2>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase text-emerald-700 dark:text-emerald-300">
                    Crypto Only
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Hot-reload WallHunter bots or pin as your default Manual Trade ML filter
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-14 text-slate-500 dark:text-slate-400 gap-2">
                <Loader2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 animate-spin" />
                <span className="text-xs">Loading crypto models & deployment targets...</span>
              </div>
            ) : (
              <>
                {/* Model + Confidence Controls */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10">
                  <div className="md:col-span-7 space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Target Crypto Model
                    </label>
                    {models.length === 0 ? (
                      <div className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-xs text-amber-700 dark:text-amber-300">
                        No active crypto models found. Train and activate a model first.
                      </div>
                    ) : (
                      <select
                        value={selectedModelId}
                        onChange={(e) => setSelectedModelId(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-lg bg-white dark:bg-black/60 border border-slate-200 dark:border-white/15 focus:border-emerald-500/50 text-xs font-semibold text-slate-900 dark:text-white outline-none cursor-pointer"
                      >
                        {models.map((m) => {
                          const activeVer = m.versions?.find(
                            (v) => v.id === m.activeVersionId
                          );
                          return (
                            <option key={m.id} value={m.id} className="bg-white dark:bg-gray-900 text-slate-900 dark:text-white">
                              {m.name} ({m.modelType}) · v{activeVer?.version ?? '1'}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {selectedModel && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2 pt-0.5">
                        <span className="font-mono text-emerald-700 dark:text-emerald-300/90">
                          {selectedModel.modelType}
                        </span>
                        <span>•</span>
                        <span>ID: {selectedModel.id.slice(0, 8)}</span>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <Sliders className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                        Confidence Threshold
                      </label>
                      <span className="px-2 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30 text-xs font-mono font-bold text-cyan-700 dark:text-cyan-300">
                        {(minConfidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="pt-2">
                      <input
                        type="range"
                        min={0.40}
                        max={0.90}
                        step={0.01}
                        value={minConfidence}
                        onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
                        className="w-full accent-emerald-500 dark:accent-emerald-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
                        <span>40%</span>
                        <span>60% (Default)</span>
                        <span>90%</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Two Deployment Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Card A — Deploy to WallHunter Bot */}
                  <div className="flex flex-col justify-between p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-blue-200 dark:border-blue-500/25 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30">
                            <Bot className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Deploy to WallHunter Bot
                          </h3>
                        </div>
                        {selectedBot && (
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${
                              selectedBot.status?.toLowerCase() === 'active'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                : 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30'
                            }`}
                          >
                            {selectedBot.status?.toLowerCase() === 'active'
                              ? 'active'
                              : 'inactive'}
                          </span>
                        )}
                      </div>

                      {bots.length === 0 ? (
                        <div className="p-3 rounded-lg bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
                          No WallHunter bots found for your account.
                        </div>
                      ) : (
                        <>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              Select Bot
                            </label>
                            <select
                              value={selectedBotId}
                              onChange={(e) => setSelectedBotId(Number(e.target.value))}
                              className="w-full px-3 py-2 rounded-lg bg-white dark:bg-black/60 border border-slate-200 dark:border-white/15 focus:border-blue-500/50 text-xs font-semibold text-slate-900 dark:text-white outline-none cursor-pointer"
                            >
                              {bots.map((bot) => (
                                <option key={bot.id} value={bot.id} className="bg-white dark:bg-gray-900 text-slate-900 dark:text-white">
                                  {bot.name} · {bot.market} [{bot.status}] ·{' '}
                                  {bot.current_ai_model_id
                                    ? resolveModelLabel(bot.current_ai_model_id)
                                    : 'No AI Model'}
                                </option>
                              ))}
                            </select>
                          </div>

                          {selectedBot && (
                            <div className="p-2.5 rounded-lg bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 space-y-1 text-[11px]">
                              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                <span>Market / Exchange</span>
                                <span className="font-mono text-slate-900 dark:text-white">
                                  {selectedBot.market} ({selectedBot.exchange})
                                </span>
                              </div>
                              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 gap-2">
                                <span>Attached Model</span>
                                <span className="font-mono text-blue-600 dark:text-blue-300 truncate">
                                  {resolveModelLabel(selectedBot.current_ai_model_id)}
                                </span>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={
                        !selectedModelId || selectedBotId === '' || isDeployingBot
                      }
                      onClick={handleDeployToWallHunter}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-500/15 dark:bg-blue-500/20 hover:bg-blue-500/25 dark:hover:bg-blue-500/30 border border-blue-400 dark:border-blue-500/40 text-blue-700 dark:text-blue-200 text-xs font-bold transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isDeployingBot ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Zap className="w-4 h-4 text-blue-600 dark:text-blue-300" />
                      )}
                      <span>Deploy & Hot-Reload Bot</span>
                    </button>
                  </div>

                  {/* Card B — Pin to Manual Trade ML Filter */}
                  <div className="flex flex-col justify-between p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-amber-200 dark:border-amber-500/25 space-y-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30">
                            <Pin className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                            Pin to Manual Trade ML Filter
                          </h3>
                        </div>
                        {pinned && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono font-bold uppercase text-amber-700 dark:text-amber-300">
                            PINNED
                          </span>
                        )}
                      </div>

                      {pinned ? (
                        <div className="p-3 rounded-lg bg-white dark:bg-black/45 border border-amber-200 dark:border-amber-500/25 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white truncate">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                <span className="truncate">{pinned.model_name}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                                {pinned.algorithm}
                                {pinned.symbol ? ` · ${pinned.symbol}` : ''} · Min{' '}
                                {(pinned.min_confidence * 100).toFixed(0)}%
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isUnpinning}
                              onClick={handleUnpinManualTrade}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-[11px] font-semibold transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                            >
                              {isUnpinning ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <PinOff className="w-3 h-3" />
                              )}
                              <span>Unpin</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-lg bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 text-xs text-slate-500 dark:text-slate-400">
                          No default model pinned yet. Pinning auto-selects this model
                          when opening the Manual Trade modal.
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={!selectedModelId || isPinning}
                      onClick={handlePinManualTrade}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/15 dark:bg-amber-500/20 hover:bg-amber-500/25 dark:hover:bg-amber-500/30 border border-amber-400 dark:border-amber-500/40 text-amber-800 dark:text-amber-200 text-xs font-bold transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                    >
                      {isPinning ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Pin className="w-4 h-4 text-amber-600 dark:text-amber-300" />
                      )}
                      <span>Pin as Default Manual Trade Filter</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer Quick Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/40">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Need fresh market data weights before deploying?
            </span>
            <button
              type="button"
              disabled={!selectedModelId || isRetraining || isLoading}
              onClick={handleOneClickRetrain}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/35 text-emerald-700 dark:text-emerald-300 text-xs font-bold transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
            >
              {isRetraining ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>1-Click Retrain</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default OneClickDeployModal;
