import posthog from "posthog-js";

const KEY = import.meta.env.VITE_POSTHOG_KEY;
const HOST = import.meta.env.VITE_POSTHOG_HOST ?? "/ingest";

let initialized = false;

export function initPosthog(): void {
  if (initialized || !KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    ui_host: "https://eu.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    person_profiles: "identified_only",
  });
  initialized = true;
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

/** Stable per-browser id so backend events can be joined to the same person. */
export function distinctId(): string {
  if (!initialized) return "photogrid-anon";
  return posthog.get_distinct_id() ?? "photogrid-anon";
}
