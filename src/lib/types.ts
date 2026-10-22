export type ExecutionMode = "ask" | "plan" | "implement";
export type DeliveryMode = "pr" | "direct";
export type TaskStatus =
  | "pending"
  | "running"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "incomplete";

export interface ConversationMeta {
  id: string;
  title: string;
  repository?: {
    owner: string;
    name: string;
    fullName: string;
    defaultBranch: string;
    private: boolean;
  };
  mode: ExecutionMode;
  deliveryMode: DeliveryMode;
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  lastInteractionId?: string;
  environmentId?: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: number;
  status?: TaskStatus;
  interactionId?: string;
  environmentId?: string;
  steps?: AgentStep[];
  activity?: ActivityEvent[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  error?: string;
  result?: TaskResult;
  report?: CompletionReport;
}

/** Normalized step for UI (derived from API steps; no private CoT). */
export interface AgentStep {
  id: string;
  type: string;
  title?: string;
  content?: string;
  status?: string;
  timestamp?: number;
}

/** Truthful activity event derived from Interaction steps. */
export interface ActivityEvent {
  id: string;
  type: string;
  label: string;
  detail?: string;
  status: "running" | "done" | "error" | "info";
  timestamp?: number;
}

export interface TaskResult {
  summary?: string;
  filesChanged?: string[];
  testsRun?: { name: string; passed: boolean; output?: string }[];
  branch?: string;
  commitSha?: string;
  pullRequestUrl?: string;
  warnings?: string[];
}

/** Structured completion report shown when a task finishes. */
export interface CompletionReport {
  summary: string;
  filesChanged: string[];
  commandsRun: string[];
  testsRun: { name: string; passed: boolean; output?: string }[];
  unresolvedErrors: string[];
  github: {
    status: "success" | "failed" | "pending" | "unverified" | "none";
    branch?: string;
    commitSha?: string;
    pullRequestUrl?: string;
    detail?: string;
  };
  vercel: {
    status: "success" | "failed" | "pending" | "unverified" | "none";
    detail?: string;
  };
  finishedAt: number;
}

/** Durable client-side task record so work survives refresh / phone lock. */
export interface TaskRecord {
  id: string;
  conversationId: string;
  messageId: string;
  interactionId: string;
  environmentId?: string;
  status: TaskStatus;
  inputPreview: string;
  createdAt: number;
  updatedAt: number;
  lastPolledAt?: number;
  activity?: ActivityEvent[];
  report?: CompletionReport;
  error?: string;
  /** Prevent duplicate concurrent polls for the same interaction */
  lockedUntil?: number;
}

/** Per-repository project memory (never stores secrets). */
export interface ProjectMemory {
  repoFullName: string;
  defaultBranch?: string;
  framework?: string;
  recentTasks: { summary: string; at: number }[];
  decisions: string[];
  updatedAt: number;
}

export interface AppSettings {
  dataSaver: boolean;
  pollIntervalMs?: number;
}

export interface AuthStatus {
  gemini: boolean;
  github: boolean;
  geminiError?: string;
  githubError?: string;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  description?: string | null;
  html_url: string;
  owner: { login: string; avatar_url: string };
}
