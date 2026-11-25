import { useState, useCallback, useEffect } from 'react';
import { backtestService, BacktestRequest, OptimizationRequest, WalkForwardRequest } from '@/services/backtester';
import { useToast } from '@/context/ToastContext';
import { useBacktestSocket } from '@/hooks/useBacktestSocket';

export const useBacktestExecution = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [results, setResults] = useState<any>(null);
    const [mode, setMode] = useState<'backtest' | 'optimization' | 'walk_forward' | 'batch'>('backtest');

    const { showToast } = useToast();
    const { lastMessage } = useBacktestSocket();
    const [taskId, setTaskId] = useState<string | null>(null);

    useEffect(() => {
        if (lastMessage && lastMessage.task_id === taskId) {
            if (lastMessage.progress !== undefined) {
                setProgress(lastMessage.progress);
            }

            const metaData = lastMessage.payload || lastMessage.data;
            if (metaData && metaData.status && metaData.status !== 'error' && metaData.status !== 'success') {
                setStatusMessage(metaData.status);
            } else if (mode === 'optimization' && metaData?.current) {
                setStatusMessage(`Processing Iteration ${metaData.current} / ${metaData.total}`);
            }

            const status = (lastMessage.status as string).toUpperCase();

            if (status === 'COMPLETED' || status === 'SUCCESS') {
                setIsLoading(false);
                const payload = lastMessage.payload || lastMessage.data;
                if (payload && !Array.isArray(payload) && (payload.status === 'error' || payload.error)) {
                    const errText = payload.message || payload.error || 'Backtest execution returned an error.';
                    setErrorMessage(errText);
                    setResults(null);
                    setProgress(0);
                    showToast(errText, 'error');
                    return;
                }
                setErrorMessage(null);
                setResults(payload);
                setProgress(100);
                showToast('Analysis Completed Successfully!', 'success');
            } else if (status === 'FAILED' || status === 'FAILURE') {
                setIsLoading(false);
                const payload = lastMessage.payload || lastMessage.data;
                const errText = payload?.error || payload?.message || 'Analysis Failed';
                setErrorMessage(errText);
                showToast(errText, 'error');
            } else if (status === 'REVOKED' || status === 'Revoked') {
                setIsLoading(false);
                setProgress(0);
                setResults(null);
                setErrorMessage(null);
                showToast('Analysis Stopped by User', 'info');
            }
        }
    }, [lastMessage, taskId, mode, showToast]);

    const execute = useCallback(async (
        payload: any,
        currentMode: 'backtest' | 'optimization' | 'walk_forward' | 'batch'
    ) => {
        setIsLoading(true);
        setResults(null);
        setErrorMessage(null);
        setProgress(0);
        setStatusMessage('Initializing...');
        setMode(currentMode);
        setTaskId(null);

        try {
            let response;
            if (currentMode === 'optimization') {
                response = await backtestService.runOptimization(payload as OptimizationRequest);
            } else if (currentMode === 'walk_forward') {
                response = await backtestService.runWalkForward(payload as WalkForwardRequest);
            } else if (currentMode === 'batch') {
                response = await backtestService.runBatchBacktest(payload);
            } else {
                response = await backtestService.runBacktest(payload as BacktestRequest);
            }

            if (response.task_id) {
                setTaskId(response.task_id);
            } else {
                setIsLoading(false);
                setErrorMessage('Failed to start task');
                showToast('Failed to start task', 'error');
            }
        } catch (error: any) {
            setIsLoading(false);
            const detail = error?.response?.data?.detail || 'Execution Error';
            setErrorMessage(detail);
            showToast(detail, 'error');
            console.error(error);
        }
    }, [showToast]);

    return {
        execute,
        isLoading,
        progress,
        statusMessage,
        errorMessage,
        results,
        mode,
        taskId,
    };
};
