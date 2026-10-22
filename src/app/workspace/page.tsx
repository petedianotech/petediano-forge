"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import {
  Menu,
  Plus,
  Send,
  Square,
  Settings,
  ChevronDown,
  GitBranch,
  Loader2,
  MessageSquare,
  X,
} from "lucide-react";
import type { ChatMessage, ConversationMeta, ExecutionMode, GitHubRepo } from "@/lib/types";
import {
  listConversations,
  saveConversation,
  getMessages,
  saveMessage,
  updateMessage,
} from "@/lib/db";
import { cn, formatRelativeTime } from "@/lib/utils";
import "highlight.js/styles/github-dark.css";

function uid() {
  return crypto.randomUUID();
}

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
  const bottomRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.gemini || !d.github) router.replace("/setup");
        else setReady(true);
      })
      .catch(() => router.replace("/setup"));
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    listConversations().then(setConversations);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    fetch("/api/github/repos")
      .then((r) => r.json())
      .then((d) => { if (d.repos) setRepos(d.repos); })
      .catch(console.error);
  }, [ready]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    getMessages(activeId).then(setMessages);
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusText]);

  const createNewChat = useCallback(async () => {
    const id = uid();
    const meta: ConversationMeta = {
      id,
      title: "New conversation",
      mode,
      deliveryMode: "pr",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      repository: selectedRepo
        ? {
            owner: selectedRepo.owner.login,
            name: selectedRepo.name,
            fullName: selectedRepo.full_name,
            defaultBranch: selectedRepo.default_branch,
            private: selectedRepo.private,
          }
        : undefined,
    };
    await saveConversation(meta);
    setConversations((prev) => [meta, ...prev]);
    setActiveId(id);
    setMessages([]);
    setSidebarOpen(false);
  }, [mode, selectedRepo]);

  async function sendMessage() {
    if (!input.trim() || running) return;
    let convId = activeId;
    if (!convId) {
      const id = uid();
      const meta: ConversationMeta = {
        id,
        title: input.slice(0, 60) || "New conversation",
        mode,
        deliveryMode: "pr",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        repository: selectedRepo
          ? {
              owner: selectedRepo.owner.login,
              name: selectedRepo.name,
              fullName: selectedRepo.full_name,
              defaultBranch: selectedRepo.default_branch,
              private: selectedRepo.private,
            }
          : undefined,
      };
      await saveConversation(meta);
      setConversations((prev) => [meta, ...prev]);
      convId = id;
      setActiveId(id);
    }

    const userMsg: ChatMessage = {
      id: uid(),
      conversationId: convId,
      role: "user",
      content: input.trim(),
      createdAt: Date.now(),
    };
    await saveMessage(userMsg);
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setRunning(true);
    setStatusText("Starting agent…");

    const assistantId = uid();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      conversationId: convId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "running",
    };
    await saveMessage(assistantMsg);
    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const prev = messages.filter((m) => m.role === "assistant" && m.interactionId).pop();
      const res = await fetch("/api/agent/interact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: userMsg.content,
          mode,
          deliveryMode: "pr",
          repository: selectedRepo
            ? {
                owner: selectedRepo.owner.login,
                name: selectedRepo.name,
                fullName: selectedRepo.full_name,
                defaultBranch: selectedRepo.default_branch,
              }
            : undefined,
          previousInteractionId: prev?.interactionId,
          environmentId: prev?.environmentId,
          background: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start agent");

      await updateMessage(assistantId, {
        interactionId: data.id,
        environmentId: data.environment_id,
        status: "running",
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, interactionId: data.id, environmentId: data.environment_id, status: "running" }
            : m
        )
      );

      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const sRes = await fetch(`/api/agent/status?id=${data.id}`);
          const sData = await sRes.json();
          if (!sRes.ok) throw new Error(sData.error);

          setStatusText(
            sData.status === "in_progress"
              ? "Agent is working…"
              : sData.status === "completed"
              ? "Completed"
              : sData.status
          );

          if (["completed", "failed", "cancelled"].includes(sData.status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            setStatusText("");

            const content =
              sData.output_text ||
              (sData.error ? `Error: ${JSON.stringify(sData.error)}` : "No output");
            await updateMessage(assistantId, {
              content,
              status: sData.status === "completed" ? "completed" : "failed",
              steps: sData.steps,
              usage: sData.usage,
              error: sData.error ? String(sData.error) : undefined,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content,
                      status: sData.status === "completed" ? "completed" : "failed",
                      steps: sData.steps,
                      usage: sData.usage,
                    }
                  : m
              )
            );
          }
        } catch (err) {
          console.error(err);
        }
      }, 4000);
    } catch (err) {
      setRunning(false);
      setStatusText("");
      const msg = err instanceof Error ? err.message : "Failed";
      await updateMessage(assistantId, { content: msg, status: "failed", error: msg });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: msg, status: "failed" } : m))
      );
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setRunning(false);
    setStatusText("Stopped by user");
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
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-72 bg-[var(--surface)] border-r border-[var(--border)] flex flex-col transition-transform md:relative md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-4 border-b border-[var(--border)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4285F4] to-[#3DDC97] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 32 32" fill="none">
                <path d="M8 22V10l8 6 8-6v12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <span className="font-semibold text-sm">Petediano Forge</span>
          </div>
          <button className="md:hidden p-1" onClick={() => setSidebarOpen(false)}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3">
          <button
            onClick={createNewChat}
            className="w-full h-10 rounded-lg bg-[var(--primary)] text-white text-sm font-medium flex items-center justify-center gap-2 hover:brightness-105"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2">
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => { setActiveId(c.id); setSidebarOpen(false); }}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-lg text-sm mb-0.5 truncate",
                activeId === c.id
                  ? "bg-[var(--selection)] text-[var(--primary)]"
                  : "hover:bg-[var(--bg-app)] text-[var(--text-primary)]"
              )}
            >
              <div className="flex items-center gap-2">
                <MessageSquare className="w-3.5 h-3.5 shrink-0 opacity-60" />
                <span className="truncate">{c.title}</span>
              </div>
              <div className="text-xs text-[var(--text-secondary)] mt-0.5 pl-5">
                {formatRelativeTime(c.updatedAt)}
              </div>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-[var(--border)]">
          <button
            onClick={() => router.push("/setup")}
            className="w-full h-9 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-app)] flex items-center gap-2 px-3"
          >
            <Settings className="w-4 h-4" /> Settings / Credentials
          </button>
        </div>
      </aside>

      {sidebarOpen && (
        <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 border-b border-[var(--border)] bg-[var(--surface)] flex items-center px-3 gap-2 shrink-0">
          <button className="md:hidden p-2" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>

          <div className="relative">
            <button
              onClick={() => setRepoOpen(!repoOpen)}
              className="h-8 px-3 rounded-lg border border-[var(--border)] text-sm flex items-center gap-1.5 hover:bg-[var(--bg-app)] max-w-[200px]"
            >
              <GitBranch className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{selectedRepo ? selectedRepo.full_name : "Select repo"}</span>
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            </button>
            {repoOpen && (
              <div className="absolute top-full left-0 mt-1 w-72 max-h-64 overflow-y-auto bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg z-50">
                {repos.length === 0 && (
                  <div className="p-3 text-sm text-[var(--text-secondary)]">No repositories found</div>
                )}
                {repos.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => { setSelectedRepo(r); setRepoOpen(false); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[var(--selection)] truncate"
                  >
                    {r.full_name}
                    {r.private && <span className="ml-1 text-xs text-[var(--text-secondary)]">private</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ExecutionMode)}
            className="h-8 px-2 rounded-lg border border-[var(--border)] text-sm bg-[var(--surface)]"
          >
            <option value="ask">Ask</option>
            <option value="plan">Plan</option>
            <option value="implement">Implement</option>
          </select>

          {statusText && (
            <div className="ml-auto flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {statusText}
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-4 md:px-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-4">
              <h2 className="text-xl font-medium mb-2">What should we build today?</h2>
              <p className="text-[var(--text-secondary)] mb-6 max-w-md">
                Choose a repository, describe the task, and let your coding agent work.
              </p>
              <div className="grid gap-2 w-full max-w-sm">
                {["Understand this repository", "Find and fix a bug", "Add a new feature", "Improve the mobile interface"].map((s) => (
                  <button
                    key={s}
                    onClick={() => setInput(s)}
                    className="text-left px-4 py-2.5 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--selection)] transition"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("mb-4 max-w-3xl", m.role === "user" ? "ml-auto" : "mr-auto")}>
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 text-[15px] leading-relaxed",
                  m.role === "user"
                    ? "bg-[var(--primary)] text-white rounded-br-md"
                    : "bg-[var(--surface)] border border-[var(--border)] rounded-bl-md"
                )}
              >
                {m.role === "assistant" && m.status === "running" && !m.content ? (
                  <div className="flex items-center gap-2 text-[var(--text-secondary)]">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Agent is working…
                  </div>
                ) : m.role === "assistant" ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-pre:bg-[#1e293b] prose-pre:text-gray-100">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {m.content || ""}
                    </ReactMarkdown>
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
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                selectedRepo
                  ? `Describe a task for ${selectedRepo.name}…`
                  : "Select a repository and describe a task…"
              }
              rows={1}
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl border border-[var(--border)] bg-[var(--bg-app)] px-3 py-2.5 text-[15px] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            />
            {running ? (
              <button onClick={stopPolling} className="h-11 w-11 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0">
                <Square className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim()}
                className="h-11 w-11 rounded-xl bg-[var(--primary)] text-white flex items-center justify-center shrink-0 disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
