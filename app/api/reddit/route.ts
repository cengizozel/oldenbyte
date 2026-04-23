import { NextRequest, NextResponse } from "next/server";

const UA = "oldenbyte/1.0";

export async function GET(request: NextRequest) {
  const subreddit = request.nextUrl.searchParams.get("subreddit");
  const period    = request.nextUrl.searchParams.get("period") ?? "week";
  const limit     = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "5"), 25);

  if (!subreddit) return NextResponse.json({ error: "Missing subreddit" }, { status: 400 });

  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/top.json?t=${period}&limit=${limit}`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) throw new Error(`Reddit ${res.status}`);

    const json = await res.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const posts = (json.data?.children ?? []).map((child: any) => ({
      title:     child.data.title,
      link:      `https://www.reddit.com${child.data.permalink}`,
      pubDate:   new Date(child.data.created_utc * 1000).toISOString(),
      score:     child.data.score as number,
      subreddit: child.data.subreddit as string,
      content:   child.data.selftext_html ?? "",
    }));

    return NextResponse.json(posts);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
