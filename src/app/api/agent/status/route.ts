import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireGeminiKey } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const apiKey = await requireGeminiKey();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const client = new GoogleGenAI({ apiKey });
    const interaction = await client.interactions.get(id);

    const status = (interaction as any).status ?? "unknown";
    const outputText =
      (interaction as any).output_text ??
      (interaction as any).outputText ??
      null;
    const steps = (interaction as any).steps ?? [];
    const environmentId =
      (interaction as any).environment_id ??
      (interaction as any).environmentId ??
      null;
    const usage = (interaction as any).usage ?? null;
    const error = (interaction as any).error ?? null;

    return NextResponse.json({
      id: interaction.id,
      status,
      output_text: outputText,
      steps,
      environment_id: environmentId,
      usage,
      error,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to get interaction status";
    console.error("Status error", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
