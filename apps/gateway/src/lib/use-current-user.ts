"use client";

import { useEffect, useState } from "react";

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  /** "free" | "pro" (SCRUM-231); absent from older cached responses. */
  plan?: string;
}

let cached: CurrentUser | null | undefined;
let inflight: Promise<CurrentUser | null> | null = null;
const subscribers = new Set<(u: CurrentUser | null) => void>();

function notify(u: CurrentUser | null) {
  cached = u;
  for (const fn of subscribers) fn(u);
}

async function load(): Promise<CurrentUser | null> {
  if (inflight) return inflight;
  inflight = fetch("/api/me")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const user: CurrentUser | null = data?.user ?? null;
      notify(user);
      return user;
    })
    .catch(() => {
      notify(null);
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Shared current-user state. First call fetches `/api/me`; subsequent
 * callers receive the cached value. Components subscribe so identity
 * propagates once it arrives.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(cached ?? null);

  useEffect(() => {
    subscribers.add(setUser);
    if (cached === undefined) {
      void load();
    } else {
      setUser(cached);
    }
    return () => {
      subscribers.delete(setUser);
    };
  }, []);

  return user;
}
