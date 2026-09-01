import React, { useState, useEffect } from 'react';
import Button from '@/components/common/Button';
import { useToast } from '@/context/ToastContext';
import { notificationService, NotificationSettings } from '@/services/notification';
import { Bot, Link as LinkIcon, Settings as SettingsIcon } from 'lucide-react';

interface Props {
    settings: NotificationSettings;
    onChange: (settings: Partial<NotificationSettings>) => void;
    inputBaseClasses: string;
}

const TelegramConnectionPanel: React.FC<Props> = ({ settings, onChange, inputBaseClasses }) => {
    const { showToast } = useToast();
    const [mode, setMode] = useState<'quick' | 'advanced'>(
        settings.use_master_bot === false && settings.telegram_bot_token ? 'advanced' : 'quick'
    );
    const [isTesting, setIsTesting] = useState(false);
    const [connectLink, setConnectLink] = useState<string | null>(null);
    const [isLoadingLink, setIsLoadingLink] = useState(false);

    useEffect(() => {
        if (mode === 'quick' && !connectLink) {
            setIsLoadingLink(true);
            notificationService.getTelegramConnectLink()
                .then(data => setConnectLink(data.link))
                .catch(err => {
                    console.error("Failed to load connect link", err);
                    // Fallback to advanced if the server isn't configured for master bot
                    if (err.response?.status === 400) {
                        setMode('advanced');
                    }
                })
                .finally(() => setIsLoadingLink(false));
        }
    }, [mode, connectLink]);

    const handleTestNotification = async () => {
        setIsTesting(true);
        try {
            await notificationService.sendTestNotification(
                settings.telegram_bot_token || '',
                settings.telegram_chat_id || '',
                settings.use_master_bot || false
            );
            showToast('Test message sent successfully!', 'success');
        } catch (e: any) {
            showToast(`Test failed: ${e.response?.data?.detail || e.message}`, 'error');
        } finally {
            setIsTesting(false);
        }
    };

    const isConnected = settings.use_master_bot ? settings.telegram_chat_id : (settings.telegram_bot_token && settings.telegram_chat_id);

    return (
        <div className="bg-white dark:bg-[#0A0A0A]/50 border border-gray-200 dark:border-[#1A1A1A] rounded-xl overflow-hidden mb-6">
            <div className="flex border-b border-gray-200 dark:border-[#1A1A1A]">
                <button
                    onClick={() => {
                        setMode('quick');
                        onChange({ use_master_bot: true });
                    }}
                    className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                        mode === 'quick'
                            ? 'bg-brand-primary/10 text-brand-primary border-b-2 border-brand-primary'
                            : 'text-gray-500 hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                >
                    <LinkIcon className="w-4 h-4" />
                    Quick Connect (Recommended)
                </button>
                <button
                    onClick={() => {
                        setMode('advanced');
                        onChange({ use_master_bot: false });
                    }}
                    className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
                        mode === 'advanced'
                            ? 'bg-brand-primary/10 text-brand-primary border-b-2 border-brand-primary'
                            : 'text-gray-500 hover:text-slate-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-white/5'
                    }`}
                >
                    <SettingsIcon className="w-4 h-4" />
                    Custom Bot (Advanced)
                </button>
            </div>

            <div className="p-6">
                {mode === 'quick' ? (
                    <div className="flex flex-col items-center justify-center text-center space-y-4 py-4">
                        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center text-blue-500 mb-2">
                            <Bot className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Connect with Telegram</h3>
                        <p className="text-sm text-gray-500 max-w-md mx-auto">
                            Receive real-time alerts directly in your Telegram. Click the button below, then press "Start" in the Telegram app to automatically connect your account.
                        </p>
                        
                        {isConnected && settings.use_master_bot && (
                            <div className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-4 py-2 rounded-lg text-sm font-medium mb-2 border border-green-200 dark:border-green-800/30">
                                ✓ Connected to Telegram (Chat ID: {settings.telegram_chat_id})
                            </div>
                        )}

                        <div className="flex gap-3 mt-4">
                            <a
                                href={connectLink || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`inline-flex items-center justify-center px-4 py-2 bg-[#2AABEE] hover:bg-[#229ED9] text-white rounded-md font-medium transition-colors ${isLoadingLink ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={(e) => {
                                    if (isLoadingLink || !connectLink) e.preventDefault();
                                }}
                            >
                                {isLoadingLink ? 'Loading...' : 'Connect Telegram'}
                            </a>
                            
                            {isConnected && settings.use_master_bot && (
                                <Button variant="secondary" onClick={handleTestNotification} disabled={isTesting}>
                                    {isTesting ? 'Sending...' : 'Test Alert'}
                                </Button>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Bot Token</label>
                            <input
                                type="password"
                                value={settings.telegram_bot_token || ''}
                                onChange={(e) => onChange({ telegram_bot_token: e.target.value })}
                                placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
                                className={inputBaseClasses}
                            />
                            <p className="text-xs text-gray-400 mt-1">Get this from @BotFather on Telegram.</p>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Chat ID</label>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={settings.telegram_chat_id || ''}
                                    onChange={(e) => onChange({ telegram_chat_id: e.target.value })}
                                    placeholder="123456789"
                                    className={inputBaseClasses}
                                />
                                <Button 
                                    variant="secondary" 
                                    onClick={handleTestNotification} 
                                    disabled={isTesting || !settings.telegram_bot_token || !settings.telegram_chat_id}
                                >
                                    {isTesting ? 'Sending...' : 'Test'}
                                </Button>
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Send a message to your bot to find your Chat ID.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default TelegramConnectionPanel;
