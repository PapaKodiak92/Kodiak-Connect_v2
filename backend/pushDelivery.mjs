import { readFile } from "node:fs/promises";

let firebaseMessagingPromise = null;

function getFirebaseServiceAccountPath() {
  return process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
}

async function getFirebaseMessaging() {
  const serviceAccountPath = getFirebaseServiceAccountPath();

  if (!serviceAccountPath) {
    return null;
  }

  if (!firebaseMessagingPromise) {
    firebaseMessagingPromise = (async () => {
      const [{ cert, getApps, initializeApp }, { getMessaging }] = await Promise.all([
        import("firebase-admin/app"),
        import("firebase-admin/messaging"),
      ]);

      if (!getApps().length) {
        const serviceAccount = JSON.parse(await readFile(serviceAccountPath, "utf8"));
        initializeApp({
          credential: cert(serviceAccount),
        });
      }

      return getMessaging();
    })();
  }

  return firebaseMessagingPromise;
}

function stringifyPushData(data = {}) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === "string" ? value.slice(0, 1024) : JSON.stringify(value ?? "").slice(0, 1024),
    ]),
  );
}

function isInvalidFcmTokenError(error) {
  const code = String(error?.code ?? error?.errorInfo?.code ?? "");
  const message = String(error?.message ?? "");

  return (
    code.includes("registration-token-not-registered") ||
    code.includes("invalid-registration-token") ||
    message.includes("Requested entity was not found")
  );
}

export async function sendPushToUser(pushStore, targetUserId, notification, data = {}) {
  const messaging = await getFirebaseMessaging();

  const deviceEntries = Object.entries(pushStore).filter(([, device]) => {
    return (
      device?.userId === targetUserId &&
      device?.enabled !== false &&
      device?.provider === "fcm" &&
      device?.platform === "android" &&
      typeof device?.token === "string" &&
      device.token.length > 8
    );
  });

  if (!messaging) {
    return {
      enabled: false,
      attempted: deviceEntries.length,
      sent: 0,
      failed: 0,
      disabledDeviceKeys: [],
    };
  }

  let sent = 0;
  let failed = 0;
  const disabledDeviceKeys = [];

  for (const [deviceKey, device] of deviceEntries) {
    try {
      await messaging.send({
        token: device.token,
        notification: {
          title: notification.title,
          body: notification.body,
        },
        data: stringifyPushData(data),
        android: {
          priority: "high",
          notification: {
            channelId: "kodiak_default",
            sound: "default",
          },
        },
      });

      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn("[Kodiak Backend] FCM push failed", {
        code: error?.code,
        message: error?.message,
        targetUserId,
      });

      if (isInvalidFcmTokenError(error)) {
        pushStore[deviceKey] = {
          ...device,
          disabledAt: Date.now(),
          disabledReason: "invalid-fcm-token",
          enabled: false,
        };
        disabledDeviceKeys.push(deviceKey);
      }
    }
  }

  return {
    enabled: true,
    attempted: deviceEntries.length,
    disabledDeviceKeys,
    failed,
    sent,
  };
}

export async function sendPushToUsers(pushStore, targetUserIds, notification, data = {}) {
  const results = [];

  for (const targetUserId of targetUserIds) {
    results.push(await sendPushToUser(pushStore, targetUserId, notification, data));
  }

  return results.reduce(
    (summary, result) => ({
      enabled: summary.enabled || result.enabled,
      attempted: summary.attempted + result.attempted,
      sent: summary.sent + result.sent,
      failed: summary.failed + result.failed,
      disabledDeviceKeys: [...summary.disabledDeviceKeys, ...(result.disabledDeviceKeys ?? [])],
    }),
    { enabled: false, attempted: 0, sent: 0, failed: 0, disabledDeviceKeys: [] },
  );
}
