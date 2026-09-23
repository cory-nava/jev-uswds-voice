"use client";
/**
 * Auth provider interface. The app ships with a mock provider for dev mode;
 * Login.gov and id.me are supported as drop-in providers once configured —
 * see README "Authentication providers".
 */
import { useEffect, useState } from "react";

export interface User {
  email: string;
  name?: string;
}

export interface AuthProvider {
  /** Stable id: "mock" | "logingov" | "idme" */
  id: string;
  /** Display label for the sign-in page. */
  label: string;
  signIn(email: string): Promise<User>;
  signOut(): Promise<void>;
  getUser(): User | null;
}

const STORAGE_KEY = "jev-uswds-voice:user";

export class MockAuthProvider implements AuthProvider {
  id = "mock";
  label = "Mock provider (dev mode)";

  async signIn(email: string): Promise<User> {
    const user = { email };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } catch { /* private mode */ }
    return user;
  }

  async signOut(): Promise<void> {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* noop */ }
  }

  getUser(): User | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as User) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Login.gov provider (stub). Login.gov is a standard OIDC identity provider:
 *   issuer: https://secure.login.gov
 *   discovery: https://secure.login.gov/.well-known/openid-configuration
 * To enable: create an OIDC client at https://dashboard.login.gov, then
 * implement the authorization-code flow (PKCE) here — redirect to the
 * authorization endpoint, exchange the code at the token endpoint, and
 * return the profile email. Until then, signIn explains what is missing.
 */
export class LoginGovProvider implements AuthProvider {
  id = "logingov";
  label = "Login.gov";
  constructor(private opts: { clientId?: string; redirectUri?: string } = {}) {
    void this.opts;
  }
  async signIn(): Promise<User> {
    throw new Error(
      "Login.gov is not configured. Create an OIDC client at https://dashboard.login.gov, " +
        "then wire the authorization-code + PKCE flow in lib/auth.tsx (LoginGovProvider)."
    );
  }
  async signOut(): Promise<void> {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }
  getUser(): User | null {
    return new MockAuthProvider().getUser();
  }
}

/**
 * id.me provider (stub). id.me supports OIDC/OAuth2 for verified identity:
 *   discovery: https://api.id.me/.well-known/openid-configuration
 * To enable: register an application at https://developers.id.me, then
 * implement the OAuth2 authorization-code flow here. Until then, signIn
 * explains what is missing.
 */
export class IdMeProvider implements AuthProvider {
  id = "idme";
  label = "ID.me";
  constructor(private opts: { clientId?: string; redirectUri?: string } = {}) {
    void this.opts;
  }
  async signIn(): Promise<User> {
    throw new Error(
      "ID.me is not configured. Register an application at https://developers.id.me, " +
        "then wire the OAuth2 authorization-code flow in lib/auth.tsx (IdMeProvider)."
    );
  }
  async signOut(): Promise<void> {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }
  getUser(): User | null {
    return new MockAuthProvider().getUser();
  }
}

/** Active provider. Swap `new MockAuthProvider()` for a configured
 *  `new LoginGovProvider({...})` / `new IdMeProvider({...})` to go live. */
export const auth: AuthProvider =
  process.env.NEXT_PUBLIC_AUTH_PROVIDER === "logingov"
    ? new LoginGovProvider()
    : process.env.NEXT_PUBLIC_AUTH_PROVIDER === "idme"
      ? new IdMeProvider()
      : new MockAuthProvider();

export function useAuthUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { setUser(auth.getUser()); }, []);
  return user;
}
