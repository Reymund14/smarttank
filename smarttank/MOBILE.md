# SmartTank mobile app (Android APK)

The SmartTank dashboard is also packaged as an Android app with [Capacitor](https://capacitorjs.com).
It's the same React dashboard, but it installs from an APK, opens full-screen with its own icon,
uses a bottom navigation bar, and shows Android notifications for new alerts while the app is open.

There are three ways to get it on a phone. **Option A is the easiest.**

---

## Option A — Build the APK in the cloud with GitHub Actions (no Android Studio)

1. Create a GitHub repository and push the whole `smarttank` folder to it (branch `main`).
2. In the repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Add these (values come from your Firebase web app config, the same ones in `web/.env`):

   | Secret | Example |
   |---|---|
   | `VITE_FIREBASE_API_KEY` | `AIza...` |
   | `VITE_FIREBASE_AUTH_DOMAIN` | `your-project.firebaseapp.com` |
   | `VITE_FIREBASE_DATABASE_URL` | `https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app` |
   | `VITE_FIREBASE_PROJECT_ID` | `your-project` |
   | `VITE_FIREBASE_APP_ID` | `1:123...:web:abc...` |
   | `VITE_FUNCTIONS_REGION` *(optional)* | `us-central1` |

3. Open the **Actions** tab → **Build Android APK** → **Run workflow**.
4. Wait about 5–8 minutes. Open the finished run and download **SmartTank-apk** under *Artifacts*.
   Unzip it to get `SmartTank-debug.apk`.
5. Copy the APK to the phone and open it. Android will ask you to allow installing from this source.
   Allow it, then tap **Install**.

Every push to `main` that changes the dashboard builds a new APK automatically.

## Option B — Build on your laptop with Android Studio

Requirements: Node.js 20, Android Studio (Hedgehog or newer), JDK 17.

```bash
cd web
cp .env.example .env          # fill in your Firebase web config
npm install
npm run build
npm run android:add           # creates the web/android project (first time only)
npm run android:icons         # SmartTank icon and splash screen
npm run android:sync          # copy the latest build into the Android project
npm run android:open          # opens Android Studio
```

In Android Studio: **Build → Build App Bundle(s) / APK(s) → Build APK(s)**,
or connect a phone with USB debugging and press **Run ▶**.
After any change to the dashboard, run `npm run android:sync` again.

For Android 13 and newer, add this line to `web/android/app/src/main/AndroidManifest.xml`
(just before `</manifest>`) so the app can show notifications. The GitHub workflow does this for you.

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

## Option C — Install the web app (no APK)

Deploy the dashboard (`npm run build`, then `firebase deploy --only hosting`), open it in Chrome
on the phone, and tap **⋮ → Add to Home screen / Install app**. It gets the SmartTank icon, opens
full-screen, and keeps working screens offline. This works on iPhones too (Safari → Share → Add to Home Screen).

---

## Notes

- **Debug APK.** The APK from Options A/B is a debug build. It's fine for testing, demos and your defense.
  To publish on the Google Play Store you need a signed **release** build (Android Studio →
  *Build → Generate Signed Bundle / APK*) and a Play Console account.
- **Same account and data.** Log in with the same Firebase owner account. The app, the website and
  the ESP32 all use the same Firebase database, so everything stays in sync.
- **Notifications.** Alerts appear as Android notifications while SmartTank is open or in the
  background for a short time. Alerts that arrive while the app is fully closed are not pushed. That
  would need Firebase Cloud Messaging, which is listed as a future improvement.
- **API key restrictions.** If you restricted the Firebase API key to certain websites in Google Cloud,
  also allow `localhost`, because the app's pages are served from `https://localhost` inside the app.
- **App ID.** The package name is `edu.olfu.smarttank` (in `web/capacitor.config.json`). Change it
  before the first build if your adviser prefers a different one.
