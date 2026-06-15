"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceClient, type AgentEvent } from "@/lib/voiceClient";

type Message = { role: "user" | "assistant"; text: string };
type Activity = {
  id: number;
  name: string;
  status: "running" | "done" | "error";
  detail: string;
};

type Phase = "idle" | "connecting" | "live" | "ended";

function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:8000/ws/voice";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8000/ws/voice`;
}

const PROMPTS = [
  "Find 100 qualified leads in Kerala and start a LinkedIn campaign.",
  "Source 50 FinTech founders in Kochi.",
  "How is my campaign performing?",
];

export default function VoiceConsole() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const activityId = useRef(0);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const appendTranscript = useCallback((role: Message["role"], text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        const copy = prev.slice(0, -1);
        return [...copy, { role, text: last.text + text }];
      }
      return [...prev, { role, text }];
    });
  }, []);

  const handleEvent = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case "transcript":
          appendTranscript(e.role, e.text);
          break;
        case "tool_call": {
          const id = ++activityId.current;
          setActivity((prev) => [
            {
              id,
              name: e.name,
              status: "running",
              detail: `Executing ${e.name}…`,
            },
            ...prev,
          ]);
          break;
        }
        case "tool_result": {
          const summary =
            (e.result?.summary as string) ??
            (e.result?.status === "error" ? "Failed." : "Done.");
          const ok = e.result?.status !== "error";
          setActivity((prev) => {
            const idx = prev.findIndex(
              (a) => a.name === e.name && a.status === "running"
            );
            if (idx === -1) return prev;
            const copy = [...prev];
            copy[idx] = {
              ...copy[idx],
              status: ok ? "done" : "error",
              detail: summary,
            };
            return copy;
          });
          break;
        }
        case "error":
          setError(e.message);
          break;
        default:
          break;
      }
    },
    [appendTranscript]
  );

  const start = useCallback(async () => {
    setError(null);
    setPhase("connecting");
    const client = new VoiceClient(resolveWsUrl(), {
      onEvent: handleEvent,
      onOpen: () => setPhase("live"),
      onClose: () => setPhase((p) => (p === "live" ? "ended" : p)),
      onLevel: (lvl) => setLevel(lvl),
    });
    clientRef.current = client;
    try {
      await client.start();
    } catch (err: any) {
      setError(err?.message || "Could not access microphone.");
      setPhase("idle");
    }
  }, [handleEvent]);

  const stop = useCallback(async () => {
    await clientRef.current?.stop();
    clientRef.current = null;
    setPhase("ended");
    setLevel(0);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.stop();
    };
  }, []);

  const live = phase === "live";
  const ring = Math.min(1.6, 1 + level * 6);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-10 px-6 py-14">
      <header className="text-center">
        <p className="mb-2 text-xs uppercase tracking-[0.3em] text-accent/80">
          Autonomous Voice Agent
        </p>
        <h1 className="text-3xl font-semibold sm:text-4xl">
          No dashboards. No forms. Just speech.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-slate-400">
          Speak naturally and the system executes for you — sourcing leads,
          launching campaigns, and reporting back in real time.
        </p>
      </header>

      {/* Mic orb */}
      <div className="relative flex h-52 w-52 items-center justify-center">
        {live && (
          <span
            className="absolute inset-0 rounded-full bg-accent/30 animate-pulseRing"
            aria-hidden
          />
        )}
        <button
          onClick={live || phase === "connecting" ? stop : start}
          disabled={phase === "connecting"}
          className="relative flex h-40 w-40 items-center justify-center rounded-full bg-gradient-to-br from-accent to-indigo-600 text-white shadow-2xl shadow-accent/30 transition active:scale-95 disabled:opacity-70"
          style={{ transform: live ? `scale(${ring})` : undefined }}
          aria-label={live ? "Stop conversation" : "Start conversation"}
        >
          <span className="text-center">
            {phase === "connecting" ? (
              <span className="text-sm">Connecting…</span>
            ) : live ? (
              <MicIcon active />
            ) : (
              <MicIcon />
            )}
          </span>
        </button>
      </div>

      <div className="h-6 text-sm text-slate-400">
        {phase === "idle" && "Tap the orb and start talking."}
        {phase === "connecting" && "Setting up your live session…"}
        {live && "Listening — speak naturally. Tap again to end."}
        {phase === "ended" && "Session ended. Tap to start again."}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Example prompts */}
      {phase !== "live" && (
        <div className="flex flex-wrap justify-center gap-2">
          {PROMPTS.map((p) => (
            <span
              key={p}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300"
            >
              “{p}”
            </span>
          ))}
        </div>
      )}

      {/* Transcript + activity */}
      <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-panel/70 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            Conversation
          </h2>
          <div className="flex max-h-80 min-h-[8rem] flex-col gap-3 overflow-y-auto pr-1">
            {messages.length === 0 && (
              <p className="text-sm text-slate-500">
                Your live transcript will appear here.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "self-end bg-accent/20 text-slate-100"
                    : "self-start bg-white/5 text-slate-200"
                }`}
              >
                {m.text}
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-panel/70 p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-300">
            Agent activity
          </h2>
          <div className="flex max-h-80 min-h-[8rem] flex-col gap-3 overflow-y-auto pr-1">
            {activity.length === 0 && (
              <p className="text-sm text-slate-500">
                Actions the agent takes will show up here.
              </p>
            )}
            {activity.map((a) => (
              <div
                key={a.id}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <StatusDot status={a.status} />
                  <span className="font-mono text-xs text-accent">{a.name}</span>
                </div>
                <p className="mt-1 text-sm text-slate-300">{a.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: Activity["status"] }) {
  const color =
    status === "running"
      ? "bg-amber-400 animate-pulse"
      : status === "done"
      ? "bg-emerald-400"
      : "bg-red-400";
  return <span className={`h-2.5 w-2.5 rounded-full ${color}`} />;
}

function MicIcon({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? "animate-floaty" : ""}
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}
