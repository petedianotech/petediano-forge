"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    async function check() {
      try {
        const res = await fetch("/api/auth/status");
        const data = await res.json();
        if (data.gemini && data.github) {
          router.replace("/workspace");
        } else {
          router.replace("/setup");
        }
      } catch {
        router.replace("/setup");
      } finally {
        setChecking(false);
      }
    }
    check();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-app)]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--border)] border-t-[var(--primary)]" />
        <p className="text-[var(--text-secondary)]">
          {checking ? "Loading Petediano Forge…" : "Redirecting…"}
        </p>
      </div>
    </div>
  );
}
