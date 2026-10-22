import { NextRequest, NextResponse } from "next/server";
import { requireGitHubPat } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const pat = await requireGitHubPat();
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") ?? "";
    const page = searchParams.get("page") ?? "1";

    const url = q
      ? `https://api.github.com/user/repos?per_page=50&page=${page}&sort=updated`
      : `https://api.github.com/user/repos?per_page=50&page=${page}&sort=updated`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `GitHub API error: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    const repos = await res.json();
    // Simple client-side filter if q provided
    const filtered = q
      ? repos.filter((r: { full_name: string; name: string }) =>
          r.full_name.toLowerCase().includes(q.toLowerCase()) ||
          r.name.toLowerCase().includes(q.toLowerCase())
        )
      : repos;

    return NextResponse.json({
      repos: filtered.map((r: any) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        default_branch: r.default_branch,
        description: r.description,
        html_url: r.html_url,
        owner: {
          login: r.owner.login,
          avatar_url: r.owner.avatar_url,
        },
      })),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to list repositories";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
