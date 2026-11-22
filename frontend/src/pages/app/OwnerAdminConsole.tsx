import React, { useCallback, useEffect, useState } from 'react';
import Card from '@/components/common/Card';
import Button from '@/components/common/Button';
import { useToast } from '@/context/ToastContext';
import { useSettings } from '@/context/SettingsContext';
import {
  adminService,
  type AdminAuditLogItem,
  type AdminBotItem,
  type AdminOverviewData,
  type AdminPaymentItem,
  type AdminUserItem,
  type PlatformNoCodeConfig,
} from '@/services/adminService';
import {
  ShieldAlert,
  Users,
  Bot,
  DollarSign,
  Power,
  Search,
  RefreshCw,
  FileText,
  Lock,
  Wrench,
  CreditCard,
  Settings,
  Check,
  X,
  KeyRound,
  CalendarPlus,
  Megaphone,
  Sparkles,
} from 'lucide-react';

type AdminTab = 'overview' | 'payments' | 'users' | 'nocode' | 'bots' | 'audit';

const OwnerAdminConsole: React.FC = () => {
  const { userProfile } = useSettings();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [bots, setBots] = useState<AdminBotItem[]>([]);
  const [payments, setPayments] = useState<AdminPaymentItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [platformCfg, setPlatformCfg] = useState<PlatformNoCodeConfig | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showPendingOnly, setShowPendingOnly] = useState(false);
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{ email: string; password: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!userProfile.is_superuser) return;
    setLoading(true);
    try {
      const [ov, usr, bt, logs, pmt, cfg] = await Promise.all([
        adminService.getOverview(),
        adminService.listUsers(searchQuery || undefined),
        adminService.listBots(false),
        adminService.getAuditLogs(),
        adminService.listPayments(),
        adminService.getPlatformConfig(),
      ]);
      setOverview(ov);
      setUsers(usr);
      setBots(bt);
      setAuditLogs(logs);
      setPayments(pmt);
      setPlatformCfg(cfg);
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.response?.data?.message || 'Failed to load Owner Console';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [userProfile.is_superuser, searchQuery, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!userProfile.is_superuser) {
    return (
      <div className="max-w-xl mx-auto mt-16 p-8 rounded-2xl border border-rose-500/30 bg-rose-500/5 text-center space-y-3">
        <Lock className="w-10 h-10 text-rose-500 mx-auto" />
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Owner Access Required</h2>
        <p className="text-sm text-gray-500">
          This command center is strictly restricted to the Platform Owner.
        </p>
      </div>
    );
  }

  const pendingPaymentsCount = payments.filter((p) => p.status === 'pending_approval').length;

  const handleToggleUserStatus = async (u: AdminUserItem) => {
    setBusyId(`status_${u.id}`);
    try {
      await adminService.updateUserStatus(u.id, !u.is_active, 'Owner Console toggle');
      showToast(`${u.email} ${u.is_active ? 'suspended' : 'activated'}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update user status', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handlePlanChange = async (u: AdminUserItem, tier: string) => {
    setBusyId(`plan_${u.id}`);
    try {
      await adminService.updateUserPlan(u.id, tier, 'monthly', 'Owner manual override');
      showToast(`Updated ${u.email} to ${tier.toUpperCase()}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to update plan', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleExtend30Days = async (u: AdminUserItem) => {
    setBusyId(`ext_${u.id}`);
    try {
      await adminService.extendUserSubscription(u.id, 30, 'pro');
      showToast(`Added +30 days Pro access to ${u.email}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to extend subscription', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleReset2FA = async (u: AdminUserItem) => {
    setBusyId(`2fa_${u.id}`);
    try {
      await adminService.resetUser2fa(u.id);
      showToast(`2FA disabled for ${u.email}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to reset 2FA', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleResetPassword = async (u: AdminUserItem) => {
    setBusyId(`pwd_${u.id}`);
    try {
      const res = await adminService.resetUserPassword(u.id);
      setTempPasswordBanner({ email: res.email, password: res.temporary_password });
      showToast(`Temporary password generated for ${u.email}`, 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to reset password', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleApprovePayment = async (tx: AdminPaymentItem) => {
    setBusyId(`approve_${tx.id}`);
    try {
      await adminService.approvePayment(tx.id, 'Verified via Owner Console');
      showToast(`Approved ${tx.user_email} (${tx.provider.toUpperCase()})! Pro activated.`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to approve payment', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectPayment = async (tx: AdminPaymentItem) => {
    setBusyId(`reject_${tx.id}`);
    try {
      await adminService.rejectPayment(tx.id, 'TrxID could not be verified');
      showToast(`Rejected payment #${tx.id}`, 'warning');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to reject payment', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleSavePlatformConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platformCfg) return;
    setBusyId('save_cfg');
    try {
      const saved = await adminService.savePlatformConfig(platformCfg);
      setPlatformCfg(saved);
      window.dispatchEvent(new CustomEvent('app:public-config-refresh'));
      showToast('No-Code Platform Settings & Announcement saved!', 'success');
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to save platform settings', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleRunAutopilotSweep = async () => {
    setBusyId('autopilot_sweep');
    try {
      const res = await adminService.runAutopilotSweep();
      showToast(
        `Autopilot Sweep Complete: ${res.expired_subscriptions_downgraded} expired plans downgraded, ${res.excess_bots_stopped} excess bots stopped.`,
        'success'
      );
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to run autopilot sweep', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleForceStopBot = async (botId: number) => {
    setBusyId(`bot_${botId}`);
    try {
      await adminService.forceStopBot(botId);
      showToast(`Bot #${botId} stopped remotely`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to stop bot', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleKillSwitch = async () => {
    if (!overview) return;
    const next = !overview.infrastructure.global_kill_switch;
    setBusyId('kill_switch');
    try {
      await adminService.toggleGlobalKillSwitch(next);
      showToast(`Global Kill Switch ${next ? 'ACTIVATED' : 'Deactivated'}`, next ? 'warning' : 'success');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to toggle kill switch', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleMaintenance = async () => {
    if (!overview) return;
    const next = !overview.infrastructure.maintenance_mode;
    setBusyId('maintenance');
    try {
      await adminService.toggleMaintenance(next, next ? 'Scheduled maintenance in progress' : '');
      showToast(`Maintenance Mode ${next ? 'ENABLED' : 'Disabled'}`, 'info');
      await loadData();
    } catch (err: any) {
      showToast(err?.response?.data?.detail || 'Failed to toggle maintenance mode', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-violet-500/15 text-violet-400 border border-violet-500/30 mb-2">
            Sole Owner Zero-Code Command Center
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Platform Administration</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            1-Click bKash/Nagad/Binance Pay approvals, user support, global notices, and automated 10K-user management.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={handleRunAutopilotSweep}
            disabled={busyId === 'autopilot_sweep'}
          >
            <span className="flex items-center gap-1.5 text-xs">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              {busyId === 'autopilot_sweep' ? 'Running Sweep...' : 'Run Auto-Expiry Sweep'}
            </span>
          </Button>
          <Button variant="secondary" onClick={loadData} disabled={loading}>
            <span className="flex items-center gap-2 text-xs">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </span>
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-white/10 pb-3">
        {[
          { id: 'overview' as const, label: 'Overview & Switches', icon: <ShieldAlert className="w-4 h-4" /> },
          {
            id: 'payments' as const,
            label: `Payments (${pendingPaymentsCount} Pending)`,
            icon: <CreditCard className="w-4 h-4" />,
            badge: pendingPaymentsCount > 0 ? pendingPaymentsCount : undefined,
          },
          { id: 'users' as const, label: `Users & Support (${users.length})`, icon: <Users className="w-4 h-4" /> },
          { id: 'nocode' as const, label: 'No-Code Settings & Notice', icon: <Settings className="w-4 h-4" /> },
          { id: 'bots' as const, label: `Bot Fleet (${bots.length})`, icon: <Bot className="w-4 h-4" /> },
          { id: 'audit' as const, label: 'Audit Logs', icon: <FileText className="w-4 h-4" /> },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              activeTab === t.id
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-white dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'
            }`}
          >
            {t.icon}
            {t.label}
            {t.badge && (
              <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-amber-500 text-black">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
          {pendingPaymentsCount > 0 && (
            <div className="p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-sm text-amber-300 font-semibold">
                🔔 আপনার কাছে <strong>{pendingPaymentsCount}টি</strong> নতুন bKash/Nagad/Binance Pay পেমেন্ট রিকোয়েস্ট Approve করার অপেক্ষায় আছে!
              </div>
              <Button variant="primary" onClick={() => setActiveTab('payments')}>
                Review Pending Payments
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Total Users</span>
                <Users className="w-4 h-4 text-cyan-500" />
              </div>
              <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2">{overview.users.total}</p>
              <p className="text-xs text-gray-500 mt-1">
                {overview.users.pro} Pro • {overview.users.free} Free • {overview.users.suspended} Suspended
              </p>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Active Bots</span>
                <Bot className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2">{overview.bots.total_active}</p>
              <p className="text-xs text-gray-500 mt-1">
                Std: {overview.bots.standard} • Grid: {overview.bots.grid} • Arb: {overview.bots.arbitrage} • FX: {overview.bots.forex}
              </p>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Estimated MRR</span>
                <DollarSign className="w-4 h-4 text-violet-500" />
              </div>
              <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
                ${overview.revenue.estimated_mrr_usd.toLocaleString()}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                Collected: ${overview.revenue.total_collected_usd.toLocaleString()} • Pending: {pendingPaymentsCount}
              </p>
            </Card>
            <Card>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-500 uppercase">Exchange Keys</span>
                <ShieldAlert className="w-4 h-4 text-amber-500" />
              </div>
              <p className="text-3xl font-extrabold text-slate-900 dark:text-white mt-2">
                {overview.infrastructure.connected_exchanges}
              </p>
              <p className="text-xs text-gray-500 mt-1">AES-encrypted multi-tenant vault</p>
            </Card>
          </div>

          <Card>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Platform Emergency Switches</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-rose-500/20 bg-rose-500/5">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Power className="w-4 h-4 text-rose-500" /> Global Admin Kill Switch
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Immediately halts bot trading execution platform-wide.
                  </p>
                </div>
                <Button
                  variant={overview.infrastructure.global_kill_switch ? 'primary' : 'secondary'}
                  onClick={handleToggleKillSwitch}
                  disabled={busyId === 'kill_switch'}
                >
                  {overview.infrastructure.global_kill_switch ? 'ACTIVE (Turn Off)' : 'Activate Kill Switch'}
                </Button>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-amber-500" /> Maintenance Mode
                  </h3>
                  <p className="text-xs text-gray-500 mt-1">
                    Pauses regular user traffic with a maintenance screen while Owner access stays open.
                  </p>
                </div>
                <Button
                  variant={overview.infrastructure.maintenance_mode ? 'primary' : 'secondary'}
                  onClick={handleToggleMaintenance}
                  disabled={busyId === 'maintenance'}
                >
                  {overview.infrastructure.maintenance_mode ? 'ENABLED (Disable)' : 'Enable Maintenance'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Payments Approval Tab */}
      {activeTab === 'payments' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                bKash / Nagad / Rocket / Binance Pay & Gateway Requests
              </h2>
              <p className="text-xs text-gray-500">
                ইউজারের পাঠানো TrxID ও নাম্বার মিলিয়ে <strong>Approve (+30d Pro)</strong> বাটনে ক্লিক করলেই অটোমেটিক তার Pro প্ল্যান চালু হয়ে যাবে।
              </p>
            </div>
            <div className="inline-flex rounded-xl p-1 bg-gray-100 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setShowPendingOnly(false)}
                className={`px-3 py-1.5 rounded-lg ${!showPendingOnly ? 'bg-cyan-500 text-white' : 'text-gray-500'}`}
              >
                All ({payments.length})
              </button>
              <button
                type="button"
                onClick={() => setShowPendingOnly(true)}
                className={`px-3 py-1.5 rounded-lg ${showPendingOnly ? 'bg-amber-500 text-black font-bold' : 'text-gray-500'}`}
              >
                Pending Only ({pendingPaymentsCount})
              </button>
            </div>
          </div>

          {(showPendingOnly ? payments.filter((p) => p.status === 'pending_approval') : payments).length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No matching payment transactions found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-gray-500 border-b border-gray-200 dark:border-white/10">
                  <tr>
                    <th className="py-3 px-3">Customer</th>
                    <th className="py-3 px-3">Method</th>
                    <th className="py-3 px-3">Sender & TrxID</th>
                    <th className="py-3 px-3">Amount / Cycle</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">1-Click Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                  {(showPendingOnly ? payments.filter((p) => p.status === 'pending_approval') : payments).map((tx) => (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                      <td className="py-3 px-3">
                        <div className="font-semibold text-slate-900 dark:text-white">{tx.user_name}</div>
                        <div className="text-xs text-gray-500">{tx.user_email}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs font-bold uppercase px-2.5 py-1 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          {tx.provider}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono text-xs">
                        <div className="font-bold text-slate-900 dark:text-white select-all">TrxID: {tx.trx_id}</div>
                        {tx.sender_account && (
                          <div className="text-gray-500 select-all">From: {tx.sender_account}</div>
                        )}
                      </td>
                      <td className="py-3 px-3 text-xs font-mono">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {tx.amount_bdt ? `৳${tx.amount_bdt.toLocaleString()} ` : ''}(${tx.amount_usd})
                        </div>
                        <div className="text-gray-500">{tx.plan_tier.toUpperCase()} • {tx.billing_cycle}</div>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full uppercase ${
                          tx.status === 'paid'
                            ? 'bg-emerald-500/15 text-emerald-500'
                            : tx.status === 'pending_approval'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-rose-500/15 text-rose-500'
                        }`}>
                          {tx.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        {tx.status === 'pending_approval' && (
                          <div className="inline-flex items-center gap-2">
                            <Button
                              variant="primary"
                              disabled={busyId === `approve_${tx.id}`}
                              onClick={() => handleApprovePayment(tx)}
                            >
                              <span className="flex items-center gap-1 text-xs">
                                <Check className="w-3.5 h-3.5" />
                                Approve (+30d)
                              </span>
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={busyId === `reject_${tx.id}`}
                              onClick={() => handleRejectPayment(tx)}
                            >
                              <span className="flex items-center gap-1 text-xs text-rose-400">
                                <X className="w-3.5 h-3.5" />
                                Reject
                              </span>
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Users & 1-Click Support Tab */}
      {activeTab === 'users' && (
        <Card>
          {tempPasswordBanner && (
            <div className="mb-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-emerald-300 space-y-1">
                <div>
                  ✅ <strong>{tempPasswordBanner.email}</strong>-এর নতুন টেম্পোরারি পাসওয়ার্ড তৈরি হয়েছে (কপি করে ইউজারকে দিন):
                </div>
                <div className="font-mono text-base font-bold text-white bg-black/40 px-3 py-1.5 rounded-lg inline-block select-all">
                  {tempPasswordBanner.password}
                </div>
              </div>
              <Button variant="secondary" onClick={() => setTempPasswordBanner(null)}>
                Dismiss
              </Button>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Registered Accounts & 1-Click Support</h2>
              <p className="text-xs text-gray-500">
                ইউজারের পাসওয়ার্ড রিসেট, 2FA রিসেট, +৩০ দিন মেয়াদ বাড়ানো বা প্ল্যান পরিবর্তন—সব ১ ক্লিকে এখান থেকেই করুন।
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search email or name..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-500 border-b border-gray-200 dark:border-white/10">
                <tr>
                  <th className="py-3 px-3">User</th>
                  <th className="py-3 px-3">Plan & Expiry</th>
                  <th className="py-3 px-3">Security</th>
                  <th className="py-3 px-3">Bots / Keys</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">1-Click Support Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                        {u.full_name || 'Trader'}
                        {u.is_superuser && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-400">
                            OWNER
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-3">
                      {u.is_superuser ? (
                        <span className="text-xs font-mono font-bold text-violet-400">ENTERPRISE (OWNER)</span>
                      ) : (
                        <div className="space-y-1">
                          <select
                            value={u.plan_tier}
                            disabled={busyId === `plan_${u.id}`}
                            onChange={(e) => handlePlanChange(u, e.target.value)}
                            className="text-xs font-semibold rounded-lg px-2 py-1 bg-gray-100 dark:bg-black/50 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                          >
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                          {u.subscription_expires_at && (
                            <div className="text-[10px] text-gray-500">
                              Exp: {new Date(u.subscription_expires_at).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-500">
                      {u.is_2fa_enabled ? '2FA On' : '2FA Off'} • {u.is_email_verified ? 'Verified' : 'Unverified'}
                    </td>
                    <td className="py-3 px-3 text-xs font-mono text-gray-500">
                      {u.active_bot_count}/{u.bot_count} bots • {u.api_key_count} keys
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        u.is_active ? 'bg-emerald-500/15 text-emerald-500' : 'bg-rose-500/15 text-rose-500'
                      }`}>
                        {u.is_active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {!u.is_superuser && (
                        <div className="inline-flex flex-wrap justify-end gap-1.5">
                          <Button
                            variant="secondary"
                            disabled={busyId === `ext_${u.id}`}
                            onClick={() => handleExtend30Days(u)}
                          >
                            <span className="flex items-center gap-1 text-xs" title="Add 30 Days Pro">
                              <CalendarPlus className="w-3.5 h-3.5 text-cyan-400" />
                              +30d Pro
                            </span>
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busyId === `pwd_${u.id}`}
                            onClick={() => handleResetPassword(u)}
                          >
                            <span className="flex items-center gap-1 text-xs" title="Generate temporary password">
                              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                              Reset Pass
                            </span>
                          </Button>
                          {u.is_2fa_enabled && (
                            <Button
                              variant="secondary"
                              disabled={busyId === `2fa_${u.id}`}
                              onClick={() => handleReset2FA(u)}
                            >
                              <span className="text-xs text-violet-400">Reset 2FA</span>
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            disabled={busyId === `status_${u.id}`}
                            onClick={() => handleToggleUserStatus(u)}
                          >
                            <span className="text-xs">{u.is_active ? 'Suspend' : 'Activate'}</span>
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* No-Code Settings & Global Announcement Tab */}
      {activeTab === 'nocode' && platformCfg && (
        <Card>
          <form onSubmit={handleSavePlatformConfig} className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-cyan-500" />
                1. Global Dashboard Announcement Banner (সব ইউজারের স্ক্রিনে নোটিশ)
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                এখানে যেকোনো নোটিশ লিখে চালু করলে আপনার ১০,০০০ ইউজারের ড্যাশবোর্ডের একদম উপরে সাথে সাথে সেই বার্তা দেখাবে।
              </p>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={platformCfg.announcement_active}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, announcement_active: e.target.checked })}
                    className="w-4 h-4 rounded text-cyan-500"
                  />
                  <span className="text-sm font-bold text-slate-900 dark:text-white">Show Banner Live</span>
                </label>

                <select
                  value={platformCfg.announcement_type}
                  onChange={(e) => setPlatformCfg({ ...platformCfg, announcement_type: e.target.value as any })}
                  className="px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                >
                  <option value="info">Info (Cyan Banner)</option>
                  <option value="warning">Warning (Amber Banner)</option>
                  <option value="success">Success (Emerald Banner)</option>
                </select>

                <input
                  type="text"
                  value={platformCfg.announcement_message}
                  onChange={(e) => setPlatformCfg({ ...platformCfg, announcement_message: e.target.value })}
                  placeholder="যেমন: আজ রাত ২টায় সার্ভার আপডেট চলবে / ঈদ অফারে Pro প্ল্যান ২০% ছাড়!"
                  className="md:col-span-2 px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="border-t border-gray-200 dark:border-white/10 pt-6">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                2. Bangladesh Payment Numbers & Pricing (কোডে হাত না দিয়েই পরিবর্তন করুন)
              </h2>
              <p className="text-xs text-gray-500 mt-1">
                এখানে যে নাম্বার ও টাকার পরিমাণ দেবেন, ইউজারদের Billing পেজে ঠিক সেটিই দেখাবে।
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">bKash Number & Instruction</label>
                  <input
                    type="text"
                    value={platformCfg.bkash_number}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, bkash_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Nagad Number & Instruction</label>
                  <input
                    type="text"
                    value={platformCfg.nagad_number}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, nagad_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Rocket Number (Optional)</label>
                  <input
                    type="text"
                    value={platformCfg.rocket_number}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, rocket_number: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Binance Pay ID / USDT TRC20 Address</label>
                  <input
                    type="text"
                    value={platformCfg.binance_pay_id}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, binance_pay_id: e.target.value })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Pro Monthly Price (BDT ৳)</label>
                  <input
                    type="number"
                    value={platformCfg.pro_monthly_bdt}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, pro_monthly_bdt: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Pro Monthly Price (USD $)</label>
                  <input
                    type="number"
                    value={platformCfg.pro_monthly_usd}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, pro_monthly_usd: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Pro Yearly Price (BDT ৳)</label>
                  <input
                    type="number"
                    value={platformCfg.pro_yearly_bdt}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, pro_yearly_bdt: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase text-gray-500 mb-1">Customer Support Telegram / WhatsApp Link</label>
                  <input
                    type="text"
                    value={platformCfg.support_url}
                    onChange={(e) => setPlatformCfg({ ...platformCfg, support_url: e.target.value })}
                    placeholder="https://t.me/YourSupportUsername"
                    className="w-full px-3 py-2 text-sm rounded-xl bg-gray-50 dark:bg-black/40 border border-gray-200 dark:border-white/10 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" disabled={busyId === 'save_cfg'}>
                {busyId === 'save_cfg' ? 'Saving...' : 'Save All No-Code Settings'}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Bot Fleet Tab */}
      {activeTab === 'bots' && (
        <Card>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Platform Bot Fleet</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-gray-500 border-b border-gray-200 dark:border-white/10">
                <tr>
                  <th className="py-3 px-3">Bot</th>
                  <th className="py-3 px-3">Owner</th>
                  <th className="py-3 px-3">Market / Strategy</th>
                  <th className="py-3 px-3">PnL</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/5">
                {bots.map((b) => (
                  <tr key={b.id}>
                    <td className="py-3 px-3 font-medium text-slate-900 dark:text-white">
                      #{b.id} {b.name}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-500">{b.owner_email}</td>
                    <td className="py-3 px-3 text-xs text-gray-500">
                      {b.exchange} • {b.market} ({b.strategy})
                    </td>
                    <td className={`py-3 px-3 font-mono text-xs font-bold ${b.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                      ${b.pnl.toFixed(2)}
                    </td>
                    <td className="py-3 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        b.status === 'active' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-gray-500/15 text-gray-400'
                      }`}>
                        {b.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {b.status === 'active' && (
                        <Button
                          variant="secondary"
                          disabled={busyId === `bot_${b.id}`}
                          onClick={() => handleForceStopBot(b.id)}
                        >
                          Force Stop
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Audit Logs Tab */}
      {activeTab === 'audit' && (
        <Card>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Immutable Owner Audit Log</h2>
          <div className="space-y-2 max-h-[520px] overflow-y-auto">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-gray-500">No owner actions logged yet.</p>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-lg bg-gray-50 dark:bg-black/30 border border-gray-200 dark:border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-cyan-500 mr-2">{log.action}</span>
                    <span className="text-slate-700 dark:text-gray-300">
                      {log.target_type} #{log.target_id}
                    </span>
                    <span className="text-gray-500 ml-2">{JSON.stringify(log.details)}</span>
                  </div>
                  <div className="font-mono text-gray-400">
                    IP: {log.ip_address || 'n/a'} • {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
};

export default OwnerAdminConsole;
