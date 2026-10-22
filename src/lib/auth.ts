import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const GEMINI_COOKIE = "pf_gemini_key";
const GITHUB_COOKIE = "pf_github_pat";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const isProd = process.env.NODE_ENV === "production";

export async function getGeminiKey(): Promise<string | null> {
  const store = await cookies();
  return store.get(GEMINI_COOKIE)?.value ?? process.env.GEMINI_API_KEY ?? null;
}

export async function getGitHubPat(): Promise<string | null> {
  const store = await cookies();
  return store.get(GITHUB_COOKIE)?.value ?? process.env.GITHUB_PAT ?? null;
}

export function setCredentialCookies(
  res: NextResponse,
  geminiKey?: string,
  githubPat?: string
) {
  const opts = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE,
  };

  if (geminiKey) {
    res.cookies.set(GEMINI_COOKIE, geminiKey, opts);
  }
  if (githubPat) {
    res.cookies.set(GITHUB_COOKIE, githubPat, opts);
  }
  return res;
}

export function clearCredentialCookies(res: NextResponse) {
  const opts = {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
  res.cookies.set(GEMINI_COOKIE, "", opts);
  res.cookies.set(GITHUB_COOKIE, "", opts);
  return res;
}

export async function requireGeminiKey(): Promise<string> {
  const key = await getGeminiKey();
  if (!key) {
    throw new Error("Gemini API key not configured. Complete setup first.");
  }
  return key;
}

export async function requireGitHubPat(): Promise<string> {
  const pat = await getGitHubPat();
  if (!pat) {
    throw new Error("GitHub PAT not configured. Complete setup first.");
  }
  return pat;
}
