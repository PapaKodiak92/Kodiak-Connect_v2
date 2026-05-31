import { useEffect, useState } from 'react';
import { AndroidUpdatePanel } from '../features/updater/AndroidUpdatePanel';
import { UpdaterPanel } from '../features/updater/UpdaterPanel';
import { KodiakSplashScreen } from '../components/layout/KodiakSplashScreen';
import { WindowTitleBar } from '../components/layout/WindowTitleBar';
import { usePlatformInfo } from '../platform/usePlatformInfo';

export function AppShell() {
  const platform = usePlatformInfo();
  const [isBooting, setIsBooting] = useState(true);
  const updaterOnline = true;
  const serverOnline = false;
  const platformLabel = platform.kind === 'android' ? 'Mobile' : platform.kind === 'desktop' ? 'Desktop' : 'Web';
  const updaterPanel = platform.kind === 'android' ? <AndroidUpdatePanel /> : <UpdaterPanel />;

  useEffect(() => {
    const timeout = window.setTimeout(() => setIsBooting(false), 420);
    return () => window.clearTimeout(timeout);
  }, []);

  if (isBooting) {
    return <KodiakSplashScreen />;
  }

  return (
    <>
      <WindowTitleBar platformKind={platform.kind} />
      <main className="launcher-shell">
        <section className="launcher-card" aria-label="Kodiak Connect launcher">
          <div className="launcher-card__intro">
            <div className="brand-orb">
              <img src="/kodiak-connect-icon.png" alt="" />
            </div>
            <div>
              <p className="eyebrow eyebrow--ember">Kodiak Connect</p>
              <h1>Ready when you are.</h1>
              <p>Keep your app current while the workspace is prepared.</p>
            </div>
          </div>

          <div className="launcher-card__status">
            <div className="status-bar">
              <span>Platform: {platformLabel}</span>
              <span className="status-light status-light--online" aria-label="platform ready" />
            </div>
            <div className="status-bar">
              <span>Updater: {updaterOnline ? 'Online' : 'Offline'}</span>
              <span className={`status-light ${updaterOnline ? 'status-light--online' : 'status-light--offline'}`} aria-label={updaterOnline ? 'updater online' : 'updater offline'} />
            </div>
            <div className="status-bar">
              <span>Server: {serverOnline ? 'Online' : 'Offline'}</span>
              <span className={`status-light ${serverOnline ? 'status-light--online' : 'status-light--offline'}`} aria-label={serverOnline ? 'server online' : 'server offline'} />
            </div>
          </div>
        </section>

        {updaterPanel}

        <footer className="launcher-footer" aria-label="Kodiak Connect links">
          <a className="launcher-social-link" href="mailto:support@kodiak-connect.com?subject=Kodiak%20Connect%20Support" title="Email support" aria-label="Email support">
            <span aria-hidden="true">@</span>
          </a>
          <a className="launcher-social-link" href="https://www.facebook.com/PapaKodiak/" target="_blank" rel="noreferrer" title="Facebook" aria-label="Facebook">
            <span aria-hidden="true">f</span>
          </a>
          <a className="launcher-social-link" href="https://x.com/PapaKodiak92" target="_blank" rel="noreferrer" title="X" aria-label="X">
            <span aria-hidden="true">X</span>
          </a>
          <a className="launcher-social-link" href="https://www.instagram.com/papakodiak92/" target="_blank" rel="noreferrer" title="Instagram" aria-label="Instagram">
            <span aria-hidden="true">◎</span>
          </a>
          <a className="launcher-social-link" href="https://buymeacoffee.com/papakodiak" target="_blank" rel="noreferrer" title="Buy me a coffee" aria-label="Buy me a coffee">
            <span aria-hidden="true">☕</span>
          </a>
        </footer>
      </main>
    </>
  );
}
