"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Menu, Plus, Send, Square, Settings, ChevronDown, ChevronRight,
  GitBranch, Loader2, MessageSquare, X, Activity, CheckCircle2,
  XCircle, AlertCircle, FileCode, Terminal, Brain, Trash2,
} from "lucide-react";
import type {
  ActivityEvent, AppSettings, ChatMessage, CompletionReport,
  ConversationMeta, ExecutionMode, GitHubRepo, ProjectMemory, TaskRecord,
} from "@/lib/types";
import {
  listConversations, saveConversation, getMessages, saveMessage, updateMessage,
  getSetting, setSetting, saveTask, updateTask, listActiveTasks,
  getProjectMemory, saveProjectMemory, clearProjectMemory,
} from "@/lib/db";
import { cn, formatRelativeTime } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

function uid() { return crypto.randomUUID(); }
const POLL_NORMAL = 4000;
const POLL_SAVER = 12000;

export default function WorkspacePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ExecutionMode>("implement");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [repoOpen, setRepoOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [liveActivity, setLiveActivity] = useState<ActivityEvent[]>([]);
  const [dataSaver, setDataSaver] = useState(false);
  const [projectMem, setProjectMem] = useState<ProjectMemory | null>(null);
  const [showMemory, setShowMemory] = useState(false);
  const [expandedLogs, setExpandedLogs] = useState<Record<string, boolean>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activityCountRef = useRef(0);
  const activePollId = useRef<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/status").then((r) => r.json()).then((d) => {
      if (!d.gemini || !d.github) router.replace("/setup");
      else setReady(true);
    }).catch(() => router.replace("/setup"));
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    listConversations().then(setConversations);
    getSetting<AppSettings>("appSettings", { dataSaver: false }).then((s) => setDataSaver(!!s.dataSaver));
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const cached = sessionStorage.getItem("pf_repos");
    if (cached) { try { setRepos(JSON.parse(cached)); return; } catch { /* */ } }
    fetch("/api/github/repos").then((r) => r.json()).then((d) => {
      if (d.repos) {
        setRepos(d.repos);
        try { sessionStorage.setItem("pf_repos", JSON.stringify(d.repos)); } catch { /* */ }
      }
    }).catch(console.error);
  }, [ready]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    getMessages(activeId).then(setMessages);
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: dataSaver ? "auto" : "smooth" });
  }, [messages, statusText, liveActivity, dataSaver]);

  useEffect(() => {
    if (!selectedRepo) { setProjectMem(null); return; }
    getProjectMemory(selectedRepo.full_name).then((m) => setProjectMem(m ?? null));
  }, [selectedRepo]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      const active = await listActiveTasks();
      if (cancelled || active.length === 0) return;
      const task = active.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (task.interactionId && !activePollId.current) {
        setRunning(true);
        setStatusText("Reconnecting to background task…");
        setLiveActivity(task.activity ?? []);
        activityCountRef.current = task.activity?.length ?? 0;
        startPolling(task.interactionId, task.messageId, task.id);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const createNewChat = useCallback(async () => {
    const id = uid();
    const meta: ConversationMeta = {
      id, title: "New conversation", mode, deliveryMode: "pr",
      createdAt: Date.now(), updatedAt: Date.now(),
      repository: selectedRepo ? {
        owner: selectedRepo.owner.login, name: selectedRepo.name,
        fullName: selectedRepo.full_name, defaultBranch: selectedRepo.default_branch,
        private: selectedRepo.private,
      } : undefined,
    };
    await saveConversation(meta);
    setConversations((prev) => [meta, ...prev]);
    setActiveId(id); setMessages([]); setSidebarOpen(false);
  }, [mode, selectedRepo]);

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    activePollId.current = null;
    setRunning(false); setStatusText("Stopped by user");
  }

  function startPolling(interactionId: string, messageId: string, taskId?: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    activePollId.current = interactionId;
    const interval = dataSaver ? POLL_SAVER : POLL_NORMAL;
    const tick = async () => {
      if (activePollId.current !== interactionId) return;
      try {
        const since = activityCountRef.current;
        const q = dataSaver
          ? `/api/agent/status?id=${encodeURIComponent(interactionId)}&since=${since}`
          : `/api/agent/status?id=${encodeURIComponent(interactionId)}`;
        const sRes = await fetch(q);
        const sData = await sRes.json();
        if (!sRes.ok) throw new Error(sData.error);
        if (Array.isArray(sData.activity) && sData.activity.length) {
          setLiveActivity((prev) => {
            const merged = dataSaver ? [...prev, ...sData.activity] : sData.activity;
            const seen = new Set<string>();
            const out: ActivityEvent[] = [];
            for (const e of merged) { if (seen.has(e.id)) continue; seen.add(e.id); out.push(e); }
            return out.slice(-80);
          });
          if (typeof sData.activity_total === "number") activityCountRef.current = sData.activity_total;
        }
        setStatusText(sData.current_activity || (sData.status === "in_progress" ? "Agent is working…" : sData.status));
        if (taskId) await updateTask(taskId, { status: sData.status, lastPolledAt: Date.now() });
        if (["completed", "failed", "cancelled", "incomplete"].includes(sData.status)) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          activePollId.current = null;
          setRunning(false); setStatusText("");
          const content = sData.output_text || (sData.error ? `Error: ${JSON.stringify(sData.error)}` : "No output");
          const finalStatus = sData.status === "completed" ? "completed" : "failed";
          await updateMessage(messageId, {
            content, status: finalStatus, steps: sData.steps, activity: sData.activity,
            usage: sData.usage, error: sData.error ? String(sData.error) : undefined,
            report: sData.report ?? undefined,
          });
          setMessages((prev) => prev.map((m) => m.id === messageId ? {
            ...m, content, status: finalStatus, steps: sData.steps, activity: sData.activity,
            usage: sData.usage, report: sData.report ?? undefined,
          } : m));
          setLiveActivity([]);
          if (taskId) {
            await updateTask(taskId, {
              status: finalStatus, report: sData.report ?? undefined,
              error: sData.error ? String(sData.error) : undefined,
            });
          }
          if (selectedRepo && sData.report?.summary) {
            const existing = (await getProjectMemory(selectedRepo.full_name)) ?? {
              repoFullName: selectedRepo.full_name, defaultBranch: selectedRepo.default_branch,
              recentTasks: [], decisions: [], updatedAt: Date.now(),
            } as ProjectMemory;
            const recentTasks = [
              { summary: String(sData.report.summary).slice(0, 200), at: Date.now() },
              ...existing.recentTasks,
            ].slice(0, 10);
            const mem: ProjectMemory = { ...existing, defaultBranch: selectedRepo.default_branch, recentTasks, updatedAt: Date.now() };
            await saveProjectMemory(mem);
            setProjectMem(mem);
          }
        }
      } catch (err) { console.error(err); }
    };
    tick();
    pollRef.current = setInterval(tick, interval);
  }

  async function sendMessage() {
    if (!input.trim() || running) return;
    let convId = activeId;
    if (!convId) {
      const id = uid();
      const meta: ConversationMeta = {
        id, title: input.slice(0, 60) || "New conversation", mode, deliveryMode: "pr",
        createdAt: Date.now(), updatedAt: Date.now(),
        repository: selectedRepo ? {
          owner: selectedRepo.owner.login, name: selectedRepo.name,
          fullName: selectedRepo.full_name, defaultBranch: selectedRepo.default_branch,
          private: selectedRepo.private,
        } : undefined,
      };
      await saveConversation(meta);
      setConversations((prev) => [meta, ...prev]);
      convId = id; setActiveId(id);
    }
    const userMsg: ChatMessage = {
      id: uid(), conversationId: convId, role: "user", content: input.trim(), createdAt: Date.now(),
    };
    await saveMessage(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    setInput(""); setRunning(true); setStatusText("Starting agent…");
    setLiveActivity([]); activityCountRef.current = 0;
    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId, conversationId: convId, role: "assistant", content: "",
      createdAt: Date.now(), status: "running",
    };
    await saveMessage(assistantMsg);
    setMessages((prev) => [...prev, assistantMsg]);
    try {
      const prev = messages.filter((m) => m.role === "assistant" && m.interactionId).pop();
      let finalInput = userMsg.content;
      if (projectMem && projectMem.recentTasks.length > 0) {
        finalInput = [
          "[Project memory — prior context]",
          projectMem.framework ? `Framework: ${projectMem.framework}` : null,
          projectMem.decisions.length ? `Decisions: ${projectMem.decisions.slice(0, 5).join("; ")}` : null,
          `Recent tasks: ${projectMem.recentTasks.slice(0, 3).map((t) => t.summary).join(" | ")}`,
          "[End memory]", "", userMsg.content,
        ].filter(Boolean).join("\n");
      }
      const res = await fetch("/api/agent/interact", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: finalInput, mode, deliveryMode: "pr",
          repository: selectedRepo ? {
            owner: selectedRepo.owner.login, name: selectedRepo.name,
            fullName: selectedRepo.full_name, defaultBranch: selectedRepo.default_branch,
          } : undefined,
          previousInteractionId: prev?.interactionId,
          environmentId: prev?.environmentId,
          background: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start agent");
      await updateMessage(assistantId, {
        interactionId: data.id, environmentId: data.environment_id, status: "running",
      });
      setMessages((prevM) => prevM.map((m) => m.id === assistantId ? {
        ...m, interactionId: data.id, environmentId: data.environment_id, status: "running",
      } : m));
      const task: TaskRecord = {
        id: uid(), conversationId: convId!, messageId: assistantId,
        interactionId: data.id, environmentId: data.environment_id,
        status: "running", inputPreview: userMsg.content.slice(0, 120),
        createdAt: Date.now(), updatedAt: Date.now(),
      };
      await saveTask(task);
      const conv = conversations.find((c) => c.id === convId);
      if (conv) {
        await saveConversation({
          ...conv, lastInteractionId: data.id, environmentId: data.environment_id, updatedAt: Date.now(),
        });
      }
      startPolling(data.id, assistantId, task.id);
    } catch (err) {
      setRunning(false); setStatusText("");
      const msg = err instanceof Error ? err.message : "Failed";
      await updateMessage(assistantId, { content: msg, status: "failed", error: msg });
      setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, content: msg, status: "failed" } : m));
    }
  }

  async function toggleDataSaver() {
    const next = !dataSaver;
    setDataSaver(next);
    await setSetting("appSettings", { dataSaver: next, pollIntervalMs: next ? POLL_SAVER : POLL_NORMAL });
  }

  async function handleClearMemory() {
    if (!selectedRepo) return;
    await clearProjectMemory(selectedRepo.full_name);
    setProjectMem(null); setShowMemory(false);
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <aside className={cn(
        "fixed inset-y-0 left-0 z-40 w-72 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform md:relative md:translate-x-0",
        sidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4285F4] to-[#3DDC97] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
                <path d="M8 22V10l8 6 8-6v12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-semibold text-sm">Petediano Forge</span>
          </div>
          <button className="md:hidden p-1" onClick={() => setSidebarOpen(false)}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-3">
          <button onClick={createNewChat} className="w-full h-10 rounded-lg bg-[var(--primary)] text-white text-sm font-medium flex items-center justify-center gap-2 hover:brightness-105">
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2">
          {conversations.map((c) => (
            <button key={c.id} onClick={() => { setActiveId(c.id); setSidebarOpen(false); }}
              className={cn("w-full text-left px-3 py-2.5 rounded-lg text-sm mb-0.5 truncate",
                activeId === c.id ? "bg-[var(--selection)] text-[var(--primary)]" : "hover:bg-[var(--bg-app)] text-[var(--text-primary)]")}>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title}</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5 pl-5">{formatRelativeTime(c.updatedAt)}</div>
            </button>
          ))}
        </div>
        <div className="p-3 border-t border-[var(--border)] space-y-1">
          <button onClick={toggleDataSaver} className={cn("w-full h-9 rounded-lg text-sm flex items-center gap-2 px-3",
            dataSaver ? "bg-[var(--selection)] text-[var(--primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-app)]")}>
            <Activity className="w-4 h-4" /> Data Saver {dataSaver ? "On" : "Off"}
          </button>
          {selectedRepo && (
            <button onClick={() => setShowMemory(true)} className="w-full h-9 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-app)] flex items-center gap-2 px-3">
              <Brain className="w-4 h-4" /> Project memory
            </button>
          )}
          <button onClick={() => router.push("/setup")} className="w-full h-9 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-app)] flex items-center gap-2 px-3">
            <Settings className="w-4 h-4" /> Settings / Credentials
          </button>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-[var(--border)] bg-[var(--surface)] flex items-center px-3 gap-2 shrink-0">
          <button className="md:hidden p-2" onClick={() => setSidebarOpen(true)}><Menu className="w-5 h-5" /></button>
          <div className="relative">
            <button onClick={() => setRepoOpen(!repoOpen)} className="h-8 px-3 rounded-lg border border-[var(--border)] text-sm flex items-center gap-1.5 hover:bg-[var(--bg-app)] max-w-[200px]">
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{selectedRepo ? selectedRepo.full_name : "Select repo"}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>
            {repoOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg z-50">
                {repos.length === 0 && <div className="p-3 text-sm text-[var(--text-secondary)]">No repositories found</div>}
                {repos.map((r) => (
                  <button key={r.id} onClick={() => { setSelectedRepo(r); setRepoOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--selection)] truncate">
                    {r.full_name}
                    {r.private && <span className="ml-1 text-xs text-[var(--text-secondary)]">private</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <select value={mode} onChange={(e) => setMode(e.target.value as ExecutionMode)}
            className="h-8 px-2 rounded-lg border border-[var(--border)] text-sm bg-[var(--surface)]">
            <option value="ask">Ask</option>
            <option value="plan">Plan</option>
            <option value="implement">Implement</option>
          </select>
          {statusText && (
            <div className="ml-auto flex items-center gap-2 text-sm text-[var(--text-secondary)] truncate max-w-[40%]">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span className="truncate">{statusText}</span>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <h2 className="text-xl font-medium mb-2">What should we build today?</h2>
              <p className="text-[var(--text-secondary)] mb-6 max-w-md">Choose a repository, describe the task, and let your coding agent work.</p>
              <div className="grid gap-2 w-full max-w-sm">
                {["Understand this repository", "Find and fix a bug", "Add a new feature", "Improve the mobile interface"].map((s) => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-left px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--selection)] transition">{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("mb-4 max-w-3xl", m.role === "user" ? "ml-auto" : "mr-auto")}>
              <div className={cn("rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                m.role === "user" ? "bg-[var(--primary)] text-white rounded-br-md" : "bg-[var(--surface)] border border-[var(--border)] rounded-bl-md")}>
                {m.role === "assistant" && m.status === "running" && !m.content ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {statusText || "Agent is working…"}
                    </div>
                    {(liveActivity.length > 0 || (m.activity && m.activity.length > 0)) && (
                      <ActivityPanel
                        events={liveActivity.length > 0 ? liveActivity : (m.activity ?? [])}
                        expanded={!!expandedLogs[m.id]}
                        onToggle={() => setExpandedLogs((p) => ({ ...p, [m.id]: !p[m.id] }))}
                      />
                    )}
                  </div>
                ) : m.role === "assistant" ? (
                  <div className="space-y-3">
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[#1e293b] prose-pre:text-gray-100">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {m.content || ""}
                      </ReactMarkdown>
                    </div>
                    {m.activity && m.activity.length > 0 && (
                      <ActivityPanel events={m.activity} expanded={!!expandedLogs[m.id]}
                        onToggle={() => setExpandedLogs((p) => ({ ...p, [m.id]: !p[m.id] }))} />
                    )}
                    {m.report && <ReportCard report={m.report} />}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{m.content}</div>
                )}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] mt-1 px-1">
                {formatRelativeTime(m.createdAt)}
                {m.status && m.status !== "completed" && ` · ${m.status}`}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3 safe-bottom">
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={selectedRepo ? `Describe a task for ${selectedRepo.name}…` : "Select a repository and describe a task…"}
              rows={1}
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            />
            {running ? (
              <button onClick={stopPolling} className="h-11 w-11 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0">
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button onClick={sendMessage} disabled={!input.trim()}
                className="h-11 w-11 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center shrink-0 disabled:opacity-40">
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </main>

      {showMemory && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md bg-[var(--surface)] rounded-2xl border border-[var(--border)] p-4 max-h-[80dvh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2"><Brain className="w-4 h-4" /> Project memory</h3>
              <button onClick={() => setShowMemory(false)}><X className="w-5 h-5" /></button>
            </div>
            {projectMem ? (
              <div className="space-y-3 text-sm">
                <div><div className="text-[var(--text-secondary)] text-xs mb-1">Repository</div><div>{projectMem.repoFullName}</div></div>
                {projectMem.framework && <div><div className="text-[var(--text-secondary)] text-xs mb-1">Framework</div><div>{projectMem.framework}</div></div>}
                {projectMem.decisions.length > 0 && (
                  <div>
                    <div className="text-[var(--text-secondary)] text-xs mb-1">Decisions</div>
                    <ul className="list-disc pl-4 space-y-1">{projectMem.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
                  </div>
                )}
                {projectMem.recentTasks.length > 0 && (
                  <div>
                    <div className="text-[var(--text-secondary)] text-xs mb-1">Recent tasks</div>
                    <ul className="space-y-1">{projectMem.recentTasks.map((t, i) => (
                      <li key={i} className="text-[var(--text-secondary)]">{t.summary}</li>
                    ))}</ul>
                  </div>
                )}
                <button onClick={handleClearMemory} className="mt-2 h-9 px-3 rounded-lg border border-red-300 text-red-600 text-sm flex items-center gap-2">
                  <Trash2 className="w-3.5 h-3.5" /> Clear memory
                </button>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">No memory stored for this repository yet. Complete a task to build context.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityPanel({ events, expanded, onToggle }: {
  events: ActivityEvent[]; expanded: boolean; onToggle: () => void;
}) {
  const visible = expanded ? events : events.slice(-4);
  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-app)] text-sm">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2 text-left text-[var(--text-secondary)]">
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <Activity className="w-3.5 h-3.5" />
        <span>Activity ({events.length}{!expanded && events.length > 4 ? " · showing last 4" : ""})</span>
      </button>
      <ul className="px-3 pb-2 space-y-1.5 max-h-48 overflow-y-auto">
        {visible.map((e) => (
          <li key={e.id} className="flex gap-2 items-start">
            <StatusIcon status={e.status} />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px]">{e.label}</div>
              {e.detail && <div className="text-[12px] text-[var(--text-secondary)] truncate font-mono">{e.detail}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusIcon({ status }: { status: ActivityEvent["status"] }) {
  if (status === "error") return <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />;
  if (status === "running") return <Loader2 className="w-3.5 h-3.5 text-[var(--primary)] animate-spin shrink-0 mt-0.5" />;
  if (status === "done") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />;
  return <AlertCircle className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0 mt-0.5" />;
}

function ReportCard({ report }: { report: CompletionReport }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-app)] p-3 text-sm space-y-2">
      <div className="font-semibold text-[13px]">Task report</div>
      {report.filesChanged.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-[var(--text-secondary)] text-xs mb-1"><FileCode className="w-3 h-3" /> Files changed</div>
          <div className="flex flex-wrap gap-1">
            {report.filesChanged.slice(0, 12).map((f) => (
              <span key={f} className="px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[11px] font-mono">{f}</span>
            ))}
          </div>
        </div>
      )}
      {report.commandsRun.length > 0 && (
        <div>
          <div className="flex items-center gap-1 text-[var(--text-secondary)] text-xs mb-1"><Terminal className="w-3 h-3" /> Commands</div>
          <ul className="space-y-0.5 font-mono text-[11px] text-[var(--text-secondary)]">
            {report.commandsRun.slice(0, 8).map((c, i) => <li key={i} className="truncate">$ {c}</li>)}
          </ul>
        </div>
      )}
      {report.testsRun.length > 0 && (
        <div>
          <div className="text-[var(--text-secondary)] text-xs mb-1">Tests</div>
          <ul className="space-y-0.5">
            {report.testsRun.slice(0, 8).map((t, i) => (
              <li key={i} className="flex items-center gap-1.5 text-[12px]">
                {t.passed ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                {t.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.unresolvedErrors.length > 0 && (
        <div>
          <div className="text-red-600 text-xs mb-1">Unresolved errors</div>
          <ul className="space-y-0.5 text-[12px] text-red-600/90">
            {report.unresolvedErrors.slice(0, 5).map((e, i) => <li key={i} className="truncate">{e}</li>)}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <StatusBadge label="GitHub" status={report.github.status} detail={report.github.pullRequestUrl || report.github.commitSha} />
        <StatusBadge label="Vercel" status={report.vercel.status} detail={report.vercel.detail} />
      </div>
    </div>
  );
}

function StatusBadge({ label, status, detail }: {
  label: string; status: CompletionReport["github"]["status"]; detail?: string;
}) {
  const color = status === "success" ? "text-emerald-600 border-emerald-300"
    : status === "failed" ? "text-red-600 border-red-300"
    : status === "pending" ? "text-amber-600 border-amber-300"
    : "text-[var(--text-secondary)] border-[var(--border)]";
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px]", color)} title={detail}>
      {label}: {status}
    </span>
  );
}
