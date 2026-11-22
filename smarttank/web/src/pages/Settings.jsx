import { useEffect, useState } from "react";
import { ref, set, update } from "firebase/database";
import { db, ROOT } from "../firebase";
import { useValue } from "../hooks";
import { DEFAULT_PROFILES } from "../defaultProfiles";
import { requestNotificationPermission } from "../platform";

const FIELDS = [
  ["tempMin", "Min temperature (°C)", 0.5],
  ["tempMax", "Max temperature (°C)", 0.5],
  ["phMin", "Min pH", 0.1],
  ["phMax", "Max pH", 0.1],
  ["levelMinPct", "Warning below water level (%)", 1],
  ["levelCriticalPct", "Critical below water level (%)", 1],
  ["feedsPerDay", "Typical feedings per day (for AI feeding advice)", 1],
];

const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export default function Settings() {
  const settings = useValue("settings");
  const profiles = useValue("profiles");
  const [selected, setSelected] = useState("");
  const [form, setForm] = useState(null);
  const [tank, setTank] = useState({ sensorToBottomCm: 45, fullWaterCm: 30 });
  const [browserNotif, setBrowserNotif] = useState(true);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!settings) return;
    setSelected(settings.fishProfileId || "");
    if (settings.tank) setTank(settings.tank);
    setBrowserNotif(settings.notifications?.browser !== false);
  }, [settings]);

  useEffect(() => {
    setForm(selected && profiles?.[selected] ? { ...profiles[selected] } : null);
  }, [selected, profiles]);

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(""), 4000); };

  const loadDefaults = async () => {
    await update(ref(db, `${ROOT}/profiles`), DEFAULT_PROFILES);
    flash("Default fish profiles loaded.");
  };

  const selectProfile = async (id) => {
    setSelected(id);
    await update(ref(db, `${ROOT}/settings`), { fishProfileId: id });
    flash("Fish profile selected.");
  };

  const saveProfile = async () => {
    const clean = { ...form };
    FIELDS.forEach(([k]) => (clean[k] = Number(clean[k])));
    if (clean.tempMin >= clean.tempMax || clean.phMin >= clean.phMax) return flash("Min must be lower than max.");
    if (clean.levelCriticalPct >= clean.levelMinPct) return flash("Critical level must be lower than the warning level.");
    await set(ref(db, `${ROOT}/profiles/${selected}`), clean);
    flash("Profile ranges saved.");
  };

  const addProfile = async () => {
    const id = slug(newName);
    if (!id) return;
    await set(ref(db, `${ROOT}/profiles/${id}`), {
      name: newName.trim(), tempMin: 24, tempMax: 28, phMin: 6.5, phMax: 7.5, levelMinPct: 85, levelCriticalPct: 70, feedsPerDay: 2, notes: "",
    });
    setNewName("");
    await selectProfile(id);
  };

  const saveTank = async () => {
    const s = { sensorToBottomCm: Number(tank.sensorToBottomCm), fullWaterCm: Number(tank.fullWaterCm) };
    if (!(s.fullWaterCm > 0 && s.fullWaterCm < s.sensorToBottomCm)) return flash("Full water depth must be less than the sensor-to-bottom distance.");
    await update(ref(db, `${ROOT}/settings`), { tank: s });
    flash("Tank settings saved.");
  };

  const saveNotif = async (on) => {
    setBrowserNotif(on);
    if (on) await requestNotificationPermission();
    await update(ref(db, `${ROOT}/settings/notifications`), { browser: on });
  };

  if (settings === undefined || profiles === undefined) return <div className="muted">Loading…</div>;

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Fish profile, acceptable ranges, tank size, and notifications.</p>
        </div>
      </section>
      {msg && <p className="note">{msg}</p>}

      <section className="card">
        <h2>Fish profile</h2>
        {!profiles && (
          <p>
            No fish profiles yet. <button className="ghost" onClick={loadDefaults}>Load default profiles</button>
          </p>
        )}
        {profiles && (
          <>
            <label>
              Fish in this aquarium
              <select value={selected} onChange={(e) => selectProfile(e.target.value)}>
                <option value="" disabled>Select…</option>
                {Object.entries(profiles).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
              </select>
            </label>
            {form && (
              <>
                {form.notes && <p className="muted small">{form.notes}</p>}
                <div className="form-grid">
                  {FIELDS.map(([k, label, step]) => (
                    <label key={k}>
                      {label}
                      <input type="number" step={step} value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <button onClick={saveProfile}>Save ranges</button>
              </>
            )}
            <div className="row top-gap">
              <input placeholder="New fish profile name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="ghost" onClick={addProfile} disabled={!newName.trim()}>Add profile</button>
              <button className="ghost" onClick={loadDefaults}>Restore defaults</button>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>Tank & water level sensor</h2>
        <p className="muted small">
          Measure from the face of the ultrasonic sensor to the tank bottom, and the water depth you consider "full" (100%).
        </p>
        <div className="form-grid">
          <label>
            Sensor to tank bottom (cm)
            <input type="number" step="0.5" value={tank.sensorToBottomCm} onChange={(e) => setTank({ ...tank, sensorToBottomCm: e.target.value })} />
          </label>
          <label>
            Full water depth (cm)
            <input type="number" step="0.5" value={tank.fullWaterCm} onChange={(e) => setTank({ ...tank, fullWaterCm: e.target.value })} />
          </label>
        </div>
        <button onClick={saveTank}>Save tank settings</button>
      </section>

      <section className="card">
        <h2>Notifications</h2>
        <label className="row">
          <input type="checkbox" checked={browserNotif} onChange={(e) => saveNotif(e.target.checked)} />
          Show notifications for new alerts while SmartTank is open
        </label>
      </section>
    </div>
  );
}
