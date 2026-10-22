"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  ChatMessage,
  ConversationMeta,
  ProjectMemory,
  TaskRecord,
} from "./types";

interface ForgeDB extends DBSchema {
  conversations: {
    key: string;
    value: ConversationMeta;
    indexes: { "by-updated": number };
  };
  messages: {
    key: string;
    value: ChatMessage;
    indexes: { "by-conversation": string };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
  tasks: {
    key: string;
    value: TaskRecord;
    indexes: { "by-status": string; "by-interaction": string };
  };
  projectMemory: {
    key: string;
    value: ProjectMemory;
  };
}

const DB_NAME = "petediano-forge";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<ForgeDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const conv = db.createObjectStore("conversations", { keyPath: "id" });
          conv.createIndex("by-updated", "updatedAt");

          const msg = db.createObjectStore("messages", { keyPath: "id" });
          msg.createIndex("by-conversation", "conversationId");

          db.createObjectStore("settings", { keyPath: "key" });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains("tasks")) {
            const tasks = db.createObjectStore("tasks", { keyPath: "id" });
            tasks.createIndex("by-status", "status");
            tasks.createIndex("by-interaction", "interactionId");
          }
          if (!db.objectStoreNames.contains("projectMemory")) {
            db.createObjectStore("projectMemory", { keyPath: "repoFullName" });
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function listConversations(): Promise<ConversationMeta[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex("conversations", "by-updated");
  return all.reverse();
}

export async function getConversation(
  id: string
): Promise<ConversationMeta | undefined> {
  const db = await getDB();
  return db.get("conversations", id);
}

export async function saveConversation(meta: ConversationMeta): Promise<void> {
  const db = await getDB();
  await db.put("conversations", meta);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("conversations", id);
  const msgs = await db.getAllFromIndex("messages", "by-conversation", id);
  const tx = db.transaction("messages", "readwrite");
  await Promise.all(msgs.map((m) => tx.store.delete(m.id)));
  await tx.done;
  const tasks = await db.getAll("tasks");
  const ttx = db.transaction("tasks", "readwrite");
  await Promise.all(
    tasks.filter((t) => t.conversationId === id).map((t) => ttx.store.delete(t.id))
  );
  await ttx.done;
}

export async function getMessages(
  conversationId: string
): Promise<ChatMessage[]> {
  const db = await getDB();
  const msgs = await db.getAllFromIndex(
    "messages",
    "by-conversation",
    conversationId
  );
  return msgs.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveMessage(msg: ChatMessage): Promise<void> {
  const db = await getDB();
  await db.put("messages", msg);
}

export async function updateMessage(
  id: string,
  patch: Partial<ChatMessage>
): Promise<void> {
  const db = await getDB();
  const existing = await db.get("messages", id);
  if (existing) {
    await db.put("messages", { ...existing, ...patch });
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const db = await getDB();
  const row = await db.get("settings", key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put("settings", { key, value });
}

export async function saveTask(task: TaskRecord): Promise<void> {
  const db = await getDB();
  await db.put("tasks", task);
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
  const db = await getDB();
  return db.get("tasks", id);
}

export async function getTaskByInteraction(
  interactionId: string
): Promise<TaskRecord | undefined> {
  const db = await getDB();
  return db.getFromIndex("tasks", "by-interaction", interactionId);
}

export async function listActiveTasks(): Promise<TaskRecord[]> {
  const db = await getDB();
  const all = await db.getAll("tasks");
  return all.filter((t) =>
    ["pending", "running", "in_progress"].includes(t.status)
  );
}

export async function updateTask(
  id: string,
  patch: Partial<TaskRecord>
): Promise<void> {
  const db = await getDB();
  const existing = await db.get("tasks", id);
  if (existing) {
    await db.put("tasks", { ...existing, ...patch, updatedAt: Date.now() });
  }
}

export async function listRecentTasks(limit = 20): Promise<TaskRecord[]> {
  const db = await getDB();
  const all = await db.getAll("tasks");
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function getProjectMemory(
  repoFullName: string
): Promise<ProjectMemory | undefined> {
  const db = await getDB();
  return db.get("projectMemory", repoFullName);
}

export async function saveProjectMemory(mem: ProjectMemory): Promise<void> {
  const db = await getDB();
  await db.put("projectMemory", { ...mem, updatedAt: Date.now() });
}

export async function clearProjectMemory(repoFullName: string): Promise<void> {
  const db = await getDB();
  await db.delete("projectMemory", repoFullName);
}

export async function listProjectMemories(): Promise<ProjectMemory[]> {
  const db = await getDB();
  return db.getAll("projectMemory");
}

export async function exportAllData(): Promise<string> {
  const db = await getDB();
  const conversations = await db.getAll("conversations");
  const messages = await db.getAll("messages");
  const settings = await db.getAll("settings");
  const tasks = await db.getAll("tasks");
  const projectMemory = await db.getAll("projectMemory");
  return JSON.stringify(
    {
      conversations,
      messages,
      settings,
      tasks,
      projectMemory,
      exportedAt: Date.now(),
    },
    null,
    2
  );
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear("conversations");
  await db.clear("messages");
  await db.clear("settings");
  await db.clear("tasks");
  await db.clear("projectMemory");
}
