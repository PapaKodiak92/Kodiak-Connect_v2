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

interface AndroidUpdatePanelProps {
  onUpToDate?: () => void;
  onUpdateRequired?: () => void;
  onUpdateCheckFailed?: () => void;
}

export function AndroidUpdatePanel({ onUpToDate, onUpdateRequired, onUpdateCheckFailed }: AndroidUpdatePanelProps) {
  const [status, setStatus] = useState('Checking for updates...');
  const [remoteUpdate, setRemoteUpdate] = useState<AndroidUpdateManifest | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [hasError, setHasError] = useState(false);

  const checkAndroidUpdate = useCallback(async () => {
    setIsChecking(true);
    setHasError(false);
    setStatus('Checking for updates...');

    try {
      const manifest = await getAndroidUpdateManifest();
      const updateAvailable = isNewerVersion(manifest.version, updateManifest.currentVersion);

      setRemoteUpdate(manifest);
      setHasUpdate(updateAvailable);
      setStatus(updateAvailable ? `Update available: ${updateManifest.currentVersion} -> ${manifest.version}` : 'You are up to date.');

      if (updateAvailable) {
        onUpdateRequired?.();
      } else {
        window.setTimeout(() => onUpToDate?.(), 650);
      }
    } catch (error) {
      console.error('[Kodiak Connect] Android update check failed', error);
      setStatus('Updater is offline.');
      setRemoteUpdate(null);
      setHasUpdate(false);
      setHasError(true);
      onUpdateCheckFailed?.();
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
      eyebrow="Updater status"
      title="Updater"
      description="Keep Kodiak Connect current."
      statusText={status}
      detailText={remoteUpdate ? `Latest APK: ${remoteUpdate.version}` : 'Checking hosted APK.'}
      badgeText={`v${updateManifest.currentVersion}`}
      tone={tone}
      showIcon={false}
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
          Download APK
        </button>
      </div>
    </KodiakStatusCard>
  );
}

