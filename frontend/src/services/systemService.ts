import client from './client';

export interface SystemHealth {
    status: 'healthy' | 'degraded' | 'unhealthy';
    services: {
        database: string;
        redis: string;
        celery_worker: string;
    };
    timestamp: string;
}

export interface NetworkLatencySnapshot {
    binance_spot_ms: number | null;
    binance_futures_ms: number | null;
    binance_ws_ms: number | null;
    status: 'optimal' | 'good' | 'degraded' | 'unreachable';
    cached: boolean;
}

export interface LatencyGuardConfig {
    guard_enabled: boolean;
    block_on_degraded: boolean;
    binance_warn_ms: number;
    binance_block_ms: number;
    client_warn_ms: number;
    client_block_ms: number;
}

export interface NetworkLatencyStatusResponse {
    network: NetworkLatencySnapshot;
    health: {
        severity: 'optimal' | 'good' | 'warning' | 'critical' | 'unreachable';
        should_warn: boolean;
        should_guard: boolean;
        avg_ms: number | null;
        max_ms: number | null;
        reasons: string[];
    };
    guard_config: LatencyGuardConfig;
    timestamp: string;
}

export interface VpsHardwareTelemetry {
    hostname: string;
    os: string;
    arch: string;
    uptime_seconds: number;
    cpu: {
        percent: number;
        cores_logical: number;
        cores_physical: number;
        freq_mhz: number | null;
        load_avg: number[] | null;
    };
    ram: {
        total_gb: number;
        used_gb: number;
        available_gb: number;
        percent: number;
    };
    rom: {
        mount: string;
        total_gb: number;
        used_gb: number;
        free_gb: number;
        percent: number;
    };
    temperature: {
        cpu_temp_c: number | null;
        sensor_label: string | null;
        available: boolean;
    };
    network?: NetworkLatencySnapshot;
    network_health?: NetworkLatencyStatusResponse['health'];
    guard_config?: LatencyGuardConfig;
    timestamp: string;
}

export const systemService = {
    getKillSwitchStatus: async () => {
        const response = await client.get('/system/kill-switch');
        return response.data;
    },

    toggleKillSwitch: async (active: boolean) => {
        const response = await client.post('/system/kill-switch', { active });
        return response.data;
    },

    getSystemHealth: async (): Promise<SystemHealth> => {
        const response = await client.get('/system/health');
        return response.data;
    },

    getHardwareTelemetry: async (refresh = false): Promise<VpsHardwareTelemetry> => {
        const response = await client.get('/system/hardware-telemetry', {
            params: refresh ? { refresh: true } : undefined,
        });
        return response.data;
    },

    pingServerRtt: async (): Promise<number> => {
        const t0 = performance.now();
        await client.get('/system/ping', { params: { _t: Date.now() } });
        return Math.round((performance.now() - t0) * 10) / 10;
    },

    getNetworkStatus: async (refresh = false): Promise<NetworkLatencyStatusResponse> => {
        const response = await client.get('/system/network-status', {
            params: refresh ? { refresh: true } : undefined,
        });
        return response.data;
    },

    getLatencyGuard: async (): Promise<LatencyGuardConfig> => {
        const response = await client.get('/system/latency-guard');
        return response.data;
    },

    updateLatencyGuard: async (updates: Partial<LatencyGuardConfig>): Promise<LatencyGuardConfig> => {
        const response = await client.put('/system/latency-guard', updates);
        return response.data;
    },

    getAutoArchiverStatus: async () => {
        const response = await client.get('/system/auto-archiver');
        return response.data;
    },

    toggleAutoArchiver: async (active: boolean) => {
        const response = await client.post('/system/auto-archiver', { active });
        return response.data;
    }
};
