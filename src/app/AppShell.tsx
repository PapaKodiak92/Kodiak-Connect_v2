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
          <a href="mailto:support@kodiak-connect.com?subject=Kodiak%20Connect%20Support">Support</a>
          <a href="https://www.facebook.com/PapaKodiak/" target="_blank" rel="noreferrer">Facebook</a>
          <a href="https://x.com/PapaKodiak92" target="_blank" rel="noreferrer">X</a>
          <a href="https://www.instagram.com/papakodiak92/" target="_blank" rel="noreferrer">Instagram</a>
          <a href="https://buymeacoffee.com/papakodiak" target="_blank" rel="noreferrer">Coffee</a>
        </footer>
      </main>
    </>
  );
}
