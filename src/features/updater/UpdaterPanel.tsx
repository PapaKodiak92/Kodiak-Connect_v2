import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { KodiakStatusCard } from '../../components/ui/KodiakStatusCard';
import { updateManifest } from './updateManifest';
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdateInfo,
  type DesktopUpdaterStatus,
} from '../../platform/desktop/desktopUpdaterService';

function formatUpdaterStatus(status: DesktopUpdaterStatus, updateInfo: DesktopUpdateInfo | null) {
  if (status === 'checking') return 'Checking for updates...';
  if (status === 'available' && updateInfo) return `Update available: ${updateInfo.currentVersion} -> ${updateInfo.version}`;
  if (status === 'not-available') return 'You are up to date.';
  if (status === 'installing') return 'Installing update...';
  if (status === 'installed') return 'Update installed. Restart when prompted.';
  if (status === 'error') return 'Updater is offline.';
  return 'Updater ready.';
}

function getStatusTone(status: DesktopUpdaterStatus) {
  if (status === 'available') return 'available';
  if (status === 'checking' || status === 'installing') return 'working';
  if (status === 'error') return 'error';
  return 'ready';
}

async function openExternalUrl(url: string) {
  try {
    await openUrl(url);
  } catch (error) {
    console.error('[Kodiak Connect] Failed to open external link', error);
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

function SocialLinks() {
  const links = [
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

  return (
    <nav className="updater-social-dock" aria-label="Kodiak Connect support and social links">
      {links.map((link) => (
        <a
          key={link.href}
          className="launcher-social-link"
          href={link.href}
          title={link.title}
          aria-label={link.title}
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(link.href);
          }}
        >
          <span aria-hidden="true" dangerouslySetInnerHTML={{ __html: link.label }} />
        </a>
      ))}
    </nav>
  );
}

export function UpdaterPanel() {
  const [status, setStatus] = useState<DesktopUpdaterStatus>('checking');
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null);
  const [progressText, setProgressText] = useState('Checking current version...');
  const hasAutoChecked = useRef(false);

  const checkForUpdate = useCallback(async (source: 'auto' | 'manual') => {
    setStatus('checking');
    setProgressText(source === 'auto' ? 'Checking current version...' : 'Checking again...');

    try {
      const update = await checkForDesktopUpdate();
      setUpdateInfo(update);
      setStatus(update ? 'available' : 'not-available');
      setProgressText(update ? 'A new version is ready.' : 'Latest desktop version installed.');
    } catch (error) {
      console.error('[Kodiak Connect] Updater check failed', error);
      setStatus('error');
      setProgressText('Could not reach the update server.');
    }
  }, []);

  useEffect(() => {
    if (hasAutoChecked.current) return;
    hasAutoChecked.current = true;
    void checkForUpdate('auto');
  }, [checkForUpdate]);

  async function handleInstallUpdate() {
    setStatus('installing');
    setProgressText('Downloading update...');

    try {
      await installDesktopUpdate((progress) => {
        if (progress.event === 'Started') setProgressText('Download started.');

        if (progress.event === 'Progress' && progress.totalBytes) {
          const percent = Math.round((progress.downloadedBytes / progress.totalBytes) * 100);
          setProgressText(`Downloading... ${percent}%`);
        }

        if (progress.event === 'Finished') setProgressText('Download complete.');
      });

      setStatus('installed');
      setProgressText('Restart after install completes.');
    } catch (error) {
      console.error('[Kodiak Connect] Update install failed', error);
      setStatus('error');
      setProgressText('Install failed. Try again.');
    }
  }

  const tone = useMemo(() => getStatusTone(status), [status]);

  return (
    <KodiakStatusCard
      eyebrow="Updater status"
      title="Updater"
      description="Keep Kodiak Connect current."
      statusText={formatUpdaterStatus(status, updateInfo)}
      detailText={progressText}
      badgeText={`v${updateManifest.currentVersion}`}
      tone={tone}
      showIcon={false}
    >
      <div className="updater-footer-row">
        <div className="button-row">
          <button type="button" onClick={() => void checkForUpdate('manual')} disabled={status === 'checking' || status === 'installing'}>
            Check again
          </button>
          <button type="button" className="button-primary" onClick={handleInstallUpdate} disabled={status !== 'available'}>
            Install
          </button>
        </div>

        <SocialLinks />
      </div>
    </KodiakStatusCard>
  );
}
