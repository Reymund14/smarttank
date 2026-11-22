import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { evaluateReading, ruleRecommendations } from "@logic";
import { functions } from "../firebase";
import { useList, useValue } from "../hooks";
import { RecommendationCard, Empty } from "../components";

export default function Recommendations() {
  const recs = useList("recommendations", { limit: 30 });
  const live = useValue("live");
  const settings = useValue("settings");
  const profiles = useValue("profiles");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [localRec, setLocalRec] = useState(null);

  const profile = profiles?.[settings?.fishProfileId];

  const askNow = async () => {
    setBusy(true);
    setNote("");
    try {
      await httpsCallable(functions, "requestRecommendation")();
      setNote("New recommendation added.");
    } catch (err) {
      // Cloud Functions not deployed or offline → use the built-in rules instead.
      if (live && profile) {
        setLocalRec({ ...ruleRecommendations(evaluateReading(live, profile), profile), ts: Date.now() });
        setNote("AI service unavailable — showing rule-based guidance instead.");
      } else {
        setNote(`Could not get a recommendation: ${err.message}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>AI-assisted care recommendations</h1>
          <p className="muted">
            Generated automatically when a reading goes outside the acceptable range for the selected fish profile.
          </p>
        </div>
        <button onClick={askNow} disabled={busy}>{busy ? "Analyzing…" : "Analyze current condition"}</button>
      </section>
      {note && <p className="note">{note}</p>}
      {localRec && <RecommendationCard rec={localRec} />}
      {recs === undefined && <div className="muted">Loading…</div>}
      {recs?.length === 0 && !localRec && <Empty>No recommendations yet. They appear when a condition needs attention.</Empty>}
      {recs?.map((r) => <RecommendationCard key={r.id} rec={r} />)}
    </div>
  );
}
