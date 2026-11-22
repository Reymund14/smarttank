import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { ref, onValue, query, orderByChild, limitToLast, startAt } from "firebase/database";
import { auth, db, ROOT } from "./firebase";

export function useAuth() {
  const [user, setUser] = useState(undefined); // undefined = still loading
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

/** Live value of /aquarium/<path>. */
export function useValue(path) {
  const [value, setValue] = useState(undefined);
  useEffect(() => {
    const r = ref(db, `${ROOT}/${path}`);
    return onValue(r, (s) => setValue(s.val()), () => setValue(null));
  }, [path]);
  return value;
}

/** Live list ordered by ts (newest first). Use `since` (ms) or `limit`. */
export function useList(path, { limit = 50, since } = {}) {
  const [items, setItems] = useState(undefined);
  useEffect(() => {
    const base = ref(db, `${ROOT}/${path}`);
    const q = since
      ? query(base, orderByChild("ts"), startAt(since))
      : query(base, orderByChild("ts"), limitToLast(limit));
    return onValue(
      q,
      (snap) => {
        const out = [];
        snap.forEach((c) => {
          out.push({ id: c.key, ...c.val() });
        });
        setItems(out.reverse());
      },
      () => setItems([])
    );
  }, [path, limit, since]);
  return items;
}

/** Re-renders every `ms` so "x minutes ago" and online status stay fresh. */
export function useNow(ms = 15000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
