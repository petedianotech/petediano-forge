import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setCredentialCookies } from "@/lib/auth";
import { GoogleGenAI } from "@google/genai";

const bodySchema = z.object({
  geminiKey: z.string().min(10).optional(),
  githubPat: z.string().min(10).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const body = bodySchema.parse(json);

    if (!body.geminiKey && !body.githubPat) {
      return NextResponse.json(
        { error: "At least one credential is required" },
        { status: 400 }
      );
    }

    const results: { gemini?: boolean; github?: boolean; errors: string[] } = {
      errors: [],
    };

    if (body.geminiKey) {
      try {
        const client = new GoogleGenAI({ apiKey: body.geminiKey });
        // Lightweight validation: list models or a tiny interaction attempt
        // Using a minimal call that should succeed if the key has access
        await client.models.list();
        results.gemini = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Invalid Gemini API key";
        results.errors.push(`Gemini: ${msg}`);
        results.gemini = false;
      }
    }

    if (body.githubPat) {
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${body.githubPat}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        results.github = true;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Invalid GitHub token";
        results.errors.push(`GitHub: ${msg}`);
        results.github = false;
      }
    }

    if (results.errors.length > 0 && !results.gemini && !results.github) {
      return NextResponse.json(
        { error: "Validation failed", details: results.errors },
        { status: 400 }
      );
    }

    const res = NextResponse.json({
      ok: true,
      gemini: results.gemini ?? null,
      github: results.github ?? null,
      warnings: results.errors,
    });

    return setCredentialCookies(
      res,
      results.gemini ? body.geminiKey : undefined,
      results.github ? body.githubPat : undefined
    );
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.errors }, { status: 400 });
    }
    console.error("Setup error", e);
    return NextResponse.json({ error: "Setup failed" }, { status: 500 });
  }
}
