export type NotificationCategory =
  | 'manual_trade'
  | 'wallhunter'
  | 'sentiment_news'
  | 'ml_training'
  | 'market_alerts';

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface SystemNotificationMeta {
  symbol?: string;
  side?: string;
  price?: number;
  pnl?: number;
  bot_id?: number;
  bot_name?: string;
  model_id?: string | number;
  action_retrain?: boolean;
  url?: string;
  source?: string;
  impact_level?: string;
  impact_score?: number;
  sentiment?: string;
  image_url?: string;
  [key: string]: any;
}

export interface SystemNotificationItem {
  id: number;
  user_id: number | null;
  category: NotificationCategory;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  meta: SystemNotificationMeta;
  is_read: boolean;
  created_at: string;
}

export interface UnreadCounts {
  total: number;
  manual_trade: number;
  wallhunter: number;
  sentiment_news: number;
  ml_training: number;
  market_alerts: number;
}

export interface SystemNotificationListResponse {
  items: SystemNotificationItem[];
  unread_counts: UnreadCounts;
  total: number;
}

export interface SysNotifPreferences {
  soundEnabled: boolean;
  toastEnabled: boolean;
  desktopPushEnabled: boolean;
  muteLowImpactNews: boolean;
}

export interface ClientEventPayload {
  category: NotificationCategory;
  title: string;
  message: string;
  event_type?: string;
  severity?: NotificationSeverity;
  meta?: SystemNotificationMeta;
  dedup_key?: string;
}

export interface ClientEventResponse {
  success: boolean;
  notification: SystemNotificationItem;
  unread_counts: UnreadCounts;
}

export interface DailyDigestResponse {
  success: boolean;
  notification: SystemNotificationItem;
  summary: Record<string, any>;
}

export interface SystemNotificationToast {
  toastId: string;
  kind: 'single' | 'news_burst';
  notification?: SystemNotificationItem;
  burstCount?: number;
  title: string;
  message: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  createdAt: number;
}
