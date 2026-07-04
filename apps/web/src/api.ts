export type Direction = "bullish" | "bearish" | "neutral";

export interface StoredSignal {
  id: number;
  skillId: string;
  ticker: string;
  direction: Direction;
  confidence: number;
  title: string;
  rationale: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface RunError {
  skill: string;
  ticker: string;
  message: string;
}

export interface RunSummary {
  skillsRun: number;
  tickers: number;
  generated: number;
  stored: number;
  deduped: number;
  errors: RunError[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only send a JSON content-type when there's actually a body — otherwise
  // Fastify rejects the empty body (e.g. POST /api/run) with 400 Bad Request.
  const headers = init?.body ? { "Content-Type": "application/json" } : undefined;
  const res = await fetch(path, { ...init, headers: { ...headers, ...init?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  watchlist: () => request<string[]>("/api/watchlist"),
  addSymbol: (symbol: string) =>
    request<{ watchlist: string[] }>("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),
  removeSymbol: (symbol: string) =>
    request<{ watchlist: string[] }>(`/api/watchlist/${encodeURIComponent(symbol)}`, {
      method: "DELETE",
    }),
  signals: (ticker?: string) =>
    request<StoredSignal[]>(`/api/signals${ticker ? `?ticker=${encodeURIComponent(ticker)}` : ""}`),
  runNow: () => request<RunSummary>("/api/run", { method: "POST" }),
};
