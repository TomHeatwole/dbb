import { logUsage } from './database';

async function fetchIp(timeoutMs = 1500) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    // Use a simple public IP service; falls back to null on failure
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(t);
    if (!res || !res.ok) { return null; }
    const json = await res.json();
    return json && json.ip ? String(json.ip) : null;
  } catch (_) {
    return null;
  }
}

export async function trackPageLoad() {
  try {
    const path = window && window.location ? (window.location.pathname + (window.location.search || '')) : '';
    const ip = await fetchIp();
    await logUsage({ path, ip, ts: Date.now() });
  } catch (_) {
    // no-op
  }
}
