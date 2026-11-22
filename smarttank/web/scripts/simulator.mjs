/**
 * Device simulator — acts like the ESP32 so you can demo/test the dashboard,
 * alerts, and AI recommendations WITHOUT the hardware.
 *
 *   npm run simulate              normal readings that drift slowly
 *   npm run simulate -- hot       temperature rises until critical
 *   npm run simulate -- acid      pH drops
 *   npm run simulate -- low       water level drops (evaporation/leak)
 *   npm run simulate -- drift     temperature rises slowly (~2.4 °C/hour) → early-warning demo
 *
 * Reads Firebase settings and SIM_EMAIL / SIM_PASSWORD from web/.env
 */
import "dotenv/config";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, set, push, get, update } from "firebase/database";

const env = process.env;
const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
const db = getDatabase(app);
const ROOT = "aquarium";
const scenario = process.argv[2] || "normal";

let temp = 26.0, ph = 7.0, level = 95;
const jitter = (n) => (Math.random() - 0.5) * n;
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

function step() {
  if (scenario === "hot") temp += 0.25;
  else if (scenario === "acid") ph -= 0.05;
  else if (scenario === "low") level -= 1;
  else if (scenario === "drift") { temp += 0.02; ph += jitter(0.02); }
  else { temp += jitter(0.2); ph += jitter(0.04); level += jitter(0.4); }
  temp = Math.min(Math.max(temp, 15), 36);
  ph = Math.min(Math.max(ph, 5), 9);
  level = Math.min(Math.max(level, 40), 100);
  return {
    temperature: round(temp + jitter(0.1), 1),
    ph: round(ph + jitter(0.02), 2),
    waterLevel: Math.round(level),
    waterCm: round((level / 100) * 30, 1),
    phVoltage: round(2.5 - (ph - 7) * 0.18, 3),
    ts: Date.now(),
  };
}

let tick = 0;
async function loop() {
  const r = step();
  await set(ref(db, `${ROOT}/live`), { ...r, localStatus: "SIM", firmware: "simulator", rssi: -55 });
  if (tick % 2 === 0) await push(ref(db, `${ROOT}/history`), r);
  tick++;
  console.log(`[sim:${scenario}] ${r.temperature}°C  pH ${r.ph}  level ${r.waterLevel}%`);

  // respond to "Feed Now" like the real device
  const cmd = (await get(ref(db, `${ROOT}/commands/feedNow`))).val();
  if (cmd?.requested) {
    await update(ref(db, `${ROOT}/commands/feedNow`), { requested: false, doneAt: Date.now() });
    await push(ref(db, `${ROOT}/feedingLogs`), { ts: Date.now(), type: "manual", portions: cmd.portions || 1, success: true });
    console.log(`[sim] fed ${cmd.portions || 1} portion(s)`);
  }
}

if (!env.SIM_EMAIL || !env.SIM_PASSWORD) {
  console.error("Set SIM_EMAIL and SIM_PASSWORD in web/.env (use the device account).");
  process.exit(1);
}
await signInWithEmailAndPassword(auth, env.SIM_EMAIL, env.SIM_PASSWORD);
console.log(`Signed in. Simulating "${scenario}" every 30 s (Ctrl+C to stop).`);
await loop();
setInterval(() => loop().catch((e) => console.error(e.message)), 30000);
