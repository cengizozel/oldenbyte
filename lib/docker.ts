import http from "http";
import { existsSync } from "fs";

// Reads the container list from Docker for the Docker widget. Off unless the
// operator connects it, one of two ways (docs/widgets/docker.md):
//   - mount the socket into the container: /var/run/docker.sock (read-only);
//   - or set DOCKER_HOST=tcp://host:2375 to a socket proxy that only allows
//     listing containers (the safer way: the raw socket is root on the host).
// Only GET /containers/json is ever called.

export type Container = { id: string; name: string; image: string; state: string; status: string };

export function dockerTarget(): { socketPath: string } | { host: string; port: number } | null {
  const host = process.env.DOCKER_HOST ?? "";
  const tcp = host.match(/^(?:tcp|http):\/\/([^:/]+):(\d+)/);
  if (tcp) return { host: tcp[1], port: Number(tcp[2]) };
  const socketPath = host.startsWith("unix://") ? host.slice(7) : process.env.DOCKER_SOCKET ?? "/var/run/docker.sock";
  return existsSync(socketPath) ? { socketPath } : null;
}

// Docker's JSON to the fields the widget shows. Exported for tests.
export function mapContainers(raw: unknown): Container[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(c => ({
    id: String(c?.Id ?? "").slice(0, 12),
    name: String(c?.Names?.[0] ?? c?.Id ?? "").replace(/^\//, ""),
    image: String(c?.Image ?? ""),
    state: String(c?.State ?? "unknown"),
    status: String(c?.Status ?? ""),
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function listContainers(): Promise<Container[]> {
  const target = dockerTarget();
  if (!target) return Promise.reject(Object.assign(new Error("Docker is not connected"), { code: "NOT_CONNECTED" }));
  return new Promise((resolve, reject) => {
    const req = http.request({ ...target, path: "/containers/json?all=1", method: "GET", timeout: 6000 }, res => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (d: Buffer) => { size += d.length; if (size > 4 * 1024 * 1024) { req.destroy(new Error("Response too large")); return; } chunks.push(d); });
      res.on("end", () => {
        if (res.statusCode !== 200) { reject(new Error(`Docker answered HTTP ${res.statusCode}`)); return; }
        try { resolve(mapContainers(JSON.parse(Buffer.concat(chunks).toString("utf8")))); } catch { reject(new Error("Unreadable answer from Docker")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Docker did not answer")));
    req.on("error", reject);
    req.end();
  });
}
