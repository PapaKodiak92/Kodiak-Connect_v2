import { kodiakPlatform } from './currentPlatform';

type BrowserWritableFile = {
  close: () => Promise<void>;
  write: (data: Blob) => Promise<void>;
};

type BrowserFileHandle = {
  createWritable: () => Promise<BrowserWritableFile>;
};

type BrowserSaveFilePicker = (options?: {
  suggestedName?: string;
}) => Promise<BrowserFileHandle>;

function getBrowserSaveFilePicker() {
  return (window as Window & { showSaveFilePicker?: BrowserSaveFilePicker }).showSaveFilePicker ?? null;
}

async function chooseBrowserSaveFile(suggestedName: string) {
  const saveFilePicker = getBrowserSaveFilePicker();

  if (!saveFilePicker) {
    return null;
  }

  return saveFilePicker({ suggestedName });
}

async function writeBrowserFile(fileHandle: BrowserFileHandle, blob: Blob) {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function chooseTauriSavePath(suggestedName: string) {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string | null>('choose_save_path', { suggestedName });
}

async function writeTauriFile(savePath: string, blob: Blob) {
  const { invoke } = await import('@tauri-apps/api/core');
  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));

  await invoke('write_downloaded_file', {
    path: savePath,
    bytes,
  });
}

export async function saveBlobWithPlatformPicker(suggestedName: string, blob: Blob) {
  if (kodiakPlatform.info.runtime === 'tauri-desktop') {
    const savePath = await chooseTauriSavePath(suggestedName);

    if (!savePath) {
      return false;
    }

    await writeTauriFile(savePath, blob);
    return true;
  }

  const browserFileHandle = await chooseBrowserSaveFile(suggestedName);

  if (!browserFileHandle) {
    return false;
  }

  await writeBrowserFile(browserFileHandle, blob);
  return true;
}
