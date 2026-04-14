export async function getItem(key: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/settings?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.value ?? null;
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  } catch {}
}

export async function removeItem(key: string): Promise<void> {
  try {
    await fetch(`/api/settings?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
  } catch {}
}
