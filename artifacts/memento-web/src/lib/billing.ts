const API_BASE = "/api";

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    credentials: "include",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      (data as { error?: string })?.error ?? `HTTP ${res.status}`,
    );
  }
  return data as T;
}

export async function createCheckoutSession(
  plan: "pro" | "vendor",
): Promise<string> {
  const { url } = await apiFetch<{ url: string }>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });
  return url;
}

export async function createPortalSession(): Promise<string> {
  const { url } = await apiFetch<{ url: string }>("/billing/portal", {
    method: "POST",
  });
  return url;
}

export async function redirectToCheckout(plan: "pro" | "vendor"): Promise<void> {
  const url = await createCheckoutSession(plan);
  window.location.href = url;
}

export async function redirectToPortal(): Promise<void> {
  const url = await createPortalSession();
  window.location.href = url;
}
