import { useCallback, useEffect, useMemo, useState } from 'react';
import { KodiakStatusCard } from '../../components/ui/KodiakStatusCard';
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
  const [status, setStatus] = useState('Checking Android release channel...');
  const [remoteUpdate, setRemoteUpdate] = useState<AndroidUpdateManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasError, setHasError] = useState(false);

  const checkAndroidUpdate = useCallback(async () => {
    setIsChecking(true);
    setHasError(false);
    setStatus('Checking Android release channel...');

    try {
      const manifest = await getAndroidUpdateManifest();
      const updateAvailable = isNewerVersion(manifest.version, updateManifest.currentVersion);

      setRemoteUpdate(manifest);
      setHasUpdate(updateAvailable);
      setStatus(updateAvailable ? `Android APK ready: ${updateManifest.currentVersion} → ${manifest.version}` : 'Kodiak Connect is up to date on Android.');
    } catch (error) {
      console.error('[Kodiak Connect] Android update check failed', error);
      setStatus('Android update check failed. Try again when you have a stable connection.');
      setRemoteUpdate(null);
      setHasUpdate(false);
      setHasError(true);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkAndroidUpdate();
  }, [checkAndroidUpdate]);

  const tone = useMemo(() => {
    if (hasError) {
      return 'error';
    }

    if (isChecking) {
      return 'working';
    }

    return hasUpdate ? 'available' : 'ready';
  }, [hasError, hasUpdate, isChecking]);

  return (
    <KodiakStatusCard
      eyebrow="Android release channel"
      title="APK update helper"
      description="Download Android builds directly on this device. Android will ask you to approve installation before replacing the app."
      statusText={status}
      detailText={remoteUpdate ? `Latest hosted APK: ${remoteUpdate.version}` : 'Hosted APK manifest is checked securely from updates.kodiak-connect.com.'}
      badgeText={`v${updateManifest.currentVersion}`}
      tone={tone}
    >
      <div className="button-row">
        <button type="button" onClick={() => void checkAndroidUpdate()} disabled={isChecking}>
          Check again
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={!hasUpdate || !remoteUpdate}
          onClick={() => remoteUpdate && openAndroidApkDownload(remoteUpdate.url)}
        >
          Download latest APK
        </button>
      </div>
    </KodiakStatusCard>
  );
}
