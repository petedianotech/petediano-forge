import { NextRequest, NextResponse } from "next/server";
import { clearCredentialCookies } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const which = (body as { which?: string }).which ?? "all";

  const res = NextResponse.json({ ok: true });

  if (which === "all" || which === "gemini" || which === "github") {
    // clear both for simplicity; can be more granular later
    clearCredentialCookies(res);
  }

  return res;
}
