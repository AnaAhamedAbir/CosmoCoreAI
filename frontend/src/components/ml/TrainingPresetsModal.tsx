import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Bookmark,
  Star,
  Trash2,
  Download,
  Copy,
  Clock,
  Loader2,
  Plus,
  Layers,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import {
  trainingStudioToolsService,
  TrainingPresetOut,
} from '@/services/trainingStudioToolsService';
import { mlTrainingService, TrainingJob } from '@/services/mlTrainingService';

export interface StudioConfigSnapshot {
  symbol: string;
  timeframe: string;
  algorithm: string;
  dataSource: string;
  config: Record<string, any>;
}

interface TrainingPresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConfig: StudioConfigSnapshot;
  onApplyConfig: (snapshot: {
    symbol: string;
    timeframe: string;
    algorithm: string;
    config: Record<string, any>;
  }) => void;
}

type ModalTab = 'presets' | 'clone';

const JOB_STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  RUNNING: 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  PENDING: 'bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  PAUSED: 'bg-slate-100 dark:bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-500/30',
  FAILED: 'bg-rose-50 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',
};

const formatDateTime = (iso?: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const TrainingPresetsModal: React.FC<TrainingPresetsModalProps> = ({
  isOpen,
  onClose,
  currentConfig,
  onApplyConfig,
}) => {
  const [activeTab, setActiveTab] = useState<ModalTab>('presets');

  // Saved Presets state
  const [presets, setPresets] = useState<TrainingPresetOut[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [isFavorite, setIsFavorite] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Clone Recent Job state
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);
  const [cloningJobId, setCloningJobId] = useState<string | null>(null);

  const loadPresets = useCallback(async () => {
    setIsLoadingPresets(true);
    try {
      const data = await trainingStudioToolsService.listPresets();
      const sorted = [...(data || [])].sort((a, b) => {
        if (a.is_favorite !== b.is_favorite) return a.is_favorite ? -1 : 1;
        return b.id - a.id;
      });
      setPresets(sorted);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to load training presets');
    } finally {
      setIsLoadingPresets(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const data = await mlTrainingService.getJobs();
      const sorted = [...(data || [])]
        .sort(
          (a, b) =>
            new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )
        .slice(0, 25);
      setJobs(sorted);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to load recent training jobs');
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    loadPresets();
    loadJobs();
  }, [isOpen, loadPresets, loadJobs]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = presetName.trim();
    if (!trimmedName) {
      toast.error('Please enter a preset name');
      return;
    }

    setIsSaving(true);
    try {
      const mergedConfig: Record<string, any> = {
        ...(currentConfig.dataSource ? { data_source: currentConfig.dataSource } : {}),
        ...(currentConfig.config || {}),
      };
      await trainingStudioToolsService.createPreset({
        name: trimmedName,
        description: presetDescription.trim() || null,
        symbol: currentConfig.symbol,
        timeframe: currentConfig.timeframe,
        algorithm: currentConfig.algorithm,
        config: mergedConfig,
        is_favorite: isFavorite,
      });
      toast.success(`Saved preset "${trimmedName}"`);
      setPresetName('');
      setPresetDescription('');
      setIsFavorite(false);
      await loadPresets();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to save training preset');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadPreset = (preset: TrainingPresetOut) => {
    onApplyConfig({
      symbol: preset.symbol,
      timeframe: preset.timeframe,
      algorithm: preset.algorithm,
      config: preset.config || {},
    });
    toast.success(`Loaded preset "${preset.name}"`);
    onClose();
  };

  const handleDeletePreset = async (preset: TrainingPresetOut) => {
    setDeletingId(preset.id);
    try {
      await trainingStudioToolsService.deletePreset(preset.id);
      setPresets((prev) => prev.filter((p) => p.id !== preset.id));
      toast.success(`Deleted preset "${preset.name}"`);
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to delete preset');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCloneJob = async (job: TrainingJob) => {
    setCloningJobId(job.id);
    try {
      const cloned = await trainingStudioToolsService.cloneJobConfig(job.id);
      onApplyConfig({
        symbol: cloned.symbol,
        timeframe: cloned.timeframe,
        algorithm: cloned.algorithm,
        config: cloned.config || {},
      });
      toast.success(`Cloned config from ${cloned.symbol} (${cloned.algorithm})`);
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'Failed to clone job configuration');
    } finally {
      setCloningJobId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[115] flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/80 backdrop-blur-md">
        <div className="absolute inset-0" onClick={onClose} />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ duration: 0.18 }}
          className="relative w-full max-w-3xl max-h-[88vh] bg-white dark:bg-[#0B0F17]/95 border border-cyan-500/25 rounded-2xl shadow-xl dark:shadow-[0_0_50px_rgba(6,182,212,0.18)] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-white/10 bg-gradient-to-r from-cyan-500/10 via-blue-500/5 to-transparent">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-cyan-50 dark:bg-cyan-500/15 border border-cyan-200 dark:border-cyan-500/30">
                <Bookmark className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              </div>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white tracking-wide">
                  Training Presets & Job Clone
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Save studio snapshots or clone hyperparameters from recent runs
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-2 px-6 pt-3 pb-2 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/30">
            <button
              type="button"
              onClick={() => setActiveTab('presets')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                activeTab === 'presets'
                  ? 'bg-cyan-50 dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-300 dark:border-cyan-500/40 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                  : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>Saved Presets</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-black/40 text-slate-700 dark:text-inherit text-[10px] font-mono">
                {presets.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('clone')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer border ${
                activeTab === 'clone'
                  ? 'bg-purple-50 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-300 dark:border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.15)]'
                  : 'bg-white dark:bg-white/5 text-slate-600 dark:text-slate-400 border-transparent hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Clone Recent Job</span>
              <span className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-black/40 text-slate-700 dark:text-inherit text-[10px] font-mono">
                {jobs.length}
              </span>
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto flex-1 space-y-5 custom-scrollbar">
            {activeTab === 'presets' ? (
              <>
                {/* Save Current Config Form */}
                <form
                  onSubmit={handleSavePreset}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/10 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300 flex items-center gap-1.5">
                      <Plus className="w-3.5 h-3.5" />
                      Save Current Studio Config
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/25">
                        {currentConfig.symbol}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25">
                        {currentConfig.timeframe}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/25">
                        {currentConfig.algorithm}
                      </span>
                      {currentConfig.dataSource && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                          {currentConfig.dataSource}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                    <input
                      type="text"
                      value={presetName}
                      onChange={(e) => setPresetName(e.target.value)}
                      placeholder="Preset name (e.g. BTC 15m L2 XGBoost)"
                      className="sm:col-span-5 px-3 py-2 rounded-lg bg-white dark:bg-black/50 border border-slate-200 dark:border-white/10 focus:border-cyan-500/50 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none"
                    />
                    <input
                      type="text"
                      value={presetDescription}
                      onChange={(e) => setPresetDescription(e.target.value)}
                      placeholder="Optional description or notes..."
                      className="sm:col-span-5 px-3 py-2 rounded-lg bg-white dark:bg-black/50 border border-slate-200 dark:border-white/10 focus:border-cyan-500/50 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 outline-none"
                    />
                    <div className="sm:col-span-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsFavorite((v) => !v)}
                        title={isFavorite ? 'Favorite enabled' : 'Mark as favorite'}
                        className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                          isFavorite
                            ? 'bg-amber-50 dark:bg-amber-500/20 border-amber-300 dark:border-amber-500/40 text-amber-600 dark:text-amber-300'
                            : 'bg-white dark:bg-black/40 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:text-amber-500 dark:hover:text-amber-300'
                        }`}
                      >
                        <Star className={`w-4 h-4 ${isFavorite ? 'fill-amber-400' : ''}`} />
                      </button>
                      <button
                        type="submit"
                        disabled={isSaving || !presetName.trim()}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                      >
                        {isSaving ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <span>Save</span>
                        )}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Saved Presets List */}
                {isLoadingPresets ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600 dark:text-slate-400 gap-2">
                    <Loader2 className="w-7 h-7 text-cyan-500 dark:text-cyan-400 animate-spin" />
                    <span className="text-xs">Loading saved presets...</span>
                  </div>
                ) : presets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-300 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-white/[0.01]">
                    <Layers className="w-8 h-8 text-slate-400 dark:text-slate-600 mb-2" />
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No saved presets yet</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Save your current studio configuration above for instant reuse.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {presets.map((preset) => (
                      <div
                        key={preset.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/10 transition-colors"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Star
                              className={`w-3.5 h-3.5 shrink-0 ${
                                preset.is_favorite
                                  ? 'text-amber-500 dark:text-amber-400 fill-amber-400'
                                  : 'text-slate-400 dark:text-slate-600'
                              }`}
                            />
                            <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {preset.name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/25 text-[10px] font-mono font-bold">
                              {preset.symbol}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25 text-[10px] font-mono">
                              {preset.timeframe}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/25 text-[10px] font-mono">
                              {preset.algorithm}
                            </span>
                          </div>

                          {preset.description && (
                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                              {preset.description}
                            </p>
                          )}

                          <div className="text-[10px] text-slate-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>Saved {formatDateTime(preset.created_at)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleLoadPreset(preset)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-50 dark:bg-cyan-500/20 hover:bg-cyan-100 dark:hover:bg-cyan-500/30 border border-cyan-200 dark:border-cyan-500/35 text-cyan-700 dark:text-cyan-200 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Load</span>
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === preset.id}
                            onClick={() => handleDeletePreset(preset)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 hover:bg-rose-100 dark:hover:bg-rose-500/20 border border-rose-200 dark:border-rose-500/25 text-rose-700 dark:text-rose-300 text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                            title="Delete preset"
                          >
                            {deletingId === preset.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : isLoadingJobs ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-600 dark:text-slate-400 gap-2">
                <Loader2 className="w-7 h-7 text-purple-500 dark:text-purple-400 animate-spin" />
                <span className="text-xs">Loading recent training jobs...</span>
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-slate-300 dark:border-white/10 rounded-xl bg-slate-50 dark:bg-white/[0.01]">
                <Clock className="w-8 h-8 text-slate-400 dark:text-slate-600 mb-2" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No recent training jobs</p>
                <p className="text-xs text-slate-500 mt-1">
                  Launch a training job in the studio first, then clone its config anytime.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {jobs.map((job) => {
                  const statusClass =
                    JOB_STATUS_STYLES[job.status] ||
                    'bg-slate-100 dark:bg-white/10 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/15';
                  return (
                    <div
                      key={job.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.05] border border-slate-200 dark:border-white/10 transition-colors"
                    >
                      <div className="min-w-0 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-500/25 text-[11px] font-mono font-bold">
                            {job.symbol}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/25 text-[11px] font-mono">
                            {job.timeframe}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/25 text-[11px] font-mono">
                            {job.algorithm}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold uppercase ${statusClass}`}
                          >
                            {job.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                          <span>ID: {job.id.slice(0, 8)}</span>
                          <span>Progress: {Math.round(job.progress ?? 0)}%</span>
                          <span className="flex items-center gap-1 text-slate-500 font-sans">
                            <Clock className="w-3 h-3" />
                            {formatDateTime(job.created_at)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={cloningJobId === job.id}
                        onClick={() => handleCloneJob(job)}
                        className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-purple-50 dark:bg-purple-500/20 hover:bg-purple-100 dark:hover:bg-purple-500/30 border border-purple-200 dark:border-purple-500/35 text-purple-700 dark:text-purple-200 text-xs font-semibold transition-colors disabled:opacity-50 shrink-0 cursor-pointer"
                      >
                        {cloningJobId === job.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>Clone Config</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default TrainingPresetsModal;
