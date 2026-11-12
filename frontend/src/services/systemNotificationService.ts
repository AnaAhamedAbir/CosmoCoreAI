import apiClient from '@/services/client';
import type {
  ClientEventPayload,
  ClientEventResponse,
  DailyDigestResponse,
  NotificationCategory,
  SysNotifPreferences,
  SystemNotificationListResponse,
  UnreadCounts,
} from '@/types/systemNotification';

export interface ListSystemNotificationsParams {
  category?: NotificationCategory;
  severity?: string;
  search?: string;
  unread_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface ExportSystemNotificationsParams {
  category?: NotificationCategory;
  severity?: string;
  search?: string;
}

export interface NotificationMutationResponse {
  success: boolean;
  unread_counts: UnreadCounts;
}

export const systemNotificationService = {
  async list(params?: ListSystemNotificationsParams): Promise<SystemNotificationListResponse> {
    const { data } = await apiClient.get<SystemNotificationListResponse>('/sys-notifications', {
      params,
    });
    return data;
  },

  async getUnreadCount(): Promise<UnreadCounts> {
    const { data } = await apiClient.get<UnreadCounts>('/sys-notifications/unread-count');
    return data;
  },

  async markRead(id: number): Promise<NotificationMutationResponse> {
    const { data } = await apiClient.post<NotificationMutationResponse>(`/sys-notifications/${id}/read`);
    return data;
  },

  async markAllRead(category?: NotificationCategory | null): Promise<NotificationMutationResponse> {
    const { data } = await apiClient.post<NotificationMutationResponse>('/sys-notifications/read-all', {
      category: category ?? null,
    });
    return data;
  },

  async clearAll(category?: NotificationCategory | null): Promise<NotificationMutationResponse> {
    const config = category ? { params: { category } } : undefined;
    const { data } = await apiClient.delete<NotificationMutationResponse>('/sys-notifications/clear', config);
    return data;
  },

  async dismiss(id: number): Promise<NotificationMutationResponse> {
    const { data } = await apiClient.delete<NotificationMutationResponse>(`/sys-notifications/${id}`);
    return data;
  },

  async getPreferences(): Promise<SysNotifPreferences> {
    const { data } = await apiClient.get<SysNotifPreferences>('/sys-notifications/preferences');
    return data;
  },

  async updatePreferences(prefs: SysNotifPreferences): Promise<SysNotifPreferences> {
    const { data } = await apiClient.put<SysNotifPreferences>('/sys-notifications/preferences', prefs);
    return data;
  },

  async emitClientEvent(payload: ClientEventPayload): Promise<ClientEventResponse> {
    const { data } = await apiClient.post<ClientEventResponse>('/sys-notifications/client-event', payload);
    return data;
  },

  async triggerDailyDigest(): Promise<DailyDigestResponse> {
    const { data } = await apiClient.post<DailyDigestResponse>('/sys-notifications/daily-digest');
    return data;
  },

  async downloadCsv(params?: ExportSystemNotificationsParams): Promise<void> {
    const response = await apiClient.get('/sys-notifications/export', {
      params,
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sys-notifications.csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },
};
