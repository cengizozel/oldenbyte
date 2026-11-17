import { safeFetch, readCappedText } from "@/lib/ssrf";

// A GitHub repository at a glance, for the Repository widget: its counts and
// its newest open pull requests and issues. Public API, no key needed; the
// server's GITHUB_TOKEN, when set, lifts the anonymous limit of 60 calls an
// hour (and reaches private repositories the token can see).

export type RepoItem = { number: number; title: string; url: string; at: string; user: string };
export type RepoInfo = {
  name: string;          // owner/repo, as GitHub spells it
  description: string;
  url: string;
  stars: number;
  forks: number;
  issues: number;        // open issues, pull requests not counted
  pulls: number;         // open pull requests
  pushedAt: string;
  archived: boolean;
  openPulls: RepoItem[];
  openIssues: RepoItem[];
};

export const REPO_RE = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/* eslint-disable @typescript-eslint/no-explicit-any */

// GitHub's search items to rows. Exported for tests.
export function mapItems(items: unknown): RepoItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((i: any) => ({
    number: Number(i?.number) || 0,
    title: String(i?.title ?? ""),
    url: String(i?.html_url ?? ""),
    at: String(i?.created_at ?? ""),
    user: String(i?.user?.login ?? ""),
  })).filter(i => i.number && i.title);
}

// The three answers to one RepoInfo. Exported for tests.
export function mapRepo(repo: any, pulls: any, issues: any): RepoInfo {
  return {
    name: String(repo?.full_name ?? ""),
    description: String(repo?.description ?? ""),
    url: String(repo?.html_url ?? ""),
    stars: Number(repo?.stargazers_count) || 0,
    forks: Number(repo?.forks_count) || 0,
    issues: Number(issues?.total_count) || 0,
    pulls: Number(pulls?.total_count) || 0,
    pushedAt: String(repo?.pushed_at ?? ""),
    archived: repo?.archived === true,
    openPulls: mapItems(pulls?.items),
    openIssues: mapItems(issues?.items),
  };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

async function gh(path: string): Promise<unknown> {
  const headers: Record<string, string> = { "User-Agent": "oldenbyte-dashboard", Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await safeFetch(`https://api.github.com${path}`, { headers, timeoutMs: 10_000 });
  if (res.status === 404) throw new Error("GitHub has no such repository.");
  if (res.status === 403 || res.status === 429) throw new Error("GitHub's hourly limit for this server is used up. It resets within the hour.");
  if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}.`);
  return JSON.parse(await readCappedText(res, 2 * 1024 * 1024));
}

export async function repoInfo(repo: string): Promise<RepoInfo> {
  const q = (kind: "pr" | "issue") => `/search/issues?q=${encodeURIComponent(`repo:${repo} is:${kind} is:open`)}&per_page=8&sort=created&order=desc`;
  // The search answers carry both the total and the newest few, one call each.
  const [info, pulls, issues] = await Promise.all([gh(`/repos/${repo}`), gh(q("pr")), gh(q("issue"))]);
  return mapRepo(info, pulls, issues);
}
