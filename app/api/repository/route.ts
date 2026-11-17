import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/http";
import { cachedFeed } from "@/lib/feedCache";
import { repoInfo, REPO_RE, type RepoInfo } from "@/lib/github";

// GET /api/repository?repo=owner/repo[&refresh=1]
// Counts and the newest open pull requests and issues of a GitHub repository.
// Cached like the feeds: three GitHub calls per fresh answer.
export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  const repo = request.nextUrl.searchParams.get("repo") ?? "";
  if (!REPO_RE.test(repo)) return NextResponse.json({ error: "Missing or invalid repo" }, { status: 400 });
  const force = request.nextUrl.searchParams.get("refresh") === "1";
  try {
    return NextResponse.json(await cachedFeed<RepoInfo>(`repo|${repo.toLowerCase()}`, () => repoInfo(repo), force));
  } catch (err) {
    return NextResponse.json({ error: String((err as Error)?.message ?? err) }, { status: 502 });
  }
}
