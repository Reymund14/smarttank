// Small helpers so the same code runs in the browser and inside the Android app (Capacitor).
import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isNativeApp = () => Capacitor.isNativePlatform();

let nextId = 1;

/** Asks for permission to show notifications. Returns true if allowed. */
export async function requestNotificationPermission() {
  try {
    if (isNativeApp()) {
      const res = await LocalNotifications.requestPermissions();
      return res.display === "granted";
    }
    if (!("Notification" in window)) return false;
    if (Notification.permission === "default") await Notification.requestPermission();
    return Notification.permission === "granted";
  } catch {
    return false;
  }
}

/** Shows a notification: an Android notification in the app, a browser notification on the web. */
export async function notify(title, body) {
  try {
    if (isNativeApp()) {
      await LocalNotifications.schedule({ notifications: [{ id: nextId++, title, body }] });
    } else if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icons/icon-192.png" });
    }
  } catch {
    /* notifications are optional; alerts are always shown in the app */
  }
}
