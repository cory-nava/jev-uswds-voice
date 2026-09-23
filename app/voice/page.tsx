"use client";
/**
 * Voice planner: talk into the page planner and watch USWDS pages build
 * in real time. Each utterance goes straight to Jev (one evaluation call),
 * Jev's answers are applied as JSON patches, and the loop goes back to
 * listening.
 *
 * Speech capture uses the browser's SpeechRecognition API — on Apple
 * devices this is Apple's speech stack (on-device/server STT).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SpecCanvas } from "@/lib/registry";
import { DEMO_SCRIPT } from "@/lib/demo-script";
import type { PageSpec } from "@/lib/spec";

interface Decision { question: string; choice: string; label: string; confidence: number | null; }
interface LogEntry {
  id: number;
  kind: "utterance" | "decisions" | "note" | "error" | "system";
  text: string;
  decisions?: Decision[];
  candidates?: string[];
  ms?: number;
}

let logId = 0;
const QUESTION_LABELS: Record<string, string> = {
  is_ui_instruction: "ui?",
  page_intent: "page",
  operation: "operation",
  target: "target",
  placement: "placement",
  component: "component",
};

export default function VoicePlanner() {
  const [pages, setPages] = useState<PageSpec[]>([]);
  const [currentPageId, setCurrentPageId] = useState("marketing");
  const [log, setLog] = useState<LogEntry[]>([]);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);

  const armedRef = useRef(false);
  const recRef = useRef<any>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const playRef = useRef(false);

  const pushLog = useCallback((entry: Omit<LogEntry, "id">) => {
    setLog((prev) => [...prev.slice(-80), { ...entry, id: ++logId }]);
  }, []);

  const currentPage: PageSpec | undefined = pages.find((p) => p.pageId === currentPageId);

  const refreshPages = useCallback(async () => {
    try {
      const res = await fetch("/api/pages");
      const data = await res.json();
      setPages(data.pages ?? []);
    } catch { /* offline */ }
  }, []);

  useEffect(() => { refreshPages(); }, [refreshPages]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [log]);

  // ---- utterance pipeline: straight to Jev, then back to listening ----
  const sendUtterance = useCallback(async (utterance: string, pageId?: string) => {
    const targetPage = pageId ?? currentPageIdRef.current;
    const t0 = performance.now();
    pushLog({ kind: "utterance", text: utterance });
    setBusy(true);
    try {
      const res = await fetch("/api/jev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance, pageId: targetPage }),
      });
      const data = await res.json();
      const ms = Math.round(performance.now() - t0);
      if (!res.ok) throw new Error(data.error || "Jev request failed");
      if (data.pageSwitch) {
        setCurrentPageId(data.pageSwitch);
        currentPageIdRef.current = data.pageSwitch;
      }
      await refreshPages();
      pushLog({ kind: "decisions", text: "Jev evaluations", decisions: data.decisions, ms, candidates: data.candidates });
      pushLog({ kind: data.changed ? "note" : "system", text: data.note });
    } catch (err) {
      pushLog({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }, [pushLog, refreshPages]);

  const currentPageIdRef = useRef(currentPageId);
  useEffect(() => { currentPageIdRef.current = currentPageId; }, [currentPageId]);
  const sendRef = useRef(sendUtterance);
  useEffect(() => { sendRef.current = sendUtterance; }, [sendUtterance]);

  // ---- live mic loop ----
  const startMic = useCallback(() => {
    const SR = (window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any });
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition;
    if (!Ctor) {
      pushLog({ kind: "error", text: "This browser has no SpeechRecognition API — use the text box or demo script." });
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        void sendRef.current(finalText.trim());
      }
    };
    rec.onend = () => {
      // Loop back to listening — utterances keep flowing to Jev.
      if (armedRef.current) {
        try { startMic(); } catch { /* retry next toggle */ }
      } else {
        setListening(false);
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        pushLog({ kind: "error", text: "Microphone blocked — allow mic access and try again." });
        armedRef.current = false;
        setListening(false);
      }
    };
    try {
      rec.start();
      setListening(true);
    } catch { /* already started */ }
  }, [pushLog]);

  const toggleMic = () => {
    if (armedRef.current) {
      armedRef.current = false;
      try { recRef.current?.stop(); } catch { /* noop */ }
      setListening(false);
      setInterim("");
    } else {
      armedRef.current = true;
      pushLog({ kind: "system", text: "Listening — talk to build. Each utterance goes straight to Jev." });
      startMic();
    }
  };

  // ---- demo script player ----
  const playDemo = async () => {
    if (playRef.current) { playRef.current = false; setPlaying(false); return; }
    playRef.current = true;
    setPlaying(true);
    pushLog({ kind: "system", text: `Playing ${DEMO_SCRIPT.length} scripted utterances through the live Jev path…` });
    for (const step of DEMO_SCRIPT) {
      if (!playRef.current) break;
      setCurrentPageId(step.pageId);
      currentPageIdRef.current = step.pageId;
      await sendRef.current(step.utterance, step.pageId);
      await new Promise((r) => setTimeout(r, 900));
    }
    playRef.current = false;
    setPlaying(false);
    pushLog({ kind: "system", text: "Demo script finished." });
  };

  const resetDemo = async () => {
    await fetch("/api/pages", { method: "DELETE" });
    setPages([]);
    pushLog({ kind: "system", text: "Cleared all page specs." });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0b0e14", color: "#e6e9ef" }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", borderBottom: "1px solid #232a36" }}>
        <strong>Voice planner</strong>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={playDemo} disabled={busy && !playing} style={btnStyle()}>
            {playing ? "Stop demo" : "Play demo script"}
          </button>
          <button onClick={resetDemo} style={btnStyle()}>Reset</button>
          <button onClick={toggleMic}
            style={{ ...btnStyle(), background: listening ? "#c0392b" : "#1f6feb", borderColor: listening ? "#c0392b" : "#1f6feb", color: "#fff" }}>
            {listening ? "● Stop mic" : "◉ Talk to build"}
          </button>
        </div>
      </div>

      {/* page tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid #232a36", flexWrap: "wrap" }}>
        {pages.map((p) => (
          <button key={p.pageId} onClick={() => setCurrentPageId(p.pageId)} style={tabStyle(p.pageId === currentPageId)}>
            /{p.pageId} <span style={{ opacity: 0.6 }}>({p.nodes.length})</span>
          </button>
        ))}
        {interim && <span style={{ color: "#8b98ad", fontStyle: "italic" }}>hearing: “{interim}”</span>}
        {busy && <span style={{ color: "#8b98ad" }}>asking Jev…</span>}
      </div>

      {/* main split */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* canvas */}
        <div style={{ flex: 2, overflowY: "auto", background: "#fff", color: "#1b1b1b" }}>
          {currentPage ? (
            <SpecCanvas page={currentPage} />
          ) : (
            <div style={{ padding: 48, color: "#555" }}>
              <h2>No page yet</h2>
              <p>Press “Talk to build” and describe the page, or play the demo script.</p>
            </div>
          )}
        </div>
        {/* transcript / evaluation log */}
        <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "12px 16px", borderLeft: "1px solid #232a36", fontSize: 13, fontFamily: "ui-monospace, monospace" }}>
          {log.length === 0 && <div style={{ color: "#5b6b82" }}>Transcript and Jev evaluations appear here…</div>}
          {log.map((e) => (
            <div key={e.id} style={{ marginBottom: 12 }}>
              {e.kind === "utterance" && <div style={{ color: "#7dd3fc" }}>“{e.text}”</div>}
              {e.kind === "decisions" && (
                <div style={{ color: "#9fb3c8" }}>
                  <div style={{ color: "#5b6b82" }}>jev · {e.ms}ms round trip</div>
                  {(e.decisions ?? []).map((d) => (
                    <div key={d.question}>
                      <span style={{ color: "#5b6b82" }}>{QUESTION_LABELS[d.question] ?? d.question}:</span>{" "}
                      {d.label.length > 60 ? d.label.slice(0, 60) + "…" : d.label}
                      {d.confidence != null && <span style={{ color: "#5b6b82" }}> ({d.confidence.toFixed(2)})</span>}
                    </div>
                  ))}
                  {(e.candidates?.length ?? 0) > 0 && (
                    <div style={{ color: "#5b6b82", marginTop: 2 }}>
                      considered:{" "}
                      {(e.candidates ?? []).map((c, i) => {
                        const winner = (e.decisions ?? []).find((d) => d.question === "component")?.label === c;
                        return (
                          <span key={c}>
                            {i > 0 && " · "}
                            <span style={winner ? { color: "#e6e9ef", fontWeight: 700 } : undefined}>{c}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
              {e.kind === "note" && <div style={{ color: "#86efac" }}>✓ {e.text}</div>}
              {e.kind === "system" && <div style={{ color: "#5b6b82" }}>— {e.text}</div>}
              {e.kind === "error" && <div style={{ color: "#f87171" }}>✕ {e.text}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* bottom input */}
      <div style={{ display: "flex", gap: 8, padding: "10px 16px", borderTop: "1px solid #232a36" }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && typed.trim()) { void sendUtterance(typed.trim()); setTyped(""); } }}
          placeholder='Type an instruction instead — e.g. add a hero with the heading "Hello"'
          style={{ flex: 1, background: "#131822", color: "#e6e9ef", border: "1px solid #2c3547", borderRadius: 6, padding: "8px 12px" }} />
        <button onClick={() => { if (typed.trim()) { void sendUtterance(typed.trim()); setTyped(""); } }} style={btnStyle()}>Send</button>
      </div>
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#1c2534" : "transparent",
    color: active ? "#e6e9ef" : "#8b98ad",
    border: "1px solid #2c3547",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: 13,
  };
}

function btnStyle(): React.CSSProperties {
  return {
    background: "#1c2534",
    color: "#e6e9ef",
    border: "1px solid #2c3547",
    borderRadius: 6,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
  };
}
