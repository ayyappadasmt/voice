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

type Lead = {
  id: string;
  name: string;
  title: string;
  company: string;
  industry: string;
  location: string;
  email: string;
  linkedin: string;
  score: number;
  created_at: string;
};

type Campaign = {
  id: string;
  name: string;
  channel: string;
  status: string;
  audience: string;
  message: string;
  daily_limit: number;
  target_count: number;
  sent: number;
  accepted: number;
  replied: number;
  created_at: string;
};

type KnowledgeChunk = {
  id: string;
  title: string;
  content: string;
  category: string;
  created_at: string;
  updated_at: string;
};

type TwilioStatus = {
  is_configured: boolean;
  phone_number: string;
  webhook_url: string;
  validate_signature: boolean;
};

type Phase = "idle" | "connecting" | "live" | "ended";

function resolveWsUrl(): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:8000/ws/voice";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.hostname}:8000/ws/voice`;
}

function resolveHttpUrl(path: string): string {
  const wsUrl = resolveWsUrl();
  const httpUrl = wsUrl.replace(/^ws/, "http").replace("/ws/voice", "");
  return `${httpUrl}${path}`;
}

const PROMPTS = [
  "Find 100 qualified leads in Kerala and start a LinkedIn campaign.",
  "Source 50 FinTech founders in Kochi.",
  "How is my campaign performing?",
];

type Tab = "console" | "leads" | "campaigns" | "knowledge" | "twilio";

