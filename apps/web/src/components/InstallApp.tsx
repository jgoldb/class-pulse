import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogTrigger } from './ui';
import { installApp, useInstallState } from '../lib/pwa';

export function InstallApp() {
  const state = useInstallState();
  const [error, setError] = useState(false);
  const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(navigator.userAgent);
  if (state === 'installed') return null;

  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="ghost" size="sm"><Download /> Install app</Button></DialogTrigger>
      <DialogContent title="Install Pulsera" description="Keep Pulsera on your home screen or desktop and open it like an app.">
        <div className="space-y-4 text-sm leading-relaxed">
          {state === 'ready' ? (
            <Button onClick={() => { setError(false); void installApp().catch(() => setError(true)); }}><Download /> Install on this device</Button>
          ) : appleMobile ? (
            <p>Open Pulsera in <strong>Safari</strong>, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Keep <strong>Open as Web App</strong> on if shown, then tap <strong>Add</strong>.</p>
          ) : android ? (
            <p>Open Pulsera in <strong>Chrome</strong>, open the browser menu, then choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p>
          ) : (
            <div className="space-y-3">
              <p>In <strong>Chrome or Edge</strong>, use the install icon in the address bar or the browser menu's option to install this site as an app.</p>
              <p>On a Mac with <strong>Safari</strong>, choose <strong>File → Add to Dock</strong>.</p>
              <p className="text-muted">If your browser has no install option, open this page in Chrome, Edge, or Safari on a supported device.</p>
            </div>
          )}
          {error && <p role="alert">The install prompt couldn't open. Use your browser's install option above.</p>}
          <p className="text-muted">An internet connection is needed to load classroom records and save changes.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
