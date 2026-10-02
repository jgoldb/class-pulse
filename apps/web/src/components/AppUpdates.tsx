import { RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { checkForUpdates, reloadForUpdate, useUpdateState } from '../lib/pwa';

export function AppUpdates({ noticeOnly = false }: { noticeOnly?: boolean }) {
  const update = useUpdateState();
  if (update.status === 'disabled') return null;
  if (noticeOnly && update.status !== 'available') return null;
  return (
    <div className={noticeOnly ? 'no-print mb-4 space-y-1 rounded-lg border border-border bg-elevated p-3 lg:hidden' : 'space-y-1'}>
      {update.status === 'available' ? (
        <>
          <Button size="sm" className="h-auto min-h-9 max-w-full whitespace-normal py-2 text-left" onClick={reloadForUpdate}><RefreshCw /> Update available — Reload</Button>
          <p className="px-3 text-xs text-muted" role="status">Save your changes before reloading.</p>
        </>
      ) : (
        <>
          <Button variant="ghost" size="sm" disabled={update.status === 'checking'} onClick={() => void checkForUpdates()}>
            <RefreshCw /> {update.status === 'checking' ? 'Checking for updates…' : 'Check for updates'}
          </Button>
          {update.status === 'current' && <p className="px-3 text-xs text-muted" role="status">You're up to date.</p>}
          {update.status === 'error' && <p className="px-3 text-xs text-muted" role="status">Couldn't check. Check your connection and try again.</p>}
        </>
      )}
    </div>
  );
}
