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
  type AdminUserItem,
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
} from 'lucide-react';

type AdminTab = 'overview' | 'users' | 'bots' | 'audit';

const OwnerAdminConsole: React.FC = () => {
  const { userProfile } = useSettings();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [overview, setOverview] = useState<AdminOverviewData | null>(null);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [bots, setBots] = useState<AdminBotItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!userProfile.is_superuser) return;
    setLoading(true);
    try {
      const [ov, usr, bt, logs] = await Promise.all([
        adminService.getOverview(),
        adminService.listUsers(searchQuery || undefined),
        adminService.listBots(false),
        adminService.getAuditLogs(),
      ]);
      setOverview(ov);
      setUsers(usr);
      setBots(bt);
      setAuditLogs(logs);
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
            Sole Owner Control Center
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">Platform Administration</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Manage SaaS customers, tier overrides, live bots, emergency switches, and audit history.
          </p>
        </div>
        <Button variant="secondary" onClick={loadData} disabled={loading}>
          <span className="flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Telemetry
          </span>
        </Button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-white/10 pb-3">
        {[
          { id: 'overview' as const, label: 'Overview & Switches', icon: <ShieldAlert className="w-4 h-4" /> },
          { id: 'users' as const, label: `Users & Plans (${users.length})`, icon: <Users className="w-4 h-4" /> },
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
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && overview && (
        <div className="space-y-6">
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
                Collected: ${overview.revenue.total_collected_usd.toLocaleString()}
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
                    Flags platform maintenance window before rolling updates.
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

      {/* Users Tab */}
      {activeTab === 'users' && (
        <Card>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Registered Accounts</h2>
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
                  <th className="py-3 px-3">Plan Tier</th>
                  <th className="py-3 px-3">Security</th>
                  <th className="py-3 px-3">Bots / Keys</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Owner Actions</th>
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
                        <Button
                          variant="secondary"
                          disabled={busyId === `status_${u.id}`}
                          onClick={() => handleToggleUserStatus(u)}
                        >
                          {u.is_active ? 'Suspend' : 'Activate'}
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
