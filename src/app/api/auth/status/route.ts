import { NextResponse } from "next/server";
import { getGeminiKey, getGitHubPat } from "@/lib/auth";

export async function GET() {
  const gemini = !!(await getGeminiKey());
  const github = !!(await getGitHubPat());
  return NextResponse.json({ gemini, github });
}
