import React, { useState } from 'react';
import Button from '@/components/common/Button';
import { useToast } from '@/context/ToastContext';
import { useSettings } from '@/context/SettingsContext';
import { setup2fa, enable2fa, disable2fa } from '@/services/auth';
import { ShieldCheck, KeyRound, Copy, Check } from 'lucide-react';

const TwoFactorPanel: React.FC = () => {
    const { showToast } = useToast();
    const { is2faEnabled, set2faEnabled, loadUserData } = useSettings();

    const [setupData, setSetupData] = useState<{ secret: string; otpauth_uri: string } | null>(null);
    const [otpCode, setOtpCode] = useState('');
    const [disablePassword, setDisablePassword] = useState('');
    const [showDisableForm, setShowDisableForm] = useState(false);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleStartSetup = async () => {
        setBusy(true);
        try {
            const res = await setup2fa();
            setSetupData(res);
            setOtpCode('');
        } catch (err: any) {
            const msg = err?.response?.data?.message || err?.response?.data?.detail || 'Failed to initialize 2FA setup.';
            showToast(msg, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleEnable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode.trim()) return;
        setBusy(true);
        try {
            await enable2fa(otpCode.trim());
            set2faEnabled(true);
            setSetupData(null);
            setOtpCode('');
            await loadUserData();
            showToast('Two-Factor Authentication (2FA) is now active!', 'success');
        } catch (err: any) {
            const msg = err?.response?.data?.message || err?.response?.data?.detail || 'Invalid authenticator code.';
            showToast(msg, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleDisable = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode.trim() || !disablePassword) return;
        setBusy(true);
        try {
            await disable2fa(otpCode.trim(), disablePassword);
            set2faEnabled(false);
            setShowDisableForm(false);
            setOtpCode('');
            setDisablePassword('');
            await loadUserData();
            showToast('Two-Factor Authentication disabled.', 'info');
        } catch (err: any) {
            const msg = err?.response?.data?.message || err?.response?.data?.detail || 'Failed to disable 2FA.';
            showToast(msg, 'error');
        } finally {
            setBusy(false);
        }
    };

    const handleCopySecret = async () => {
        if (!setupData?.secret) return;
        try {
            await navigator.clipboard.writeText(setupData.secret);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            showToast('Copy failed. Please select and copy manually.', 'warning');
        }
    };

    return (
        <div className="p-4 bg-gray-50 dark:bg-[#0A0A0A]/30 rounded-lg border border-gray-200 dark:border-[#1A1A1A] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-start gap-3">
                    <div className={`p-2 rounded-lg ${is2faEnabled ? 'bg-emerald-500/15 text-emerald-500' : 'bg-cyan-500/10 text-cyan-500'}`}>
                        <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-medium text-slate-900 dark:text-white">Two-Factor Authentication (TOTP)</h3>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                is2faEnabled
                                    ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                                    : 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                            }`}>
                                {is2faEnabled ? 'Enabled' : 'Not Enabled'}
                            </span>
                        </div>
                        <p className="text-sm text-gray-500">
                            Protect logins and exchange API operations with Google Authenticator or Authy.
                        </p>
                    </div>
                </div>

                {!is2faEnabled && !setupData && (
                    <Button variant="primary" onClick={handleStartSetup} disabled={busy}>
                        {busy ? 'Generating...' : 'Enable 2FA'}
                    </Button>
                )}

                {is2faEnabled && !showDisableForm && (
                    <Button variant="secondary" onClick={() => { setShowDisableForm(true); setOtpCode(''); }}>
                        Disable 2FA
                    </Button>
                )}
            </div>

            {setupData && !is2faEnabled && (
                <form onSubmit={handleEnable} className="pt-4 border-t border-gray-200 dark:border-[#1A1A1A] space-y-4">
                    <div className="text-xs text-gray-600 dark:text-gray-300 space-y-2">
                        <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                            <KeyRound className="w-4 h-4 text-cyan-500" />
                            Step 1: Add this setup key to Google Authenticator / Authy
                        </p>
                        <div className="flex items-center gap-2 bg-white dark:bg-black/50 border border-gray-200 dark:border-white/10 rounded-lg px-3 py-2">
                            <code className="text-sm font-mono tracking-wider text-cyan-600 dark:text-cyan-400 break-all flex-1">
                                {setupData.secret}
                            </code>
                            <button
                                type="button"
                                onClick={handleCopySecret}
                                className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500"
                                title="Copy Secret"
                            >
                                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                                Step 2: Enter the 6-digit code from your app
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                className="w-full bg-white dark:bg-[#0A0A0A]/50 border border-brand-border-light dark:border-[#1A1A1A] rounded-md p-2 text-slate-900 dark:text-white font-mono tracking-widest"
                                required
                            />
                        </div>
                        <div className="flex gap-2">
                            <Button type="button" variant="secondary" onClick={() => setSetupData(null)}>Cancel</Button>
                            <Button type="submit" variant="primary" disabled={busy || otpCode.length !== 6}>
                                {busy ? 'Verifying...' : 'Verify & Activate'}
                            </Button>
                        </div>
                    </div>
                </form>
            )}

            {showDisableForm && is2faEnabled && (
                <form onSubmit={handleDisable} className="pt-4 border-t border-gray-200 dark:border-[#1A1A1A] space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Current Password</label>
                            <input
                                type="password"
                                value={disablePassword}
                                onChange={(e) => setDisablePassword(e.target.value)}
                                className="w-full bg-white dark:bg-[#0A0A0A]/50 border border-brand-border-light dark:border-[#1A1A1A] rounded-md p-2 text-slate-900 dark:text-white"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">6-Digit Authenticator Code</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={otpCode}
                                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                                placeholder="000000"
                                className="w-full bg-white dark:bg-[#0A0A0A]/50 border border-brand-border-light dark:border-[#1A1A1A] rounded-md p-2 text-slate-900 dark:text-white font-mono tracking-widest"
                                required
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setShowDisableForm(false)}>Cancel</Button>
                        <Button type="submit" variant="primary" disabled={busy || otpCode.length !== 6 || !disablePassword}>
                            {busy ? 'Disabling...' : 'Confirm Disable'}
                        </Button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default TwoFactorPanel;
