"use client";
/**
 * Profile page (CRUD). The form layout comes from the voice-built spec;
 * this wrapper persists edits to localStorage in dev mode.
 */
import { useEffect, useState } from "react";
import { SpecCanvas } from "@/lib/registry";
import { useAuthUser } from "@/lib/auth";
import type { PageSpec } from "@/lib/spec";

const PROFILE_KEY = "jev-uswds-voice:profile";

export default function ProfilePage() {
  const [page, setPage] = useState<PageSpec | null>(null);
  const [saved, setSaved] = useState(false);
  const user = useAuthUser();

  useEffect(() => {
    fetch("/api/pages")
      .then((r) => r.json())
      .then((d) => setPage((d.pages as PageSpec[]).find((p) => p.pageId === "profile") ?? null))
      .catch(() => undefined);
  }, []);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const obj: Record<string, string> = {};
    fd.forEach((v, k) => { obj[k] = String(v); });
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(obj));
    } catch { /* noop */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const onClick = (e: React.MouseEvent<HTMLFormElement>) => {
    const btn = (e.target as HTMLElement).closest("button");
    if (!btn) return;
    if (/cancel/i.test(btn.textContent || "")) {
      e.currentTarget.reset();
      return;
    }
    e.currentTarget.requestSubmit();
  };

  return (
    <>
      <div className="grid-container padding-y-1">
        {user && <p className="usa-hint margin-0">Signed in as {user.email} (dev-mode mock)</p>}
        {saved && <p className="text-success-dark margin-0">Profile saved.</p>}
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
