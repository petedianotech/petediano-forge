import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { GoogleGenAI } from "@google/genai";
import { requireGeminiKey, getGitHubPat } from "@/lib/auth";

const bodySchema = z.object({
  input: z.string().min(1).max(100_000),
  mode: z.enum(["ask", "plan", "implement"]).default("implement"),
  deliveryMode: z.enum(["pr", "direct"]).default("pr"),
  repository: z
    .object({
      owner: z.string(),
      name: z.string(),
      fullName: z.string(),
      defaultBranch: z.string(),
    })
    .optional(),
  previousInteractionId: z.string().optional(),
  environmentId: z.string().optional(),
  maxTotalTokens: z.number().int().min(1000).max(2_000_000).optional(),
  background: z.boolean().default(true),
});

function buildSystemInstruction(
  mode: string,
  delivery: string,
  repo?: { fullName: string; defaultBranch: string }
) {
  const parts: string[] = [
    "You are a professional coding agent operating inside a secure remote Linux sandbox.",
    "Be precise, show real results, never invent test outcomes or commit hashes.",
  ];

  if (mode === "ask") {
    parts.push(
      "MODE: ASK ONLY. Inspect and explain code. Do not modify any files, do not run mutating git commands, do not push."
    );
  } else if (mode === "plan") {
    parts.push(
      "MODE: PLAN ONLY. Analyse the task and return a clear implementation plan. Do not modify files or push changes."
    );
  } else {
    parts.push(
      "MODE: IMPLEMENT. Make the required code changes, run appropriate checks (tests, lint, typecheck, build) when sensible, then deliver the result."
    );
    if (delivery === "pr") {
      parts.push(
        "Default delivery: create a descriptive feature branch, commit, push, and open a pull request against the default branch. Report the branch name, commit SHA, changed files, and PR URL."
      );
    } else {
      parts.push(
        "Delivery: commit directly. If targeting the default branch, be extra careful and confirm the change is intentional."
      );
    }
  }

  if (repo) {
    parts.push(
      `Selected repository: ${repo.fullName} (default branch: ${repo.defaultBranch}). The repository is already available in the workspace.`
    );
  }

  parts.push(
    "Never force-push, never delete branches, never expose secrets, never claim success without evidence from the tools.",
    "When finished, provide a structured summary of what was done, files changed, tests run and their real outcomes, and any GitHub links."
  );

  return parts.join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = await requireGeminiKey();
    const json = await req.json();
    const body = bodySchema.parse(json);

    const client = new GoogleGenAI({ apiKey });

    let environment: any = body.environmentId ?? "remote";

    if (!body.environmentId && body.repository) {
      const githubPat = await getGitHubPat();
      const sources = [
        {
          type: "repository",
          source: `https://github.com/${body.repository.fullName}`,
          target: `/workspace/${body.repository.name}`,
        },
      ];

      const network: any = {
        allowlist: [{ domain: "*" }],
      };

      if (githubPat) {
        try {
          const credId = "github-forge-pat";
          try {
            await (client as any).credentials.create({
              id: credId,
              type: "bearer_token",
              token: githubPat,
            });
          } catch {
            // already exists
          }
          network.allowlist = [
            { domain: "api.github.com", credential: credId },
            { domain: "github.com", credential: credId },
            { domain: "*" },
          ];
        } catch (e) {
          console.warn("Credential registration failed", e);
        }
      }

      environment = {
        type: "remote",
        sources,
        network,
      };
    }

    const systemInstruction = buildSystemInstruction(
      body.mode,
      body.deliveryMode,
      body.repository
    );

    const createParams: any = {
      agent: "antigravity-preview-09-2026",
      input: body.input,
      environment,
      background: body.background,
      system_instruction: systemInstruction,
    };

    if (body.previousInteractionId) {
      createParams.previous_interaction_id = body.previousInteractionId;
    }

    if (body.maxTotalTokens) {
      createParams.agent_config = {
        type: "antigravity",
        max_total_tokens: String(body.maxTotalTokens),
      };
    }

    const interaction = await client.interactions.create(createParams);

    return NextResponse.json({
      id: interaction.id,
      environment_id:
        (interaction as any).environment_id ??
        (interaction as any).environmentId,
      status: (interaction as any).status ?? "in_progress",
      output_text: (interaction as any).output_text ?? null,
    });
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request", details: e.errors },
        { status: 400 }
      );
    }
    const msg = e instanceof Error ? e.message : "Agent interaction failed";
    console.error("Interact error", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
