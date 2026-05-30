import { useState } from 'react';
import { updateManifest } from './updateManifest';
import {
  checkForDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdateInfo,
  type DesktopUpdaterStatus,
} from '../../platform/desktop/desktopUpdaterService';

function formatUpdaterStatus(status: DesktopUpdaterStatus, updateInfo: DesktopUpdateInfo | null) {
  if (status === 'checking') {
    return 'Checking for updates...';
  }

  if (status === 'available' && updateInfo) {
    return `Update available: ${updateInfo.currentVersion} -> ${updateInfo.version}`;
  }

  if (status === 'not-available') {
    return 'No desktop update is available.';
  }

  if (status === 'installing') {
    return 'Installing update...';
  }

  if (status === 'installed') {
    return 'Update installed. Restart the app to finish.';
  }

  if (status === 'error') {
    return 'Updater check failed. See console logs.';
  }

  return 'Ready to check hosted desktop updates.';
}

export function UpdaterPanel() {
  const [status, setStatus] = useState<DesktopUpdaterStatus>('not-available');
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null);
  const [progressText, setProgressText] = useState('');

  async function handleCheckForUpdate() {
    setStatus('checking');
    setProgressText('');

    try {
      const update = await checkForDesktopUpdate();
      setUpdateInfo(update);
      setStatus(update ? 'available' : 'not-available');
    } catch (error) {
      console.error('[Kodiak Connect] Updater check failed', error);
      setStatus('error');
    }
  }

  async function handleInstallUpdate() {
    setStatus('installing');

    try {
      await installDesktopUpdate((progress) => {
        if (progress.event === 'Started') {
          setProgressText('Download started.');
        }

        if (progress.event === 'Progress' && progress.totalBytes) {
          const percent = Math.round((progress.downloadedBytes / progress.totalBytes) * 100);
          setProgressText(`Downloaded ${percent}%`);
        }

        if (progress.event === 'Finished') {
          setProgressText('Download finished. Installing...');
        }
      });

      setStatus('installed');
    } catch (error) {
      console.error('[Kodiak Connect] Update install failed', error);
      setStatus('error');
    }
  }

  return (
    <section className="panel" aria-labelledby="updater-title">
      <div>
        <p className="eyebrow">Installers first</p>
        <h2 id="updater-title">Updater foundation v0.1.1</h2>
      </div>

      <ul className="checklist">
        <li>Version manifest: {updateManifest.currentVersion}</li>
        <li>Tauri desktop updater: hosted manifest ready</li>
        <li>Android APK release path: debug APK validated</li>
        <li>Web deploy path: VPS-ready static build</li>
      </ul>

      <div className="updater-actions">
        <p>{formatUpdaterStatus(status, updateInfo)}</p>
        {progressText ? <p className="muted-text">{progressText}</p> : null}
        <div className="button-row">
          <button type="button" onClick={handleCheckForUpdate} disabled={status === 'checking' || status === 'installing'}>
            Check for update
          </button>
          <button type="button" onClick={handleInstallUpdate} disabled={status !== 'available'}>
            Install update
          </button>
        </div>
      </div>
    </section>
  );
}