export default function VoiceConsole() {
  const [activeTab, setActiveTab] = useState<Tab>("console");
  const [phase, setPhase] = useState<Phase>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Data stores
  const [leads, setLeads] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [knowledgeChunks, setKnowledgeChunks] = useState<KnowledgeChunk[]>([]);
  const [twilioStatus, setTwilioStatus] = useState<TwilioStatus | null>(null);

  // Knowledge auth and form state
  const [staffKey, setStaffKey] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [editingChunk, setEditingChunk] = useState<Partial<KnowledgeChunk> | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualContent, setManualContent] = useState("");
  const [manualCategory, setManualCategory] = useState("general");

  // Drag & drop state
  const [isDragging, setIsDragging] = useState(false);

  // UI filters & search
  const [leadSearch, setLeadSearch] = useState("");
  const [leadIndustryFilter, setLeadIndustryFilter] = useState("All");

  // Notifications (toast)
  const [toast, setToast] = useState<{ message: string; type: "ok" | "err" } | null>(null);

  const clientRef = useRef<VoiceClient | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const activityId = useRef(0);

  const triggerToast = (message: string, type: "ok" | "err" = "ok") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  // Fetch functions
  const fetchLeads = useCallback(async () => {
    try {
      const res = await fetch(resolveHttpUrl("/agent/leads"));
      if (res.ok) {
        const data = await res.json();
        setLeads(data);
      }
    } catch (err) {
      console.error("Error fetching leads:", err);
    }
  }, []);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(resolveHttpUrl("/agent/campaigns"));
      if (res.ok) {
        const data = await res.json();
        setCampaigns(data);
      }
    } catch (err) {
      console.error("Error fetching campaigns:", err);
    }
  }, []);

  const fetchTwilioStatus = useCallback(async () => {
    try {
      const res = await fetch(resolveHttpUrl("/agent/twilio-status"));
      if (res.ok) {
        const data = await res.json();
        setTwilioStatus(data);
      }
    } catch (err) {
      console.error("Error fetching Twilio status:", err);
    }
  }, []);

  const fetchKnowledge = useCallback(async (keyToUse = staffKey) => {
    try {
      const res = await fetch(resolveHttpUrl("/knowledge/"), {
        headers: { "X-API-Key": keyToUse },
      });
      if (res.ok) {
        const data = await res.json();
        setKnowledgeChunks(data);
        setIsUnlocked(true);
      } else if (res.status === 401 || res.status === 403) {
        setIsUnlocked(false);
        sessionStorage.removeItem("voiceai_staff_key");
      }
    } catch (err) {
      console.error("Error fetching knowledge base:", err);
    }
  }, [staffKey]);

  // Auth unlock
  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffKey.trim()) return;
    try {
      const res = await fetch(resolveHttpUrl("/knowledge/verify"), {
        headers: { "X-API-Key": staffKey },
      });
      if (res.ok) {
        sessionStorage.setItem("voiceai_staff_key", staffKey);
        setIsUnlocked(true);
        fetchKnowledge(staffKey);
        triggerToast("Dashboard unlocked successfully!", "ok");
      } else {
        triggerToast("Invalid Staff API Key", "err");
      }
    } catch (err) {
      triggerToast("Verification failed", "err");
    }
  };

  const handleLock = () => {
    setStaffKey("");
    setIsUnlocked(false);
    sessionStorage.removeItem("voiceai_staff_key");
    setKnowledgeChunks([]);
    triggerToast("Locked.", "ok");
  };

  // Delete Knowledge Chunk
  const handleDeleteChunk = async (id: string) => {
    if (!confirm("Are you sure you want to delete this company knowledge entry?")) return;
    try {
      const res = await fetch(resolveHttpUrl(`/knowledge/${id}`), {
        method: "DELETE",
        headers: { "X-API-Key": sessionStorage.getItem("voiceai_staff_key") || staffKey },
      });
      if (res.ok) {
        triggerToast("Knowledge entry deleted", "ok");
        fetchKnowledge();
      } else {
        triggerToast("Failed to delete entry", "err");
      }
    } catch (err) {
      triggerToast("Failed to delete", "err");
    }
  };

  // Save Knowledge (manual add/edit)
  const handleSaveKnowledge = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = editingChunk ? editingChunk.title : manualTitle;
    const content = editingChunk ? editingChunk.content : manualContent;
    const category = editingChunk ? editingChunk.category : manualCategory;

    if (!title || !content) {
      triggerToast("Title and Content are required", "err");
      return;
    }

    const payload = { title, content, category };
    const method = editingChunk?.id ? "PUT" : "POST";
    const path = editingChunk?.id ? `/knowledge/${editingChunk.id}` : "/knowledge/";

    try {
      const res = await fetch(resolveHttpUrl(path), {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": sessionStorage.getItem("voiceai_staff_key") || staffKey,
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        triggerToast(editingChunk?.id ? "Knowledge updated" : "Knowledge added", "ok");
        setEditingChunk(null);
        setManualTitle("");
        setManualContent("");
        setManualCategory("general");
        fetchKnowledge();
      } else {
        triggerToast("Failed to save entry", "err");
      }
    } catch (err) {
      triggerToast("Network error saving knowledge", "err");
    }
  };

  // Drag & drop file upload parser
  const uploadChunk = async (title: string, content: string, category = "uploaded") => {
    try {
      const res = await fetch(resolveHttpUrl("/knowledge/"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": sessionStorage.getItem("voiceai_staff_key") || staffKey,
        },
        body: JSON.stringify({ title, content, category }),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!isUnlocked) {
      triggerToast("Unlock the Admin Panel first!", "err");
      return;
    }

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    let successCount = 0;
    let failCount = 0;

    for (const file of files) {
      const isTxt = file.name.endsWith(".txt");
      const isJson = file.name.endsWith(".json");

      if (!isTxt && !isJson) {
        triggerToast(`Skipping ${file.name}: only .txt and .json files supported.`, "err");
        failCount++;
        continue;
      }

      const reader = new FileReader();
      const filePromise = new Promise<void>((resolve) => {
        reader.onload = async (event) => {
          const text = event.target?.result as string;
          if (!text) {
            resolve();
            return;
          }

          if (isTxt) {
            const title = file.name.replace(/\.txt$/, "");
            const ok = await uploadChunk(title, text, "text-upload");
            if (ok) successCount++;
            else failCount++;
          } else if (isJson) {
            try {
              const data = JSON.parse(text);
              if (Array.isArray(data)) {
                let listSuccess = 0;
                for (let i = 0; i < data.length; i++) {
                  const item = data[i];
                  if (item.title && item.content) {
                    const ok = await uploadChunk(item.title, item.content, item.category || "json-list-upload");
                    if (ok) listSuccess++;
                  }
                }
                if (listSuccess > 0) {
                  triggerToast(`Uploaded ${listSuccess} entries from ${file.name}`);
                  successCount++;
                } else {
                  failCount++;
                }
              } else if (data.title && data.content) {
                const ok = await uploadChunk(data.title, data.content, data.category || "json-upload");
                if (ok) successCount++;
                else failCount++;
              } else {
                // Upload raw formatted JSON
                const title = file.name.replace(/\.json$/, "");
                const ok = await uploadChunk(title, JSON.stringify(data, null, 2), "json-raw");
                if (ok) successCount++;
                else failCount++;
              }
            } catch (err) {
              triggerToast(`Invalid JSON in ${file.name}`, "err");
              failCount++;
            }
          }
          resolve();
        };
        reader.readAsText(file);
      });

      await filePromise;
    }

    if (successCount > 0) {
      triggerToast(`Successfully processed file uploads`, "ok");
      fetchKnowledge();
    }
  };

  // Initial and background polling configuration
  useEffect(() => {
    // Auto load key if present
    const savedKey = sessionStorage.getItem("voiceai_staff_key");
    if (savedKey) {
      setStaffKey(savedKey);
      setIsUnlocked(true);
      fetchKnowledge(savedKey);
    }

    // Initial load
    fetchLeads();
    fetchCampaigns();
    fetchTwilioStatus();

    // Poll leads & campaigns dynamically
    const interval = setInterval(() => {
      fetchLeads();
      fetchCampaigns();
    }, 4000);

    return () => clearInterval(interval);
  }, [fetchLeads, fetchCampaigns, fetchTwilioStatus, fetchKnowledge]);

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
          // Immediately fetch leads/campaigns when tool finishes
          fetchLeads();
          fetchCampaigns();
          break;
        }
        case "error":
          setError(e.message);
          break;
        default:
          break;
      }
    },
    [appendTranscript, fetchLeads, fetchCampaigns]
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

  // Leads filters logic
  const filteredLeads = leads.filter((l) => {
    const matchesSearch =
      l.name.toLowerCase().includes(leadSearch.toLowerCase()) ||
      l.company.toLowerCase().includes(leadSearch.toLowerCase()) ||
      l.title.toLowerCase().includes(leadSearch.toLowerCase()) ||
      l.location.toLowerCase().includes(leadSearch.toLowerCase());

    if (leadIndustryFilter === "All") return matchesSearch;
    return matchesSearch && l.industry.toLowerCase() === leadIndustryFilter.toLowerCase();
  });

  const industries = Array.from(new Set(leads.map((l) => l.industry)));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border px-4 py-3 shadow-xl transition-all duration-300 ${
            toast.type === "ok"
              ? "border-emerald-500/40 bg-panel text-emerald-400"
              : "border-red-500/40 bg-panel text-red-400"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${toast.type === "ok" ? "bg-emerald-400" : "bg-red-400"}`} />
          <p className="text-sm font-medium">{toast.message}</p>
        </div>
      )}

      {/* Main Header */}
      <header className="flex flex-col items-center justify-between gap-4 border-b border-white/5 pb-6 md:flex-row md:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-accent">
            Voice Agentic Platform
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-100 sm:text-3xl">
            Lead Generation Console
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Autonomous Lead Generation Voice Assistant. Talk to act, manage company knowledge, and track campaigns in real time.
          </p>
        </div>

        {/* Tab Navigation */}
        <nav className="flex rounded-xl bg-panel/50 p-1 border border-white/5 shadow-inner">
          <button
            onClick={() => setActiveTab("console")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
              activeTab === "console"
                ? "bg-accent/20 text-white border border-accent/20 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Voice Orb
          </button>
          <button
            onClick={() => setActiveTab("leads")}
            className={`relative rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
              activeTab === "leads"
                ? "bg-accent/20 text-white border border-accent/20 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Leads
            {leads.length > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-ink">
                {leads.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("campaigns")}
            className={`relative rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
              activeTab === "campaigns"
                ? "bg-accent/20 text-white border border-accent/20 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Campaigns
            {campaigns.length > 0 && (
              <span className="absolute -top-1.5 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-400 px-1 text-[9px] font-bold text-ink">
                {campaigns.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("knowledge")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
              activeTab === "knowledge"
                ? "bg-accent/20 text-white border border-accent/20 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Knowledge Base
          </button>
          <button
            onClick={() => setActiveTab("twilio")}
            className={`rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition-all ${
              activeTab === "twilio"
                ? "bg-accent/20 text-white border border-accent/20 shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Twilio Phone
          </button>
        </nav>
      </header>

      {/* ───────────────── TAB: CONSOLE ───────────────── */}
      {activeTab === "console" && (
        <div className="flex flex-col items-center gap-8 py-4">
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

          <div className="h-6 text-sm font-medium text-slate-400">
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
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
                Try saying:
              </span>
              <div className="flex flex-wrap justify-center gap-2">
                {PROMPTS.map((p) => (
                  <span
                    key={p}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:bg-white/10 cursor-default transition-all"
                  >
                    “{p}”
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Transcript + activity */}
          <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-2 mt-4">
            <section className="rounded-2xl border border-white/10 bg-panel/70 p-5 shadow-lg backdrop-blur-sm">
              <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                <h2 className="text-sm font-semibold text-slate-200">
                  Live Transcript
                </h2>
                {live && <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-ping" />}
              </div>
              <div className="flex max-h-80 min-h-[12rem] flex-col gap-3 overflow-y-auto pr-1">
                {messages.length === 0 && (
                  <p className="text-sm text-slate-500 my-auto text-center italic">
                    Your conversation will appear here.
                  </p>
                )}
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] rounded-xl px-3-5 py-2 text-sm leading-relaxed ${
                      m.role === "user"
                        ? "self-end bg-accent/20 text-slate-100 border border-accent/20 shadow-sm"
                        : "self-start bg-white/5 text-slate-200 border border-white/5"
                    }`}
                  >
                    {m.text}
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            </section>

            <section className="rounded-2xl border border-white/10 bg-panel/70 p-5 shadow-lg backdrop-blur-sm">
              <h2 className="mb-3 text-sm font-semibold text-slate-200 border-b border-white/5 pb-2">
                Agent Actions Log
              </h2>
              <div className="flex max-h-80 min-h-[12rem] flex-col gap-3 overflow-y-auto pr-1">
                {activity.length === 0 && (
                  <p className="text-sm text-slate-500 my-auto text-center italic">
                    Spoken agent tools will execute in real time.
                  </p>
                )}
                {activity.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-xl border border-white/5 bg-white/5 px-3 py-2 transition-all hover:bg-white/10"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <StatusDot status={a.status} />
                        <span className="font-mono text-xs font-semibold text-accent">{a.name}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">id: #{a.id}</span>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-300 leading-normal">{a.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ───────────────── TAB: LEADS ───────────────── */}
      {activeTab === "leads" && (
        <section className="rounded-2xl border border-white/10 bg-panel/70 p-6 shadow-xl backdrop-blur-sm">
          <div className="flex flex-col justify-between gap-4 border-b border-white/5 pb-4 sm:flex-row sm:items-center">
            <h2 className="text-lg font-bold text-slate-200">Sourced Sales Leads</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="Search leads, company, role..."
                className="w-56 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <select
                value={leadIndustryFilter}
                onChange={(e) => setLeadIndustryFilter(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="All" className="bg-panel">All Industries</option>
                {industries.map((ind) => (
                  <option key={ind} value={ind} className="bg-panel">
                    {ind}
                  </option>
                ))}
              </select>
              <button
                onClick={fetchLeads}
                className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 transition-all"
              >
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            {filteredLeads.length === 0 ? (
              <div className="py-12 text-center text-slate-500 italic text-sm">
                {leads.length === 0
                  ? "No leads have been sourced yet. Tell the agent: 'Find 50 sales leads in Kochi'."
                  : "No leads matched your filters."}
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-3 px-2">Name / Title</th>
                    <th className="py-3 px-2">Company</th>
                    <th className="py-3 px-2">Industry</th>
                    <th className="py-3 px-2">Location</th>
                    <th className="py-3 px-2">Match Score</th>
                    <th className="py-3 px-2">Outreach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-xs">
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id} className="hover:bg-white/5 transition-all">
                      <td className="py-3 px-2">
                        <div className="font-semibold text-slate-200">{lead.name}</div>
                        <div className="text-slate-400 text-[10px] mt-0.5">{lead.title}</div>
                      </td>
                      <td className="py-3 px-2 text-slate-300 font-medium">{lead.company}</td>
                      <td className="py-3 px-2">
                        <span className="rounded-full bg-accent/10 border border-accent/20 px-2 py-0.5 text-[10px] text-accent">
                          {lead.industry}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-slate-400">{lead.location}</td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 rounded-full bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                              style={{ width: `${lead.score}%` }}
                            />
                          </div>
                          <span className="font-bold font-mono text-[11px] text-emerald-400">{lead.score}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <a
                            href={lead.linkedin}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[10px] text-accent hover:underline hover:text-white"
                          >
                            LinkedIn
                          </a>
                          <span className="text-slate-600">·</span>
                          <a
                            href={`mailto:${lead.email}`}
                            className="text-[10px] text-slate-400 hover:underline hover:text-white"
                          >
                            Email
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {/* ───────────────── TAB: CAMPAIGNS ───────────────── */}
      {activeTab === "campaigns" && (
        <section className="rounded-2xl border border-white/10 bg-panel/70 p-6 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <h2 className="text-lg font-bold text-slate-200">Outreach Campaigns</h2>
            <button
              onClick={fetchCampaigns}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 transition-all"
            >
              Refresh
            </button>
          </div>

          {campaigns.length === 0 ? (
            <div className="py-12 text-center text-slate-500 italic text-sm">
              No campaigns launched yet. Tell the agent: "Launch a LinkedIn outreach campaign to the leads."
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              {campaigns.map((camp) => {
                const percent = Math.min(100, Math.round((camp.sent / (camp.target_count || 1)) * 100));
                return (
                  <div
                    key={camp.id}
                    className="rounded-xl border border-white/5 bg-white/5 p-4 shadow-sm hover:border-white/10 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="font-semibold text-slate-200">{camp.name}</h3>
                        <p className="text-[10px] text-slate-400 mt-0.5">Audience: {camp.audience}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                          camp.status === "completed"
                            ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                            : "bg-amber-500/10 border border-amber-500/20 text-amber-400 animate-pulse"
                        }`}
                      >
                        {camp.status}
                      </span>
                    </div>

                    <div className="mt-4">
                      <div className="flex justify-between text-[10px] text-slate-400 font-mono mb-1">
                        <span>Campaign Progress</span>
                        <span>
                          {camp.sent} / {camp.target_count} ({percent}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full bg-accent transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center border-t border-white/5 pt-3">
                      <div className="rounded-lg bg-panel/30 py-1.5">
                        <div className="text-xs font-bold text-slate-200 font-mono">{camp.sent}</div>
                        <div className="text-[9px] text-slate-500 font-medium">Invites Sent</div>
                      </div>
                      <div className="rounded-lg bg-panel/30 py-1.5">
                        <div className="text-xs font-bold text-emerald-400 font-mono">{camp.accepted}</div>
                        <div className="text-[9px] text-slate-500 font-medium">Accepted</div>
                      </div>
                      <div className="rounded-lg bg-panel/30 py-1.5">
                        <div className="text-xs font-bold text-amber-400 font-mono">{camp.replied}</div>
                        <div className="text-[9px] text-slate-500 font-medium">Replies</div>
                      </div>
                    </div>

                    <div className="mt-3 bg-panel/20 rounded-lg p-2 border border-white/5">
                      <div className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider mb-0.5">
                        Template Message:
                      </div>
                      <p className="text-[10px] text-slate-300 italic leading-relaxed">
                        "{camp.message}"
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ───────────────── TAB: KNOWLEDGE ADMIN ───────────────── */}
      {activeTab === "knowledge" && (
        <section className="rounded-2xl border border-white/10 bg-panel/70 p-6 shadow-xl backdrop-blur-sm">
          {!isUnlocked ? (
            <div className="mx-auto max-w-sm py-12 text-center">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 border border-accent/20 text-accent">
                🔐
              </div>
              <h2 className="text-base font-bold text-slate-200">Knowledge Admin Verification</h2>
              <p className="mt-1.5 text-xs text-slate-400">
                Please unlock the knowledge manager with your staff API key.
              </p>
              <form onSubmit={handleUnlock} className="mt-4 flex flex-col gap-2">
                <input
                  type="password"
                  value={staffKey}
                  onChange={(e) => setStaffKey(e.target.value)}
                  placeholder="Enter staff API key"
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  type="submit"
                  className="rounded-lg bg-accent py-2 text-xs font-semibold text-ink hover:bg-accent/80 transition-all"
                >
                  Unlock Admin
                </button>
              </form>
              <p className="mt-3 text-[10px] text-slate-500 leading-normal">
                This authenticates knowledge upload and deletion requests. Default is typically 'changeme'.
              </p>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between border-b border-white/5 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-200">RAG Company Knowledge</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Manage files and text used by the phone voice agent to answer caller queries.
                  </p>
                </div>
                <button
                  onClick={handleLock}
                  className="rounded-lg border border-white/10 hover:border-red-500/30 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-400 transition-all"
                >
                  Lock Panel
                </button>
              </div>

              {/* Drag & Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`mt-6 border-2 border-dashed rounded-xl p-8 text-center transition-all ${
                  isDragging
                    ? "border-accent bg-accent/10 scale-[1.01]"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                <div className="text-2xl mb-2">📁</div>
                <h3 className="text-xs font-bold text-slate-200">Drag & Drop Company Files</h3>
                <p className="text-[10px] text-slate-400 mt-1">
                  Supports plain text (.txt) and JSON (.json) documents.
                </p>
                <p className="text-[9px] text-slate-500 mt-1 italic">
                  Files will be auto-processed and chunked into the database.
                </p>
              </div>

              {/* Add / Edit Form */}
              <form onSubmit={handleSaveKnowledge} className="mt-6 rounded-xl border border-white/5 bg-white/5 p-4">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
                  {editingChunk ? "Edit Knowledge Entry" : "Add Knowledge Manually"}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400">Title</label>
                    <input
                      type="text"
                      value={editingChunk ? (editingChunk.title || "") : manualTitle}
                      onChange={(e) =>
                        editingChunk
                          ? setEditingChunk({ ...editingChunk, title: e.target.value })
                          : setManualTitle(e.target.value)
                      }
                      placeholder="e.g. Refund Policy or Pricing Structure"
                      className="rounded-lg border border-white/10 bg-panel px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-400">Category</label>
                    <input
                      type="text"
                      value={editingChunk ? (editingChunk.category || "") : manualCategory}
                      onChange={(e) =>
                        editingChunk
                          ? setEditingChunk({ ...editingChunk, category: e.target.value })
                          : setManualCategory(e.target.value)
                      }
                      placeholder="e.g. support, pricing, general"
                      className="rounded-lg border border-white/10 bg-panel px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-slate-400">Content</label>
                  <textarea
                    value={editingChunk ? (editingChunk.content || "") : manualContent}
                    onChange={(e) =>
                      editingChunk
                        ? setEditingChunk({ ...editingChunk, content: e.target.value })
                        : setManualContent(e.target.value)
                    }
                    placeholder="Enter the raw details the AI agent needs to learn..."
                    rows={4}
                    className="rounded-lg border border-white/10 bg-panel px-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
                  />
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {editingChunk && (
                    <button
                      type="button"
                      onClick={() => setEditingChunk(null)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 hover:text-white"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    className="rounded-lg bg-accent px-4 py-1.5 text-xs font-semibold text-ink hover:bg-accent/80 transition-all"
                  >
                    {editingChunk ? "Update Chunk" : "Add Entry"}
                  </button>
                </div>
              </form>

              {/* Chunk list */}
              <div className="mt-6 border-t border-white/5 pt-6">
                <h3 className="text-xs font-bold text-slate-200 mb-3">Database Chunks ({knowledgeChunks.length})</h3>
                {knowledgeChunks.length === 0 ? (
                  <p className="text-center text-xs text-slate-500 italic py-6">
                    No company files loaded. Drag a txt file or use the form above to train the agent.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3 max-h-96 overflow-y-auto pr-1">
                    {knowledgeChunks.map((c) => (
                      <div
                        key={c.id}
                        className="rounded-lg border border-white/5 bg-white/5 p-4 flex flex-col justify-between sm:flex-row gap-4"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-slate-200">{c.title}</span>
                            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[9px] text-accent border border-accent/10">
                              {c.category || "general"}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-slate-400 leading-normal line-clamp-3 whitespace-pre-line">
                            {c.content}
                          </p>
                          <div className="mt-2 text-[9px] text-slate-500 font-mono">
                            Updated: {new Date(c.updated_at).toLocaleString()}
                          </div>
                        </div>
                        <div className="flex items-start gap-1">
                          <button
                            onClick={() => setEditingChunk(c)}
                            className="rounded-lg border border-white/10 hover:border-accent/40 px-2.5 py-1 text-[10px] text-slate-400 hover:text-accent"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteChunk(c.id)}
                            className="rounded-lg border border-white/10 hover:border-red-500/40 px-2.5 py-1 text-[10px] text-slate-400 hover:text-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ───────────────── TAB: TWILIO STATUS ───────────────── */}
      {activeTab === "twilio" && (
        <section className="rounded-2xl border border-white/10 bg-panel/70 p-6 shadow-xl backdrop-blur-sm">
          <div className="flex items-center justify-between border-b border-white/5 pb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-200">Twilio Phone Channel</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Monitor and configure the inbound voice channel (Twilio V2V stream).
              </p>
            </div>
            <button
              onClick={fetchTwilioStatus}
              className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25 transition-all"
            >
              Refresh Status
            </button>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="md:col-span-2 flex flex-col gap-4">
              {/* Main status indicator */}
              <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-4">
                  Active Configuration
                </h3>
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 border border-accent/25 text-xl">
                    📞
                  </div>
                  <div>
                    <div className="text-slate-400 text-[10px]">Twilio Phone Number</div>
                    <div className="text-lg font-mono font-bold text-slate-100 mt-0.5">
                      {twilioStatus?.phone_number && twilioStatus.phone_number !== "Not configured"
                        ? twilioStatus.phone_number
                        : "+1 (888) 123-4567"}
                    </div>
                  </div>
                  <div className="ml-auto">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                        twilioStatus?.is_configured
                          ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                          : "bg-red-500/10 border border-red-500/20 text-red-400"
                      }`}
                    >
                      {twilioStatus?.is_configured ? "Connected" : "Inactive"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Webhook block */}
              <div className="rounded-xl border border-white/5 bg-white/5 p-5">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2">
                  Twilio Webhook Link
                </h3>
                <p className="text-[10px] text-slate-400 mb-3">
                  Configure this exact URL as the HTTP POST webhook in your Twilio Console for Incoming Voice Calls.
                </p>
                <div className="flex items-center gap-2 rounded-lg bg-panel border border-white/10 px-3 py-2 select-all">
                  <span className="font-mono text-xs text-slate-300 break-all flex-1">
                    {twilioStatus?.webhook_url || "http://localhost:8000/voice-webhook"}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        twilioStatus?.webhook_url || "http://localhost:8000/voice-webhook"
                      );
                      triggerToast("Webhook URL copied to clipboard!");
                    }}
                    className="text-[10px] text-accent hover:underline ml-2"
                  >
                    Copy
                  </button>
                </div>
              </div>
            </div>

            {/* Checklists */}
            <div className="rounded-xl border border-white/5 bg-white/5 p-5">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3">
                Setup Validation Checks
              </h3>
              <ul className="flex flex-col gap-3 text-xs">
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckIcon active={!!twilioStatus?.is_configured} />
                  <span>Twilio Credentials Configured</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckIcon active={!!twilioStatus?.is_configured} />
                  <span>Valid Phone Number Set</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckIcon active={!!(twilioStatus?.webhook_url && !twilioStatus.webhook_url.includes("localhost"))} />
                  <span>Public App Domain Enabled</span>
                </li>
                <li className="flex items-center gap-2 text-slate-300">
                  <CheckIcon active={!!twilioStatus?.validate_signature} />
                  <span>Signature Validation: {twilioStatus?.validate_signature ? "ON" : "OFF"}</span>
                </li>
              </ul>
              <div className="mt-4 border-t border-white/5 pt-3">
                <p className="text-[10px] text-slate-500 leading-relaxed font-medium">
                  Note: Inbound voice calls stream caller speech to the RAG system using Gemini Live, providing direct voice replies about the company base.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}
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

function CheckIcon({ active }: { active: boolean }) {
  return active ? (
    <span className="text-emerald-400 font-bold">✓</span>
  ) : (
    <span className="text-red-500 font-bold">✗</span>
  );
}

