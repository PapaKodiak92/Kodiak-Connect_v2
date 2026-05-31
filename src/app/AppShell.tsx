import { useCallback, useEffect, useState } from 'react';
import { LoginScreen } from '../features/auth/LoginScreen';
import { AndroidUpdatePanel } from '../features/updater/AndroidUpdatePanel';
import { UpdaterPanel } from '../features/updater/UpdaterPanel';
import { KodiakSplashScreen } from '../components/layout/KodiakSplashScreen';
import { WindowTitleBar } from '../components/layout/WindowTitleBar';
import { openAndroidApkDownload } from '../platform/android/androidUpdateService';
import { usePlatformInfo } from '../platform/usePlatformInfo';

type AppState = 'booting' | 'checking-update' | 'update-required' | 'login';

const launcherLinks = [
  {
    href: 'mailto:support@kodiak-connect.com?subject=Kodiak%20Connect%20Support',
    title: 'Email support',
    label: '@',
  },
  {
    href: 'https://www.facebook.com/PapaKodiak/',
    title: 'Facebook',
    label: 'f',
  },
  {
    href: 'https://x.com/PapaKodiak92',
    title: 'X',
    label: 'X',
  },
  {
    href: 'https://www.instagram.com/papakodiak92/',
    title: 'Instagram',
    label: '&#x25CE;',
  },
  {
    href: 'https://buymeacoffee.com/papakodiak',
    title: 'Buy me a coffee',
    label: '&#x2615;',
  },
];

interface LauncherSocialLinksProps {
  isMobile: boolean;
}

function LauncherSocialLinks({ isMobile }: LauncherSocialLinksProps) {
  return (
    <nav className="launcher-mobile-social-dock" aria-label="Kodiak Connect support and social links">
      {launcherLinks.map((link) => (
        <a
          key={link.href}
          className="launcher-social-link"
          href={link.href}
          title={link.title}
          aria-label={link.title}
          target={link.href.startsWith('mailto:') ? undefined : '_blank'}
          rel={link.href.startsWith('mailto:') ? undefined : 'noreferrer'}
          onClick={(event) => {
            if (!isMobile) {
              return;
            }

            event.preventDefault();
            openAndroidApkDownload(link.href);
          }}
        >
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: link.label }} />
        </a>
      ))}
    </nav>
  );
}

export function AppShell() {
  const platform = usePlatformInfo();
  const [appState, setAppState] = useState<AppState>('booting');
  const updaterOnline = true;
  const serverOnline = false;
  const isMobile = platform.kind === 'android';
  const isWebDev = import.meta.env.DEV && platform.kind === 'web';
  const platformLabel = isMobile ? 'Mobile' : platform.kind === 'desktop' ? 'Desktop' : 'Web';

  useEffect(() => {
    const timeout = window.setTimeout(() => setAppState('checking-update'), 420);
    return () => window.clearTimeout(timeout);
  }, []);

  const handleUpToDate = useCallback(() => {
    setAppState('login');
  }, []);

  const handleUpdateRequired = useCallback(() => {
    setAppState('update-required');
  }, []);

  const handleUpdateCheckFailed = useCallback(() => {
    if (isWebDev) {
      setAppState('login');
      return;
    }

    setAppState('update-required');
  }, [isWebDev]);

  const updaterPanel = isMobile ? (
    <AndroidUpdatePanel onUpToDate={handleUpToDate} onUpdateRequired={handleUpdateRequired} onUpdateCheckFailed={handleUpdateCheckFailed} />
  ) : (
    <UpdaterPanel
      onUpToDate={handleUpToDate}
      onUpdateRequired={handleUpdateRequired}
      onUpdateCheckFailed={handleUpdateCheckFailed}
      allowContinueOnFailure={isWebDev}
    />
  );

  if (appState === 'booting') {
    return <KodiakSplashScreen />;
  }

  if (appState === 'login') {
    return (
      <>
        <WindowTitleBar platformKind={platform.kind} />
        <LoginScreen />
      </>
    );
  }

  return (
    <>
      <WindowTitleBar platformKind={platform.kind} />

      <main className="launcher-shell">
        <section className="launcher-card" aria-label="Kodiak Connect launcher">
          <LauncherSocialLinks isMobile={isMobile} />

          <div className="launcher-card__intro">
            <div className="brand-orb">
              <img src="/kodiak-connect-icon.png" alt="" />
            </div>

            <div>
              <p className="eyebrow eyebrow--ember">Kodiak Connect</p>
              <h1>{appState === 'checking-update' ? 'Checking updates.' : 'Update required.'}</h1>
              <p>
                {appState === 'checking-update'
                  ? 'Kodiak Connect is validating your version before login.'
                  : 'Install the latest version to continue.'}
              </p>
            </div>
          </div>

          <div className="launcher-card__status">
            <div className="status-bar">
              <span>Platform: {platformLabel}</span>
              <span className="status-light status-light--online" aria-label="platform ready" />
            </div>

            <div className="status-bar">
              <span>Updater: {updaterOnline ? 'Online' : 'Offline'}</span>
              <span
                className={`status-light ${updaterOnline ? 'status-light--online' : 'status-light--offline'}`}
                aria-label={updaterOnline ? 'updater online' : 'updater offline'}
              />
            </div>

            <div className="status-bar">
              <span>Server: {serverOnline ? 'Online' : 'Offline'}</span>
              <span
                className={`status-light ${serverOnline ? 'status-light--online' : 'status-light--offline'}`}
                aria-label={serverOnline ? 'server online' : 'server offline'}
              />
            </div>
          </div>
        </section>

        {updaterPanel}
      </main>
    </>
  );
}
