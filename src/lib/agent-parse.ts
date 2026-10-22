import type { ActivityEvent, CompletionReport } from "./types";

/** Map raw Interaction API steps into truthful UI activity events. Never invent progress; never expose private CoT. */
export function stepsToActivity(steps: unknown[] | undefined | null): ActivityEvent[] {
  if (!Array.isArray(steps)) return [];
  const events: ActivityEvent[] = [];
  let i = 0;
  for (const raw of steps) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const type = String(s.type ?? "unknown");
    const id = String(s.id ?? `step-${i++}`);
    if (type === "thought" || type === "user_input") {
      const summary = extractTextField(s, "summary");
      if (summary && summary.length < 200 && !looksLikeSignature(summary)) {
        events.push({ id, type, label: "Reasoning", detail: summary.slice(0, 180), status: "info" });
      }
      continue;
    }
    if (type === "function_call" || type === "code_execution_call") {
      const name = String(s.name ?? "tool");
      const args = s.arguments;
      let detail: string | undefined;
      if (args && typeof args === "object") {
        const a = args as Record<string, unknown>;
        if (typeof a.command === "string") detail = a.command;
        else if (typeof a.code === "string") detail = a.code.slice(0, 200);
        else if (typeof a.path === "string") detail = a.path;
        else if (typeof a.query === "string") detail = a.query;
        else detail = JSON.stringify(args).slice(0, 160);
      }
      events.push({ id, type, label: name === "code_execution" ? "Run command" : `Call ${name}`, detail, status: "done" });
      continue;
    }
    if (type === "function_result" || type === "code_execution_result" || type === "code_execution_output") {
      const out = extractTextField(s, "output") || extractTextField(s, "result") || (typeof s.stdout === "string" ? s.stdout : undefined);
      const err = typeof s.stderr === "string" && s.stderr ? s.stderr : typeof s.error === "string" ? s.error : undefined;
      events.push({ id, type, label: err ? "Command error" : "Command result", detail: (err || out || "").slice(0, 240), status: err ? "error" : "done" });
      continue;
    }
    if (type === "model_output") {
      const text = extractContentText(s.content);
      if (text) events.push({ id, type, label: "Agent output", detail: text.slice(0, 160) + (text.length > 160 ? "…" : ""), status: "done" });
      continue;
    }
    if (type.includes("search")) {
      events.push({ id, type, label: type.includes("result") ? "Search results" : "Web search", detail: extractTextField(s, "query") || undefined, status: "done" });
      continue;
    }
    if (type && type !== "unknown") {
      events.push({ id, type, label: humanizeType(type), status: "info" });
    }
  }
  return events;
}

export function buildCompletionReport(outputText: string | null | undefined, activity: ActivityEvent[], apiError?: unknown): CompletionReport {
  const text = outputText ?? "";
  return {
    summary: text.slice(0, 800) || (apiError ? String(apiError) : "No summary"),
    filesChanged: extractFiles(text, activity),
    commandsRun: extractCommands(activity),
    testsRun: extractTests(text, activity),
    unresolvedErrors: extractErrors(text, activity, apiError),
    github: extractGitHub(text),
    vercel: extractVercel(text),
    finishedAt: Date.now(),
  };
}

function extractTextField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const item of v) {
      if (item && typeof item === "object" && typeof (item as any).text === "string") parts.push((item as any).text);
    }
    return parts.length ? parts.join("\n") : undefined;
  }
  return undefined;
}

function extractContentText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const p of content) {
    if (p && typeof p === "object" && (p as any).type === "text" && typeof (p as any).text === "string") parts.push((p as any).text);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function looksLikeSignature(s: string): boolean {
  return /^[A-Za-z0-9+/=_-]{40,}$/.test(s.trim());
}

function humanizeType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function extractFiles(text: string, activity: ActivityEvent[]): string[] {
  const set = new Set<string>();
  const pathRe = /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|json|md|css|html|yml|yaml|toml|sql|sh))\b/gm;
  let m: RegExpExecArray | null;
  while ((m = pathRe.exec(text)) !== null) set.add(m[1]);
  for (const a of activity) {
    if (a.detail && /\.\w{1,8}$/.test(a.detail) && a.detail.length < 120) {
      if (/[/\\]/.test(a.detail) || /\.(ts|js|py|md)$/.test(a.detail)) set.add(a.detail.split(/\s/)[0]);
    }
  }
  return Array.from(set).slice(0, 40);
}

function extractCommands(activity: ActivityEvent[]): string[] {
  return activity
    .filter((a) => a.type.includes("code_execution") || a.label === "Run command" || (a.detail && /^(npm|pnpm|yarn|git|pytest|cargo|go |python)/i.test(a.detail)))
    .map((a) => a.detail || a.label)
    .filter(Boolean)
    .slice(0, 30) as string[];
}

function extractTests(text: string, activity: ActivityEvent[]): { name: string; passed: boolean; output?: string }[] {
  const tests: { name: string; passed: boolean; output?: string }[] = [];
  const passRe = /(?:✓|✔|PASS|passed)\s+([^\n]{3,80})/gi;
  const failRe = /(?:✗|✖|FAIL|failed)\s+([^\n]{3,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = passRe.exec(text)) !== null) tests.push({ name: m[1].trim(), passed: true });
  while ((m = failRe.exec(text)) !== null) tests.push({ name: m[1].trim(), passed: false });
  for (const a of activity) {
    if (/test/i.test(a.label) || /test/i.test(a.detail || "")) {
      tests.push({ name: (a.detail || a.label).slice(0, 80), passed: a.status !== "error", output: a.detail });
    }
  }
  return tests.slice(0, 30);
}

function extractErrors(text: string, activity: ActivityEvent[], apiError?: unknown): string[] {
  const errs: string[] = [];
  if (apiError) errs.push(String(apiError).slice(0, 300));
  for (const a of activity) {
    if (a.status === "error" && a.detail) errs.push(a.detail.slice(0, 300));
  }
  const errLines = text.match(/(?:Error|Exception|FAILED)[:\s][^\n]{5,200}/gi);
  if (errLines) errs.push(...errLines.slice(0, 5));
  return Array.from(new Set(errs)).slice(0, 15);
}

function extractGitHub(text: string): CompletionReport["github"] {
  const pr = text.match(/https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/i);
  const commit = text.match(/\b([0-9a-f]{7,40})\b/);
  const branch = text.match(/(?:branch|Branch)[:\s`]+([A-Za-z0-9._\/-]+)/i);
  if (pr || /pull request|opened PR|created PR/i.test(text)) {
    return { status: "success", pullRequestUrl: pr?.[0], commitSha: commit?.[1], branch: branch?.[1], detail: pr ? "PR link found in agent output" : "PR mentioned in output" };
  }
  if (/pushed|commit(ted)?/i.test(text) && commit) {
    return { status: "success", commitSha: commit[1], branch: branch?.[1], detail: "Commit referenced in agent output" };
  }
  if (/git |github/i.test(text)) return { status: "unverified", detail: "GitHub mentioned; no PR/commit link verified" };
  return { status: "none" };
}

function extractVercel(text: string): CompletionReport["vercel"] {
  const url = text.match(/https?:\/\/[^\s)]+\.vercel\.app[^\s)]*/i);
  if (url || /deployed (to|on) vercel|vercel deployment/i.test(text)) {
    return { status: url ? "success" : "unverified", detail: url?.[0] || "Vercel deployment mentioned in output" };
  }
  return { status: "none" };
}
