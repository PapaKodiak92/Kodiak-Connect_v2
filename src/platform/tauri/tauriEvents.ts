import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type TauriUnlistenFn = UnlistenFn;

export function listenTauriEvent<T>(
  eventName: string,
  handler: (event: { payload: T }) => void,
): Promise<TauriUnlistenFn> {
  return listen<T>(eventName, handler);
}