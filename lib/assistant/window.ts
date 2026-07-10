// Window a long text body so it never floods the model's context. With `find`,
// return the sections matching the keywords (±context, merged); otherwise return
// the requested ~READ_CAP-char page with a header saying how to read further.

const READ_CAP = 6000;

export function windowMarkdown(md: string, find?: string, page?: number): { header: string; text: string } {
  const total = md.length;
  if (total <= READ_CAP && !find) return { header: "", text: md };

  if (find && find.trim()) {
    const needle = find.trim().toLowerCase();
    const hay = md.toLowerCase();
    const W = 600; // context chars on each side of a match
    const ranges: [number, number][] = [];
    let idx = hay.indexOf(needle);
    while (idx !== -1 && ranges.length < 25) {
      ranges.push([Math.max(0, idx - W), Math.min(total, idx + needle.length + W)]);
      idx = hay.indexOf(needle, idx + needle.length);
    }
    if (!ranges.length) {
      return { header: `No matches for "${find}" in this note (${total} chars). Try another keyword, or read it by page (page=1).`, text: "" };
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push(r);
    }
    let out = "";
    let shown = 0;
    for (const [a, b] of merged) {
      const seg = `${a > 0 ? "…" : ""}${md.slice(a, b)}${b < total ? "…" : ""}`;
      if (out.length + seg.length > READ_CAP) break;
      out += seg + "\n";
      shown++;
    }
    return { header: `${ranges.length} match(es) for "${find}" in this note (${total} chars); showing ${shown} section(s):`, text: out.trim() };
  }

  const pages = Math.max(1, Math.ceil(total / READ_CAP));
  const p = Math.min(Math.max(1, Math.floor(page || 1)), pages);
  const slice = md.slice((p - 1) * READ_CAP, p * READ_CAP);
  const more = p < pages
    ? ` — for the next part call the same tool again with page=${p + 1}, or find="keyword" to jump to a section`
    : " (final part)";
  return { header: `Part ${p} of ${pages} (${total} chars total)${more}:`, text: slice };
}
