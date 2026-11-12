import apiClient from '@/services/client';

export interface PreFlightRequest {
  symbol: string;
  timeframe?: string;
  data_source?: string;
  exchange?: string;
  dataset_file?: string | null;
  features?: string[];
  prediction_target?: string;
  lookback_limit?: number;
}

export interface NanColumnInfo {
  column: string;
  missing_count: number;
  missing_pct: number;
}

export interface LeakageRiskInfo {
  column: string;
  reason: string;
  correlation?: number | null;
}

export interface PreFlightResponse {
  total_rows: number;
  feature_count: number;
  missing_pct: number;
  nan_columns: NanColumnInfo[];
  duplicate_rows: number;
  constant_columns: string[];
  outlier_pct: number;
  class_balance?: Record<string, number> | null;
  leakage_risks: LeakageRiskInfo[];
  health_score: number;
  status: 'PASS' | 'WARN' | 'FAIL';
  warnings: string[];
  recommendations: string[];
}

export interface TopFeatureItem {
  name: string;
  importance: number;
}

export interface ModelCompareItem {
  model_id: string;
  name: string;
  algorithm: string;
  symbol?: string | null;
  timeframe?: string | null;
  data_source?: string | null;
  active_version_id?: string | null;
  version?: number | null;
  accuracy?: number | null;
  f1_score?: number | null;
  latency?: number | null;
  profit_pct?: number | null;
  win_rate?: number | null;
  max_drawdown?: number | null;
  kelly_pct?: number | null;
  sharpe_or_var?: number | null;
  total_trades?: number | null;
  optuna_trials_count: number;
  top_features: TopFeatureItem[];
  created_at?: string | null;
}

export interface WorkerQueueJobItem {
  job_id: string;
  symbol: string;
  algorithm: string;
  status: string;
  progress: number;
  elapsed_seconds: number;
  eta_seconds?: number | null;
  is_mine: boolean;
}

export interface WorkerQueueStatusOut {
  active_jobs: number;
  queued_jobs: number;
  user_active_jobs: number;
  user_queued_jobs: number;
  celery_workers_online: number;
  estimated_wait_seconds: number;
  jobs: WorkerQueueJobItem[];
}

export interface OptunaTrialItem {
  number: number;
  value?: number | null;
  params: Record<string, any>;
  state: string;
}

export interface OptunaTrialsOut {
  model_id: string;
  model_name: string;
  algorithm: string;
  trials: OptunaTrialItem[];
  best_trial_number?: number | null;
  best_value?: number | null;
  best_params?: Record<string, any> | null;
}

export interface TrainingPresetCreate {
  name: string;
  description?: string | null;
  symbol: string;
  timeframe: string;
  algorithm: string;
  config: Record<string, any>;
  is_favorite?: boolean;
}

