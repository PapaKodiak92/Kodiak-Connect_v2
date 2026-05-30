export type DesktopUpdaterStatus =
  | 'unsupported'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'installing'
  | 'installed'
  | 'error';

export interface DesktopUpdateInfo {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
}

export interface DesktopUpdateProgress {
  event: 'Started' | 'Progress' | 'Finished';
  downloadedBytes: number;
  totalBytes?: number;
}

interface TauriDownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: {
    contentLength?: number;
    chunkLength?: number;
  };
}

interface TauriPendingUpdate {
  version: string;
  currentVersion: string;
  body?: string;
  date?: string;
  downloadAndInstall: (onEvent?: (event: TauriDownloadEvent) => void) => Promise<void>;
}

let pendingUpdate: TauriPendingUpdate | null = null;

export async function checkForDesktopUpdate(): Promise<DesktopUpdateInfo | null> {
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = (await check()) as TauriPendingUpdate | null;

  pendingUpdate = update;

  if (!update) {
    return null;
  }

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    body: update.body,
    date: update.date,
  };
}

export async function installDesktopUpdate(
  onProgress?: (progress: DesktopUpdateProgress) => void,
): Promise<void> {
  if (!pendingUpdate) {
    throw new Error('No pending desktop update is available.');
  }

  let downloadedBytes = 0;
  let totalBytes: number | undefined;

  await pendingUpdate.downloadAndInstall((event) => {
    if (event.event === 'Started') {
      downloadedBytes = 0;
      totalBytes = event.data?.contentLength;
    }

    if (event.event === 'Progress') {
      downloadedBytes += event.data?.chunkLength ?? 0;
    }

    onProgress?.({
      event: event.event,
      downloadedBytes,
      totalBytes,
    });
  });
}
