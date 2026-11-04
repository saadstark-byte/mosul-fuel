// Downloads every app file into the phone's cache (with progress), and checks for updates when online.
"use strict";

const Offline = {
  CACHE: "mfuel-data",

  async register() {
    if (!("serviceWorker" in navigator)) return false;
    try {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      return true;
    } catch (e) {
      console.warn("Service worker failed", e);
      return false;
    }
  },

  async installed() {
    if (!("caches" in window)) return null;
    const cache = await caches.open(this.CACHE);
    const res = await cache.match("files.json");
    return res ? res.json() : null;
  },

  async latest() {
    const res = await fetch(`files.json?fresh=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("files.json " + res.status);
    return res.json();
  },

  // Brings the cache up to date. onProgress(doneBytes, totalBytes). Returns {version, changed}.
  async sync(onProgress) {
    const cache = await caches.open(this.CACHE);
    const latest = await this.latest();
    const old = await this.installed();
    const oldHash = new Map((old?.files || []).map((f) => [f.path, f.hash]));
    const todo = [];
    for (const f of latest.files) {
      const have = oldHash.get(f.path) === f.hash && (await cache.match(f.path));
      if (!have) todo.push(f);
    }
    const total = todo.reduce((a, f) => a + f.size, 0);
    let done = 0;
    onProgress?.(0, total);
    const queue = todo.slice();
    const worker = async () => {
      while (queue.length) {
        const f = queue.shift();
        const res = await fetch(`${encodeURI(f.path)}?fresh=${f.hash}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`${f.path}: ${res.status}`);
        const blob = await res.blob();
        await cache.put(f.path, new Response(blob, { headers: { "Content-Type": res.headers.get("Content-Type") || "application/octet-stream" } }));
        done += f.size;
        onProgress?.(done, total);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await cache.put("files.json", new Response(JSON.stringify(latest), { headers: { "Content-Type": "application/json" } }));
    // remove files that are no longer part of the app
    const keep = new Set(latest.files.map((f) => new URL(f.path, location.href).href));
    keep.add(new URL("files.json", location.href).href);
    for (const req of await cache.keys()) if (!keep.has(req.url)) await cache.delete(req);
    try { await navigator.storage?.persist?.(); } catch {}
    return { version: latest.version, changed: todo.length > 0, wasInstalled: !!old, codeChanged: todo.some((f) => /\.(js|css|html)$/.test(f.path)) };
  },
};
