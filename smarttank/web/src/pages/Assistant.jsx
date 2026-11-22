import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { evaluateReading, predictTrend } from "@logic";
import { functions } from "../firebase";
import { useList, useValue } from "../hooks";

const SUGGESTIONS = [
  "Is my tank okay right now?",
  "Why could my pH be dropping?",
  "How often should I feed my fish?",
  "What should I do if the power goes out?",
  "Summarize the last 24 hours.",
];

const WELCOME = {
  role: "assistant",
  content:
    "Hi! I'm AquaBuddy, your aquarium assistant. I can see your live readings, fish profile, trends and feeding log. Ask me anything about your aquarium.",
  source: "ai",
};

export default function Assistant() {
  const live = useValue("live");
  const settings = useValue("settings");
  const profiles = useValue("profiles");
  const history = useList("history", { limit: 120 });
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);

  // Used only when the cloud AI cannot be reached.
  const localAnswer = () => {
    const profile = profiles?.[settings?.fishProfileId];
    if (!live || !profile) return "I can't reach the AI service and there is no reading or fish profile yet.";
    const e = evaluateReading(live, profile);
    const t = predictTrend(history || [], profile);
    const lines = [`Overall status: ${e.overall.toUpperCase()}.`, e.params.temperature.reason, e.params.ph.reason, e.params.waterLevel.reason];
    t.risks.forEach((r) => lines.push(`Early warning: ${r.message}`));
    lines.push("(The AI assistant is offline, so this is an automatic status summary.)");
    return lines.join(" ");
  };

  const ask = async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const prior = next.slice(1, -1).map(({ role, content }) => ({ role, content })); // skip welcome + new question
      const res = await httpsCallable(functions, "askAssistant")({ question: q, history: prior });
      setMessages([...next, { role: "assistant", content: res.data.answer, source: res.data.source }]);
    } catch (err) {
      const content = err.code === "functions/resource-exhausted" ? err.message : localAnswer();
      setMessages([...next, { role: "assistant", content, source: "rules" }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <section className="page-head">
        <div>
          <h1>AI assistant</h1>
          <p className="muted">Ask questions about your aquarium. Answers use your live readings, trends, fish profile and feeding log.</p>
        </div>
        <button className="ghost" onClick={() => setMessages([WELCOME])} disabled={messages.length < 2}>New chat</button>
      </section>

      <section className="card chat">
        <div className="chat-log" aria-live="polite">
          {messages.map((m, i) => (
            <div key={i} className={`bubble ${m.role}`}>
              <div className="bubble-text">{m.content}</div>
              {m.role === "assistant" && i > 0 && (
                <div className="muted small">{m.source === "ai" ? "AI-assisted answer" : "Automatic summary"}</div>
              )}
            </div>
          ))}
          {busy && <div className="bubble assistant typing muted">AquaBuddy is checking your aquarium…</div>}
          <div ref={endRef} />
        </div>
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip-btn" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
          <input
            id="chat-input"
            aria-label="Your question"
            placeholder="Type a question about your aquarium…"
            value={input}
            maxLength={500}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" disabled={busy || !input.trim()}>Ask</button>
        </form>
        <p className="disclaimer small">
          Basic aquarium care guidance only. It does not replace advice from a veterinarian or aquatic specialist.
        </p>
      </section>
    </div>
  );
}
