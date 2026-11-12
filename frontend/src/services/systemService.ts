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

    getHardwareTelemetry: async (): Promise<VpsHardwareTelemetry> => {
        const response = await client.get('/system/hardware-telemetry');
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
