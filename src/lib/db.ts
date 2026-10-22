"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { ChatMessage, ConversationMeta } from "./types";

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
}

const DB_NAME = "petediano-forge";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ForgeDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ForgeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const conv = db.createObjectStore("conversations", { keyPath: "id" });
        conv.createIndex("by-updated", "updatedAt");

        const msg = db.createObjectStore("messages", { keyPath: "id" });
        msg.createIndex("by-conversation", "conversationId");

        db.createObjectStore("settings", { keyPath: "key" });
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

export async function getConversation(id: string): Promise<ConversationMeta | undefined> {
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
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const db = await getDB();
  const msgs = await db.getAllFromIndex("messages", "by-conversation", conversationId);
  return msgs.sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveMessage(msg: ChatMessage): Promise<void> {
  const db = await getDB();
  await db.put("messages", msg);
}

export async function updateMessage(id: string, patch: Partial<ChatMessage>): Promise<void> {
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

export async function exportAllData(): Promise<string> {
  const db = await getDB();
  const conversations = await db.getAll("conversations");
  const messages = await db.getAll("messages");
  const settings = await db.getAll("settings");
  return JSON.stringify({ conversations, messages, settings, exportedAt: Date.now() }, null, 2);
}

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  await db.clear("conversations");
  await db.clear("messages");
  await db.clear("settings");
}
