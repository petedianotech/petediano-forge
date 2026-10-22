import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { requireGeminiKey } from "@/lib/auth";

/**
 * Poll interaction status.
 * SDK >= 2.0 returns the steps schema (not legacy outputs).
 * Prefer interaction.output_text helper; fall back to extracting text from steps.
 */
function extractOutputText(interaction: Record<string, unknown>): string | null {
  if (typeof interaction.output_text === "string" && interaction.output_text) {
    return interaction.output_text;
  }
  if (typeof interaction.outputText === "string" && interaction.outputText) {
    return interaction.outputText;
  }

  const steps = interaction.steps;
  if (!Array.isArray(steps)) return null;

  const texts: string[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const s = step as Record<string, unknown>;
    if (s.type === "model_output" && Array.isArray(s.content)) {
      for (const part of s.content) {
        if (
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "text" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          texts.push((part as Record<string, unknown>).text as string);
        }
      }
    }
  }
  return texts.length ? texts.join("\n") : null;
}

export async function GET(req: NextRequest) {
  try {
    const apiKey = await requireGeminiKey();
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const client = new GoogleGenAI({ apiKey });
    const interaction = (await client.interactions.get(id)) as Record<
      string,
      unknown
    >;

    const status = (interaction.status as string) ?? "unknown";
    const outputText = extractOutputText(interaction);
    const steps = Array.isArray(interaction.steps) ? interaction.steps : [];
    const environmentId =
      (interaction.environment_id as string | undefined) ??
      (interaction.environmentId as string | undefined) ??
      null;
    const usage = interaction.usage ?? null;
    const error = interaction.error ?? null;

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
    const msg =
      e instanceof Error ? e.message : "Failed to get interaction status";
    console.error("Status error", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
