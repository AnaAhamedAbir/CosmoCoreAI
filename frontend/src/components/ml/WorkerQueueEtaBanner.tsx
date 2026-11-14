import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Layers,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import {
  trainingStudioToolsService,
  WorkerQueueJobItem,
  WorkerQueueStatusOut,
} from '@/services/trainingStudioToolsService';
import { isThermalGuardActive } from '@/utils/deviceProfile';

export interface WorkerQueueEtaBannerProps {
  isTraining?: boolean;
  className?: string;
}

/**
 * Formats seconds into compact "Xm Ys" or "Ys" readout.
 */
function formatEta(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return '--';
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}m ${secs}s`;
}

function isRunningStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'running' || s === 'active' || s === 'started' || s === 'training' || s === 'in_progress';
}

export const WorkerQueueEtaBanner: React.FC<WorkerQueueEtaBannerProps> = ({
  isTraining = false,
  className = '',
}) => {
  const [queueStatus, setQueueStatus] = useState<WorkerQueueStatusOut | null>(null);
  const [hasError, setHasError] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const statusRef = useRef<WorkerQueueStatusOut | null>(null);
  statusRef.current = queueStatus;

  const fetchStatus = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const data = await trainingStudioToolsService.getQueueStatus();
      if (!signal?.cancelled) {
        setQueueStatus(data);
        setHasError(false);
      }
    } catch {
      if (!signal?.cancelled) {
        setHasError(true);
      }
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (typeof document === 'undefined' || !document.hidden) {
        await fetchStatus(signal);
      }
      if (signal.cancelled) return;

      const latest = statusRef.current;
      const hasActivity =
        isTraining || Boolean(latest && (latest.active_jobs > 0 || latest.queued_jobs > 0));
      const isThermalGuard = isThermalGuardActive();
      const delayMs = hasActivity ? (isThermalGuard ? 7000 : 5000) : (isThermalGuard ? 20000 : 10000);

      timerId = setTimeout(() => {
        void loop();
      }, delayMs);
    };

    void loop();

    return () => {
      signal.cancelled = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    };
  }, [fetchStatus, isTraining]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const workersOnline = queueStatus?.celery_workers_online ?? 0;
  const activeJobs = queueStatus?.active_jobs ?? 0;
  const queuedJobs = queueStatus?.queued_jobs ?? 0;
  const jobs: WorkerQueueJobItem[] = queueStatus?.jobs ?? [];

  const myActiveJob =
    jobs.find((j) => j.is_mine && isRunningStatus(j.status)) ??
    jobs.find((j) => j.is_mine) ??
    null;

  const displayEta =
    myActiveJob?.eta_seconds !== undefined && myActiveJob?.eta_seconds !== null
      ? formatEta(myActiveJob.eta_seconds)
      : queueStatus && queueStatus.estimated_wait_seconds > 0
        ? formatEta(queueStatus.estimated_wait_seconds)
        : '--';

  const workerOnline = workersOnline > 0;

  return (
    <div ref={containerRef} className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group flex flex-wrap items-center gap-2.5 rounded-full border border-slate-200 dark:border-slate-700/70 bg-white/90 dark:bg-slate-900/75 px-3.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 shadow-sm dark:shadow-[0_0_20px_rgba(6,182,212,0.08)] backdrop-blur-xl transition-all hover:border-cyan-500/45 hover:bg-slate-50 dark:hover:bg-slate-900/90"
        title="Click to inspect Celery worker queue & active jobs"
      >
        {/* Celery workers online indicator */}
        <span className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            {workerOnline && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                hasError && !queueStatus
                  ? 'bg-slate-500'
                  : workerOnline
                    ? 'bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]'
                    : 'bg-rose-500 dark:bg-rose-400'
              }`}
            />
          </span>
          <Cpu className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            {hasError && !queueStatus
              ? 'Workers: --'
              : `${workersOnline} ${workersOnline === 1 ? 'Worker' : 'Workers'}`}
          </span>
        </span>

        <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700/80" />

        {/* Active jobs */}
        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
          <Activity
            className={`h-3.5 w-3.5 ${
              activeJobs > 0 ? 'animate-pulse text-cyan-600 dark:text-cyan-400' : 'text-slate-400 dark:text-slate-500'
            }`}
          />
          <span className="font-mono font-semibold text-slate-900 dark:text-white">{activeJobs}</span>
          <span className="text-slate-500 dark:text-slate-400">Active</span>
        </span>

        <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700/80" />

        {/* Queued jobs */}
        <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
          <Layers className={`h-3.5 w-3.5 ${queuedJobs > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400 dark:text-slate-500'}`} />
          <span className="font-mono font-semibold text-slate-900 dark:text-white">{queuedJobs}</span>
          <span className="text-slate-500 dark:text-slate-400">Queued</span>
        </span>

        {/* User active job progress + ETA */}
        {(myActiveJob || isTraining || (queueStatus?.user_queued_jobs ?? 0) > 0) && (
          <>
            <span className="h-3.5 w-px bg-slate-200 dark:bg-slate-700/80" />
            <span className="flex items-center gap-2 rounded-full border border-cyan-500/30 bg-gradient-to-r from-cyan-500/15 via-purple-500/15 to-emerald-500/15 px-2.5 py-0.5">
              <Sparkles className="h-3 w-3 text-cyan-600 dark:text-cyan-400" />
              {myActiveJob ? (
                <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-cyan-700 dark:text-cyan-300">
                  <span>{Math.round(myActiveJob.progress)}%</span>
                  <span className="text-slate-400 dark:text-slate-500">•</span>
                  <Clock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-emerald-700 dark:text-emerald-300">ETA {displayEta}</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 font-mono text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                  <Clock className="h-3 w-3" />
                  <span>Wait ~{displayEta}</span>
                </span>
              )}
            </span>
          </>
        )}

        <span className="ml-0.5 text-slate-400 transition-colors group-hover:text-cyan-600 dark:group-hover:text-cyan-300">
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Expandable mini popover */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 dark:border-slate-700/80 bg-white/95 dark:bg-[#0B1121]/95 p-3.5 shadow-2xl dark:shadow-[0_12px_40px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
          <div className="mb-2.5 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                <Activity className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                Celery Training Queue
              </h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {workersOnline} online • {activeJobs} active • {queuedJobs} queued
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white"
              aria-label="Close queue popover"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {hasError && (
            <div className="mb-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              Unable to reach worker queue telemetry. Retrying automatically.
            </div>
          )}

          {jobs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
              No active or queued training jobs right now.
            </div>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
              {jobs.map((job) => {
                const progressClamped = Math.max(0, Math.min(100, Number(job.progress) || 0));
                return (
                  <div
                    key={job.job_id}
                    className={`rounded-xl border p-2.5 transition-colors ${
                      job.is_mine
                        ? 'border-cyan-500/35 bg-gradient-to-r from-cyan-500/10 via-purple-500/5 to-transparent'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-slate-900 dark:text-white">{job.symbol}</span>
                        <span className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:text-purple-300">
                          {job.algorithm}
                        </span>
                        {job.is_mine && (
                          <span className="inline-flex items-center gap-0.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                            <UserCheck className="h-2.5 w-2.5" />
                            You
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-300">
                        {progressClamped.toFixed(0)}%
                      </span>
                    </div>

                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400 transition-all duration-500"
                        style={{ width: `${progressClamped}%` }}
                      />
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                      <span className="uppercase tracking-wide">{job.status}</span>
                      <span>
                        Elapsed {formatEta(job.elapsed_seconds)}
                        {job.eta_seconds ? ` • ETA ${formatEta(job.eta_seconds)}` : ''}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WorkerQueueEtaBanner;
