"use client";
/**
 * Sign-in page. Layout comes from the voice-built spec; this wrapper adds
 * the (mocked, dev-mode) auth behavior via the AuthProvider interface.
 * Swap the provider in lib/auth.tsx for Login.gov / ID.me.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SpecCanvas } from "@/lib/registry";
import { auth } from "@/lib/auth";
import type { PageSpec } from "@/lib/spec";

export default function SignInPage() {
  const [page, setPage] = useState<PageSpec | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d) => setPage((d.pages as PageSpec[]).find((p) => p.pageId === "signin") ?? null))
      .catch(() => setError("Could not load the sign-in spec."));
  }, []);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email") || fd.get("username") || "demo@example.gov");
    try {
      await auth.signIn(email);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Only sign-in style buttons submit; links ("Create an account") navigate as usual.
  const onClick = (e: React.MouseEvent<HTMLFormElement>) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (btn && /sign ?in|log ?in|continue|submit/i.test(btn.textContent || "")) e.currentTarget.requestSubmit();
  };

  return (
    <>
      <div className="grid-container padding-y-1">
        <p className="usa-hint margin-0">Auth provider: {auth.label}</p>
        {error && <p className="text-error margin-0">{error}</p>}
        {!page && <p>Loading…</p>}
      </div>
      {page && (
        <form onSubmit={onSubmit} onClick={onClick}>
          <SpecCanvas page={page} />
        </form>
      )}
    </>
  );
}
