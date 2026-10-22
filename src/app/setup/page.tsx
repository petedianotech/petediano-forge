"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, ExternalLink } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [geminiKey, setGeminiKey] = useState("");
  const [githubPat, setGithubPat] = useState("");
  const [showGemini, setShowGemini] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geminiOk, setGeminiOk] = useState(false);
  const [githubOk, setGithubOk] = useState(false);

  async function validateAndSave(which: "gemini" | "github" | "both") {
    setLoading(true);
    setError(null);
    try {
      const body: { geminiKey?: string; githubPat?: string } = {};
      if (which === "gemini" || which === "both") body.geminiKey = geminiKey;
      if (which === "github" || which === "both") body.githubPat = githubPat;

      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || data.details?.join?.(" ") || "Validation failed");
        return;
      }

      if (data.gemini) setGeminiOk(true);
      if (data.github) setGithubOk(true);

      if (which === "gemini" && data.gemini) {
        setStep(2);
      } else if (which === "github" && data.github) {
        router.replace("/workspace");
      } else if (which === "both" && data.gemini && data.github) {
        router.replace("/workspace");
      }

      if (data.warnings?.length) {
        setError(data.warnings.join("; "));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[var(--bg-app)]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4285F4] to-[#3DDC97] mb-4 shadow-lg">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M8 22V10l8 6 8-6v12" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M8 10h16" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">Petediano Forge</h1>
          <p className="text-[var(--text-secondary)] mt-1">Describe it. Build it. Ship it.</p>
        </div>

        <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className={`flex-1 h-1 rounded-full ${step >= 1 ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />
            <div className={`flex-1 h-1 rounded-full ${step >= 2 ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />
          </div>

          {step === 1 && (
            <>
              <h2 className="text-lg font-medium mb-1">Google Antigravity</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Enter your Gemini API key from{" "}
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--primary)] inline-flex items-center gap-0.5 hover:underline"
                >
                  Google AI Studio <ExternalLink className="w-3 h-3" />
                </a>
              </p>

              <div className="relative mb-4">
                <input
                  type={showGemini ? "text" : "password"}
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIza..."
                  className="w-full h-11 px-3 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowGemini(!showGemini)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {showGemini ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {geminiOk && (
                <div className="flex items-center gap-2 text-sm text-[var(--accent-teal)] mb-4">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </div>
              )}

              <button
                onClick={() => validateAndSave("gemini")}
                disabled={!geminiKey || loading}
                className="w-full h-11 rounded-lg bg-[var(--primary)] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:brightness-105 transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Validating…" : "Validate & Continue"}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-medium mb-1">GitHub</h2>
              <p className="text-sm text-[var(--text-secondary)] mb-4">
                Create a fine-grained personal access token with Contents and Pull requests read/write for the repos you want to manage.{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--primary)] inline-flex items-center gap-0.5 hover:underline"
                >
                  Create token <ExternalLink className="w-3 h-3" />
                </a>
              </p>

              <div className="relative mb-4">
                <input
                  type={showGithub ? "text" : "password"}
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  placeholder="github_pat_... or ghp_..."
                  className="w-full h-11 px-3 pr-10 rounded-lg border border-[var(--border)] bg-[var(--bg-app)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowGithub(!showGithub)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {showGithub ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {githubOk && (
                <div className="flex items-center gap-2 text-sm text-[var(--accent-teal)] mb-4">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                </div>
              )}

              <button
                onClick={() => validateAndSave("github")}
                disabled={!githubPat || loading}
                className="w-full h-11 rounded-lg bg-[var(--primary)] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:brightness-105 transition"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {loading ? "Validating…" : "Connect & Open Workspace"}
              </button>

              <button
                onClick={() => setStep(1)}
                className="w-full mt-3 h-10 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                Back
              </button>
            </>
          )}

          {error && (
            <div className="mt-4 flex items-start gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-center text-[var(--text-secondary)] mt-6">
          Credentials are stored only in secure HttpOnly cookies on this device and never sent to any third party except Google and GitHub APIs.
        </p>
      </div>
    </div>
  );
}
