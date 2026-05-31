import { useCallback, useEffect, useState } from 'react';
import { updateManifest } from './updateManifest';
import {
  getAndroidUpdateManifest,
  openAndroidApkDownload,
  type AndroidUpdateManifest,
} from '../../platform/android/androidUpdateService';

function isNewerVersion(remoteVersion: string, currentVersion: string) {
  const remoteParts = remoteVersion.split('.').map(Number);
  const currentParts = currentVersion.split('.').map(Number);
  const length = Math.max(remoteParts.length, currentParts.length);

  for (let index = 0; index < length; index += 1) {
    const remotePart = remoteParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;

    if (remotePart > currentPart) {
      return true;
    }

    if (remotePart < currentPart) {
      return false;
    }
  }

  return false;
}

export function AndroidUpdatePanel() {
  const [status, setStatus] = useState('Checking Android updates...');
  const [remoteUpdate, setRemoteUpdate] = useState<AndroidUpdateManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);

  const checkAndroidUpdate = useCallback(async () => {
    setStatus('Checking Android updates...');

    try {
      const manifest = await getAndroidUpdateManifest();
      const updateAvailable = isNewerVersion(manifest.version, updateManifest.currentVersion);

      setRemoteUpdate(manifest);
      setHasUpdate(updateAvailable);
      setStatus(updateAvailable ? `Android update available: ${manifest.version}` : 'Android APK is current.');
    } catch (error) {
      console.error('[Kodiak Connect] Android update check failed', error);
      setStatus('Android update check failed. Try again later.');
      setRemoteUpdate(null);
      setHasUpdate(false);
    }
  }, []);

  useEffect(() => {
    void checkAndroidUpdate();
  }, [checkAndroidUpdate]);

  return (
    <section className="panel" aria-labelledby="android-updater-title">
      <div>
        <p className="eyebrow">Android updates</p>
        <h2 id="android-updater-title">APK update helper</h2>
      </div>

      <p className="lede">
        Android updates are downloaded on-device. Your phone will ask for approval before installing the APK.
      </p>

      <div className="updater-actions">
        <p>{status}</p>
        {remoteUpdate ? <p className="muted-text">Latest hosted APK: {remoteUpdate.version}</p> : null}
        <div className="button-row">
          <button type="button" onClick={() => void checkAndroidUpdate()}>
            Check again
          </button>
          <button
            type="button"
            disabled={!hasUpdate || !remoteUpdate}
            onClick={() => remoteUpdate && openAndroidApkDownload(remoteUpdate.url)}
          >
            Download APK
          </button>
        </div>
      </div>
    </section>
  );
}