export interface TrainingPresetOut {
  id: number;
  user_id: number;
  name: string;
  description?: string | null;
  symbol: string;
  timeframe: string;
  algorithm: string;
  config: Record<string, any>;
  is_favorite: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CloneJobConfigOut {
  job_id: string;
  symbol: string;
  timeframe: string;
  algorithm: string;
  config: Record<string, any>;
}

export interface PaperReplayRequest {
  initial_balance?: number;
  stop_loss?: number;
  take_profit?: number;
  commission?: number;
  max_bars?: number;
}

export interface EquityCurvePoint {
  bar: number;
  price: number;
  equity: number;
  drawdown_pct: number;
  signal: number;
}

export interface PaperReplayResponse {
  model_id: string;
  model_name: string;
  version_id: string;
  algorithm: string;
  source: 'live_oos_replay' | 'cached_post_backtest';
  initial_balance: number;
  final_value: number;
  profit_pct: number;
  win_rate: number;
  max_drawdown: number;
  profit_factor: number;
  sharpe_ratio: number;
  total_trades: number;
  kelly_pct: number;
  monte_carlo_var: number;
  risk_of_ruin: number;
  bars_replayed: number;
  equity_curve: EquityCurvePoint[];
}

export interface WallHunterBotItem {
  id: number;
  name: string;
  exchange: string;
  market: string;
  status: string;
  current_ai_model_id?: string | null;
  enable_ml_filter: boolean;
  ml_min_confidence: number;
}

export interface DeployToWallHunterRequest {
  bot_id: number;
  model_id: string;
  enable_ml_filter?: boolean;
  min_confidence?: number;
}

export interface DeployToWallHunterResponse {
  success: boolean;
  bot_id: number;
  bot_name: string;
  model_id: string;
  model_name: string;
  live_reloaded: boolean;
}

export interface ManualTradePinInfo {
  model_id: string;
  model_name: string;
  symbol?: string | null;
  algorithm: string;
  min_confidence: number;
  enabled: boolean;
}

export interface RetrainModelResponse {
  success: boolean;
  job_id: string;
  model_id: string;
  symbol: string;
  timeframe: string;
  algorithm: string;
}

export const trainingStudioToolsService = {
  async runPreFlightCheck(payload: PreFlightRequest): Promise<PreFlightResponse> {
    const res = await apiClient.post<PreFlightResponse>('/model-training/tools/preflight', payload);
    return res.data;
  },

  async compareModels(): Promise<ModelCompareItem[]> {
    const res = await apiClient.get<ModelCompareItem[]>('/model-training/tools/compare');
    return res.data;
  },

  async getQueueStatus(): Promise<WorkerQueueStatusOut> {
    const res = await apiClient.get<WorkerQueueStatusOut>('/model-training/tools/queue-status');
    return res.data;
  },

  async getOptunaTrials(modelId: string): Promise<OptunaTrialsOut> {
    const res = await apiClient.get<OptunaTrialsOut>(`/model-training/tools/optuna-trials/${modelId}`);
    return res.data;
  },

  async listPresets(): Promise<TrainingPresetOut[]> {
    const res = await apiClient.get<TrainingPresetOut[]>('/model-training/tools/presets');
    return res.data;
  },

  async createPreset(payload: TrainingPresetCreate): Promise<TrainingPresetOut> {
    const res = await apiClient.post<TrainingPresetOut>('/model-training/tools/presets', payload);
    return res.data;
  },

  async deletePreset(presetId: number): Promise<{ status: string; deleted_id: number }> {
    const res = await apiClient.delete<{ status: string; deleted_id: number }>(
      `/model-training/tools/presets/${presetId}`,
    );
    return res.data;
  },

  async cloneJobConfig(jobId: string): Promise<CloneJobConfigOut> {
    const res = await apiClient.get<CloneJobConfigOut>(`/model-training/tools/jobs/${jobId}/clone-config`);
    return res.data;
  },

  async runPaperReplay(modelId: string, payload: PaperReplayRequest = {}): Promise<PaperReplayResponse> {
    const res = await apiClient.post<PaperReplayResponse>(
      `/model-training/deploy/paper-replay/${modelId}`,
      payload,
    );
    return res.data;
  },

  async getWallHunterBots(): Promise<WallHunterBotItem[]> {
    const res = await apiClient.get<WallHunterBotItem[]>('/model-training/deploy/wallhunter-bots');
    return res.data;
  },

  async deployToWallHunter(payload: DeployToWallHunterRequest): Promise<DeployToWallHunterResponse> {
    const res = await apiClient.post<DeployToWallHunterResponse>('/model-training/deploy/wallhunter', payload);
    return res.data;
  },

  async getPinnedManualTradeModel(): Promise<ManualTradePinInfo | null> {
    const res = await apiClient.get<{ pinned: ManualTradePinInfo | null }>(
      '/model-training/deploy/manual-trade-pin',
    );
    return res.data?.pinned ?? null;
  },

  async pinManualTradeModel(payload: {
    model_id: string;
    min_confidence?: number;
    enabled?: boolean;
  }): Promise<{ success: boolean; pinned: ManualTradePinInfo }> {
    const res = await apiClient.post<{ success: boolean; pinned: ManualTradePinInfo }>(
      '/model-training/deploy/manual-trade-pin',
      payload,
    );
    return res.data;
  },

  async unpinManualTradeModel(): Promise<{ success: boolean }> {
    const res = await apiClient.delete<{ success: boolean }>('/model-training/deploy/manual-trade-pin');
    return res.data;
  },

  async triggerOneClickRetrain(modelId: string): Promise<RetrainModelResponse> {
    const res = await apiClient.post<RetrainModelResponse>(`/model-training/deploy/retrain/${modelId}`);
    return res.data;
  },
};

