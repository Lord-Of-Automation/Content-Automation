/**
 * Pinned steps, on the engine.
 *
 * A pin is keyed by the step's name and lives on the droplet beside the runs,
 * because it is the engine that has to honour it — a pin the console remembered
 * would be a pin a scheduled run at three in the morning knew nothing about.
 */

import { backend } from "./backend";

export type Pin = {
  step: string;
  pinnedAt: string;
  /** The run the value was taken from. */
  fromRun: string;
  bytes: number;
};

export class NotOnThisBackend extends Error {}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (backend() !== "engine") {
    throw new NotOnThisBackend(
      "Pinning is an engine feature, and this deployment is pointed at n8n.",
    );
  }

  const url = process.env.ENGINE_URL?.trim();
  const token = process.env.ENGINE_TOKEN?.trim();
  if (!url || !token) throw new Error("ENGINE_URL and ENGINE_TOKEN must both be set.");

  const response = await fetch(`${url.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!response.ok) throw new Error(body?.error ?? `The engine answered ${response.status}.`);
  return body as T;
}

export async function listPins(): Promise<Pin[]> {
  const { pins } = await call<{ pins: Pin[] }>("/pins");
  return pins ?? [];
}

export async function pinStep(run: string, step: string): Promise<Pin> {
  const { pin } = await call<{ pin: Pin }>("/pins", {
    method: "POST",
    body: JSON.stringify({ run, step }),
  });
  return pin;
}

export async function unpinStep(step: string): Promise<void> {
  await call("/pins", { method: "DELETE", body: JSON.stringify({ step }) });
}
