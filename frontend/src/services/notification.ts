import apiClient from './client';

export interface NotificationSettings {
    user_id: number;
    telegram_bot_token?: string;
    telegram_chat_id?: string;
    is_enabled: boolean;
    use_master_bot?: boolean;
    // Per-session toggles
    notify_sydney: boolean;
    notify_tokyo: boolean;
    notify_london: boolean;
    notify_new_york: boolean;
    // Alert type toggles
    alert_session_start: boolean;
    alert_price_data: boolean;
    alert_overlap: boolean;
    alert_weekly_summary: boolean;
    alert_server_errors: boolean;
    broadcast_live_logs: boolean;
    alert_market_news: boolean;
    alert_active_config_dump: boolean;
    updated_at?: string;
}

export const notificationService = {
    getSettings: async (): Promise<NotificationSettings> => {
        const response = await apiClient.get<NotificationSettings>('/notifications/settings');
        return response.data;
    },

    updateSettings: async (settings: Partial<NotificationSettings>): Promise<NotificationSettings> => {
        const response = await apiClient.post<NotificationSettings>('/notifications/settings', settings);
        return response.data;
    },

    sendTestNotification: async (token: string, chatId: string, use_master_bot: boolean = false): Promise<{ status: string, message: string }> => {
        const response = await apiClient.post<{ status: string, message: string }>('/notifications/test', {
            telegram_bot_token: token,
            telegram_chat_id: chatId,
            is_enabled: true,
            use_master_bot: use_master_bot
        });
        return response.data;
    },

    getTelegramConnectLink: async (): Promise<{ link: string }> => {
        const response = await apiClient.get<{ link: string }>('/notifications/connect-link');
        return response.data;
    }
};
