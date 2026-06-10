import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { MatrixLoginIdentity } from '../auth/matrixLoginService';
import { registerKodiakPushDevice } from '../backend/kodiakApiClient';

const PUSH_DEVICE_ID_KEY = 'KC_PUSH_DEVICE_ID';

let activeIdentity: MatrixLoginIdentity | null = null;
let hasInstalledPushListeners = false;

function createFallbackDeviceId() {
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function getPushDeviceId() {
  const existingDeviceId = window.localStorage.getItem(PUSH_DEVICE_ID_KEY);

  if (existingDeviceId) {
    return existingDeviceId;
  }

  const nextDeviceId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : createFallbackDeviceId();
  window.localStorage.setItem(PUSH_DEVICE_ID_KEY, nextDeviceId);
  return nextDeviceId;
}

async function createKodiakNotificationChannel() {
  try {
    await PushNotifications.createChannel({
      id: 'kodiak_default',
      name: 'Kodiak Connect',
      description: 'Kodiak Connect notifications',
      importance: 4,
      visibility: 1,
      sound: 'default',
      vibration: true,
    });
  } catch (error) {
    console.warn('[Kodiak Connect] Failed to create Android notification channel', error);
  }
}

async function installAndroidPushListeners() {
  if (hasInstalledPushListeners) {
    return;
  }

  hasInstalledPushListeners = true;

  await PushNotifications.addListener('registration', (token) => {
    const identity = activeIdentity;

    if (!identity || !token.value) {
      return;
    }

    void registerKodiakPushDevice(identity, {
      appVersion: import.meta.env.VITE_APP_VERSION as string | undefined,
      deviceId: getPushDeviceId(),
      platform: 'android',
      provider: 'fcm',
      token: token.value,
      userAgent: navigator.userAgent,
    }).catch((error) => {
      console.warn('[Kodiak Connect] Failed to register push token with backend', error);
    });
  });

  await PushNotifications.addListener('registrationError', (error) => {
    console.warn('[Kodiak Connect] Android push registration failed', error);
  });

  await PushNotifications.addListener('pushNotificationReceived', (notification) => {
    console.info('[Kodiak Connect] Push notification received', notification);
  });

  await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    console.info('[Kodiak Connect] Push notification action performed', notification);
  });
}

export async function initializeKodiakPushNotifications(identity: MatrixLoginIdentity) {
  activeIdentity = identity;

  if (Capacitor.getPlatform() !== 'android') {
    return { ok: false, reason: 'not-android' };
  }

  await installAndroidPushListeners();

  let permissions = await PushNotifications.checkPermissions();

  if (permissions.receive === 'prompt') {
    permissions = await PushNotifications.requestPermissions();
  }

  if (permissions.receive !== 'granted') {
    return { ok: false, reason: 'permission-denied' };
  }

  await createKodiakNotificationChannel();
  await PushNotifications.register();

  return { ok: true };
}
