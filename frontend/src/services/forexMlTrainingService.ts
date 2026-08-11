import apiClient from './client';

export interface ForexTrainingJob {
    id: string;
    symbol: string;
    timeframe: string;
    algorithm: string;
    market_type: string;
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED';
    progress: number;
    logs: string[];
    output_model_id?: string;
    error_message?: string;
    created_at: string;
    updated_at?: string;
    completed_at?: string;
}

export interface ForexTrainingConfig {
    symbol: string;
    timeframe: string;
    algorithm: string;
    config: {
        epochs: number;
        broker?: string;
        model_name?: string;
        prediction_target?: string;
        forecast_horizon?: number;
        lookback_window?: number;
        eval_metric?: string;
        outlier_removal?: string;
        scaling_method?: string;
        fractional_diff?: boolean;
        fractional_d_value?: number;
        apply_pca_collinearity?: boolean;
        apply_shap_selection?: boolean;
        shap_variance_threshold?: number;
        missing_data_threshold?: number;
        auto_feature_selection?: boolean;
        auto_feature_count?: number;
        augmentation_strategy?: string;
        augmentation_factor?: number;
        augmentation_samples?: number;
        use_clustered_importance?: boolean;
        enable_adversarial?: boolean;
        adversarial_epsilon?: number;
        split_method?: string;
        train_ratio?: number;
        val_ratio?: number;
        test_ratio?: number;
        imbalance_strategy?: string;
        fee_threshold?: number;
        purge_length?: number;
        market_session_features?: boolean;
        ignore_weekend_gaps?: boolean;
        macroeconomic_calendar?: boolean;
        tick_volume_profiler?: boolean;
        cot_data?: boolean;
        currency_correlation?: boolean;
        yield_differentials?: boolean;
        use_automl?: boolean;
        automl_trials?: number;
        is_ensemble?: boolean;
        base_models?: string[];
        meta_model?: string;
        target_rows?: number;
        date_range_mode?: 'ticks' | 'date';
        start_date?: string;
        end_date?: string;
        use_triple_barrier?: boolean;
        pt_sl_ratio?: number;
        barrier_timeout?: number;
        enable_meta_labeling?: boolean;
        feature_selection_method?: string;
        wfo_windows?: number;
        snapshot_file?: string;
        
        // Advanced Features
        enable_smc_features?: boolean;
        enable_ict_killzones?: boolean;
        enable_stop_hunt_models?: boolean;
        enable_tick_microstructure?: boolean;
        enable_central_bank_nlp?: boolean;
        selected_forex_features?: string[];
        custom_indicators?: any[];
        
        // Data Sources
        data_source_type?: string;
        l2_orderbook_file?: string;
        tick_data_file?: string;
        tick_binning_strategy?: string;
    };
}

export const forexMlTrainingService = {
    startTraining: async (config: ForexTrainingConfig): Promise<ForexTrainingJob> => {
        const response = await apiClient.post('/forex-model-training/train', config);
        return response.data;
    },

    getJobs: async (): Promise<ForexTrainingJob[]> => {
        const response = await apiClient.get('/forex-model-training/jobs');
        return response.data;
    },

    getJobStatus: async (jobId: string): Promise<ForexTrainingJob> => {
        const response = await apiClient.get(`/forex-model-training/jobs/${jobId}`);
        return response.data;
    },

    cancelTraining: async (jobId: string): Promise<ForexTrainingJob> => {
        const response = await apiClient.post(`/forex-model-training/jobs/${jobId}/cancel`);
        return response.data;
    },

    getInstruments: async (): Promise<{name: string, display_name: string}[]> => {
        const response = await apiClient.get('/forex-model-training/instruments');
        return response.data;
    },

    deleteDataset: async (symbol: string): Promise<{status: string, message: string}> => {
        const response = await apiClient.delete(`/forex-model-training/dataset/${symbol}`);
        return response.data;
    },

    startForexCollector: async (config: {symbol: string, target_rows: number, mode?: string, start_date?: string, end_date?: string, timeframe?: string, data_source?: string}): Promise<ForexTrainingJob> => {
        const response = await apiClient.post('/forex-model-training/start-forex-collector', config);
        return response.data;
    },

    getForexSnapshots: async (): Promise<string[]> => {
        const response = await apiClient.get('/forex-model-training/forex-snapshots');
        return response.data;
    },

    deleteForexSnapshot: async (filename: string): Promise<{status: string, message: string}> => {
        const response = await apiClient.delete(`/forex-model-training/forex-snapshots/${filename}`);
        return response.data;
    },

    uploadTickstoryCsv: async (symbol: string, file: File, onUploadProgress?: (progressEvent: any) => void): Promise<ForexTrainingJob> => {
        const formData = new FormData();
        formData.append('symbol', symbol);
        formData.append('file', file);
        
        const response = await apiClient.post('/forex-model-training/upload-tickstory', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            },
            onUploadProgress: onUploadProgress
        });
        return response.data;
    },

    getTickSnapshots: async (): Promise<string[]> => {
        const response = await apiClient.get('/forex-model-training/tick-snapshots');
        return response.data || [];
    },

    deleteTickSnapshot: async (filename: string): Promise<any> => {
        const response = await apiClient.delete(`/forex-model-training/tick-snapshots/${filename}`);
        return response.data;
    },

    async getL2OrderbookFiles(): Promise<string[]> {
        const response = await apiClient.get('/forex-model-training/l2-snapshots');
        return response.data.files || [];
    },

    async uploadL2Csv(file: File): Promise<any> {
        const formData = new FormData();
        formData.append('file', file);
        const response = await apiClient.post('/forex-model-training/upload-l2-csv', formData, {
            headers: {
                'Content-Type': 'multipart/form-data'
            }
        });
        return response.data;
    },

    async deleteL2Snapshot(filename: string): Promise<any> {
        const response = await apiClient.delete(`/forex-model-training/l2-snapshots/${filename}`);
        return response.data;
    },

    mergeHybridDataset: async (config: {symbol: string, ohlcv_file: string, tick_file: string, strategy: string}): Promise<ForexTrainingJob> => {
        const response = await apiClient.post('/forex-model-training/merge-hybrid', config);
        return response.data;
    },

    getHybridSnapshots: async (): Promise<string[]> => {
        const response = await apiClient.get('/forex-model-training/hybrid-snapshots');
        return response.data || [];
    }
};
