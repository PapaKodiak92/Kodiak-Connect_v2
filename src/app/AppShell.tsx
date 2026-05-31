import { useEffect, useState } from 'react';
import { AndroidUpdatePanel } from '../features/updater/AndroidUpdatePanel';
import { UpdaterPanel } from '../features/updater/UpdaterPanel';
import { AppFrame } from '../components/layout/AppFrame';
import { KodiakSplashScreen } from '../components/layout/KodiakSplashScreen';
import { WindowTitleBar } from '../components/layout/WindowTitleBar';
import { useAuthController } from '../features/auth/useAuthController';
import { usePlatformInfo } from '../platform/usePlatformInfo';

export function AppShell() {
  const platform = usePlatformInfo();
  const auth = useAuthController();
  const [isBooting, setIsBooting] = useState(true);
  const updaterPanel = platform.kind === 'android' ? <AndroidUpdatePanel /> : <UpdaterPanel />;

  useEffect(() => {
    const timeout = window.setTimeout(() => setIsBooting(false), 720);
    return () => window.clearTimeout(timeout);
  }, []);

  if (isBooting) {
    return <KodiakSplashScreen />;
  }

  if (!auth.user) {
    return null;
  }

  return (
    <>
      <WindowTitleBar platformKind={platform.kind} />
      <main className="app-shell app-shell--wide app-shell--framed">
        <AppFrame user={auth.user}>
          <section className="hero-card hero-card--brand">
            <p className="eyebrow eyebrow--ember">Official space</p>
            <h1>Kodiak Connect</h1>
            <p className="lede">
              Announcements, updater status, and active channels will live here as the Matrix layer comes online.
            </p>

            <dl className="status-grid" aria-label="Foundation status">
              <div>
                <dt>Platform</dt>
                <dd>{platform.kind}</dd>
              </div>
              <div>
                <dt>Updater</dt>
                <dd>Validated</dd>
              </div>
              <div>
                <dt>Matrix</dt>
                <dd>Coming Next</dd>
              </div>
            </dl>
          </section>

          {updaterPanel}
        </AppFrame>
      </main>
    </>
  );
}
