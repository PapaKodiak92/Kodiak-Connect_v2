import { kodiakPlatform } from './currentPlatform';

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function getStartMinimizedSetting(): Promise<boolean> {
  if (kodiakPlatform.info.runtime !== 'tauri-desktop') {
    return false;
  }

  return Boolean(await invokeTauri<boolean>('get_start_minimized'));
}

export async function setStartMinimizedSetting(enabled: boolean): Promise<boolean> {
  if (kodiakPlatform.info.runtime !== 'tauri-desktop') {
    return false;
  }

  return Boolean(await invokeTauri<boolean>('set_start_minimized', { enabled }));
}