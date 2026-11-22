import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';

interface UpdateStatusResponse {
  updating: boolean;
  message?: string;
  version?: string;
}

const VersionUpdateBanner: React.FC = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('Version update in progress...');
  const [justFinished, setJustFinished] = useState(false);
  const wasUpdatingRef = useRef(false);
  const knownVersionRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;

    const checkUpdateStatus = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`/api/v1/system/update-status?_t=${Date.now()}`, {
          cache: 'no-store',
        });

        // During the brief 3-5s backend switch, Nginx returns 502/503/504
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          if (!alive) return;
          wasUpdatingRef.current = true;
          setIsUpdating(true);
          setUpdateMsg('Version update in progress — reconnecting automatically...');
          return;
        }

        if (!res.ok) return;
        const data = (await res.json()) as UpdateStatusResponse;
        if (!alive) return;

        if (data.version && knownVersionRef.current === null) {
          knownVersionRef.current = data.version;
        }

        if (data.updating) {
          wasUpdatingRef.current = true;
          setIsUpdating(true);
          setUpdateMsg(data.message || 'Version update in progress...');
        } else {
          const versionChanged =
            Boolean(data.version) &&
            knownVersionRef.current !== null &&
            data.version !== knownVersionRef.current;

          if (wasUpdatingRef.current || versionChanged) {
            wasUpdatingRef.current = false;
            knownVersionRef.current = data.version || knownVersionRef.current;
            setIsUpdating(false);
            setJustFinished(true);
            setTimeout(() => {
              if (alive) {
                window.location.reload();
              }
            }, 2500);
          } else {
            setIsUpdating(false);
          }
        }
      } catch {
        // Ignore transient offline errors when checking update state
      }
    };

    void checkUpdateStatus();
    const timer = setInterval(() => void checkUpdateStatus(), 6000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!isUpdating && !justFinished) {
    return null;
  }

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[99995] w-[92%] max-w-xl pointer-events-auto">
      {justFinished ? (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl border border-emerald-500/40 bg-[#071510]/95 backdrop-blur-xl text-emerald-300 shadow-[0_10px_40px_rgba(16,185,129,0.25)] text-xs font-bold">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Update complete! Loading latest version...</span>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-2.5 py-1 rounded-lg bg-emerald-500 text-black font-extrabold hover:bg-emerald-400 transition-colors cursor-pointer"
          >
            Reload Now
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-2xl border border-cyan-500/40 bg-[#070F20]/95 backdrop-blur-xl text-cyan-200 shadow-[0_10px_40px_rgba(6,182,212,0.25)] text-xs font-semibold">
          <div className="flex items-center gap-2.5 min-w-0">
            <RefreshCw className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
            <span className="truncate">{updateMsg}</span>
          </div>
          <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
            Active bots stay safe
          </span>
        </div>
      )}
    </div>
  );
};

export default VersionUpdateBanner;
