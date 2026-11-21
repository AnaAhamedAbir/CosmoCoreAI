import apiClient from './client';

export interface AdminOverviewData {
  users: {
    total: number;
    active: number;
    suspended: number;
    pro: number;
    free: number;
  };
  bots: {
    total_active: number;
    standard: number;
    grid: number;
    lead_lag: number;
    arbitrage: number;
    forex: number;
  };
  infrastructure: {
    connected_exchanges: number;
    global_kill_switch: boolean;
    maintenance_mode: boolean;
    auto_archiver: boolean;
  };
  revenue: {
    total_collected_usd: number;
    estimated_mrr_usd: number;
  };
}

export interface AdminUserItem {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
  is_pro: boolean;
  is_superuser: boolean;
  is_email_verified: boolean;
  is_2fa_enabled: boolean;
  plan_tier: string;
  subscription_status: string;
  subscription_provider: string;
  bot_count: number;
  active_bot_count: number;
  api_key_count: number;
  created_at: string | null;
}

export interface AdminBotItem {
  id: number;
  name: string;
  owner_id: number;
  owner_email: string;
  exchange: string;
  market: string;
  strategy: string;
  status: string;
  is_paper_trading: boolean;
  pnl: number;
}

export interface AdminAuditLogItem {
  id: number;
  admin_id: number | null;
  action: string;
  target_type: string;
  target_id: string | null;
  ip_address: string | null;
  details: Record<string, any>;
  created_at: string | null;
}

export const adminService = {
  getOverview: async (): Promise<AdminOverviewData> => {
    const res = await apiClient.get('/admin/overview');
    return res.data;
  },
  listUsers: async (search?: string): Promise<AdminUserItem[]> => {
    const res = await apiClient.get('/admin/users', { params: search ? { search } : {} });
    return res.data;
  },
  updateUserStatus: async (userId: number, is_active: boolean, reason?: string) => {
    const res = await apiClient.patch(`/admin/users/${userId}/status`, { is_active, reason });
    return res.data;
  },
  updateUserPlan: async (userId: number, plan_tier: string, billing_cycle = 'monthly', reason?: string) => {
    const res = await apiClient.patch(`/admin/users/${userId}/plan`, { plan_tier, billing_cycle, reason });
    return res.data;
  },
  listBots: async (activeOnly = false): Promise<AdminBotItem[]> => {
    const res = await apiClient.get('/admin/bots', { params: { active_only: activeOnly } });
    return res.data;
  },
  forceStopBot: async (botId: number) => {
    const res = await apiClient.post(`/admin/bots/${botId}/force-stop`);
    return res.data;
  },
  toggleMaintenance: async (active: boolean, message?: string) => {
    const res = await apiClient.post('/admin/maintenance', { active, message });
    return res.data;
  },
  toggleGlobalKillSwitch: async (active: boolean) => {
    const res = await apiClient.post('/system/kill-switch', { active });
    return res.data;
  },
  getAuditLogs: async (): Promise<AdminAuditLogItem[]> => {
    const res = await apiClient.get('/admin/audit-logs');
    return res.data;
  },
};

export const billingService = {
  getSubscription: async () => {
    const res = await apiClient.get('/billing/subscription');
    return res.data;
  },
  createCheckout: async (provider: 'stripe' | 'nowpayments', plan_tier = 'pro', billing_cycle: 'monthly' | 'yearly' = 'monthly') => {
    const res = await apiClient.post('/billing/checkout', { provider, plan_tier, billing_cycle });
    return res.data;
  },
};
