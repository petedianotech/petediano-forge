export type ExecutionMode = "ask" | "plan" | "implement";
export type DeliveryMode = "pr" | "direct";

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
  status?: "pending" | "running" | "completed" | "failed" | "cancelled";
  interactionId?: string;
  environmentId?: string;
  steps?: AgentStep[];
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  error?: string;
  result?: TaskResult;
}

export interface AgentStep {
  id: string;
  type: string;
  title?: string;
  content?: string;
  status?: string;
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
