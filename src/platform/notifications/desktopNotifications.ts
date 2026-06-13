import { kodiakPlatform } from '../currentPlatform';

type TauriNotificationModule = typeof import('@tauri-apps/plugin-notification');

interface KodiakDesktopNotificationOptions {
  title: string;
  body: string;
  tag?: string;
  onClick?: () => void;
}

function isTauriRuntime() {
  return kodiakPlatform.info.runtime === 'tauri-desktop';
}

async function loadTauriNotifications(): Promise<TauriNotificationModule | null> {
  if (!isTauriRuntime()) {
    return null;
  }

  try {
    return await import('@tauri-apps/plugin-notification');
  } catch (error) {
    console.warn('[Kodiak Connect] Failed to load Tauri notification plugin', error);
    return null;
  }
}

function truncateNotificationBody(body: string) {
  return body.length > 120 ? `${body.slice(0, 117)}...` : body;
}

export function areKodiakNotificationsEnabled() {
  return window.localStorage.getItem('KC_BROWSER_NOTIFICATIONS') === 'true';
}

export function isKodiakDesktopNotificationAvailable() {
  return isTauriRuntime() || ('Notification' in window && window.isSecureContext);
}

export async function requestKodiakDesktopNotificationPermission() {
  const tauriNotifications = await loadTauriNotifications();

  if (tauriNotifications) {
    if (await tauriNotifications.isPermissionGranted()) {
      return true;
    }

    return (await tauriNotifications.requestPermission()) === 'granted';
  }

  if (!('Notification' in window) || !window.isSecureContext) {
    return false;
  }

  if (Notification.permission === 'granted') {
    return true;
  }

  if (Notification.permission === 'denied') {
    return false;
  }

  return (await Notification.requestPermission()) === 'granted';
}

export async function showKodiakDesktopNotification(options: KodiakDesktopNotificationOptions) {
  if (!areKodiakNotificationsEnabled()) {
    return false;
  }

  const body = truncateNotificationBody(options.body);
  const tauriNotifications = await loadTauriNotifications();

  if (tauriNotifications) {
    const hasPermission = await requestKodiakDesktopNotificationPermission();

    if (!hasPermission) {
      return false;
    }

    tauriNotifications.sendNotification({
      title: options.title,
      body,
    });

    return true;
  }

  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }

  const notification = new Notification(options.title, {
    body,
    icon: 'favicon.ico',
    silent: true,
    tag: options.tag,
  });

  notification.onclick = () => {
    window.focus();
    options.onClick?.();
    notification.close();
  };

  return true;
}
