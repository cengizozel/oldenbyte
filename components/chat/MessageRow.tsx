"use client";

import { Fragment, memo, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Check, RefreshCw, Database, ChevronRight, CalendarDays, Brain, ChevronsRight } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { isDemoMode } from "@/lib/demo";
import { msgTime, splitThinking } from "@/lib/chat/format";
import { normalizeProposal, type ChatMessage, type Proposal, type Source } from "@/lib/chat/types";
import Markdown from "../Markdown";
import { ElapsedSeconds } from "./Timers";
import { HIT_AREA, FOCUS_RING } from "../ui/Field";
import { SmallButton } from "../ui/WidgetChrome";

// Collapsible reasoning block: auto-expands while the model is actively
// thinking, then collapses once the answer starts (unless the user toggled it).
function ThinkBlock({ content, active, labelClass }: { content: string; active: boolean; labelClass: string }) {
  const [open, setOpen] = useState(active);
  const toggled = useRef(false);
  useEffect(() => { if (!toggled.current) setOpen(active); }, [active]);
  if (!content.trim() && !active) return null;
  return (
    <div className="my-1">
      <button
        onClick={() => { toggled.current = true; setOpen(o => !o); }}
        className={`flex items-center gap-1 text-xs ${labelClass} opacity-60 hover:opacity-100 ${FOCUS_RING}`}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {/[\u{1F50E}\u{1F4D6}\u{1F4CA}\u{1F9E9}]/u.test(content)
          ? (active ? "Researching…" : "Research trail")
          : (active ? "Thinking…" : "Thinking")}
      </button>
      {open && (
        <div className="mt-1 ml-1 pl-3 border-l-2 border-black/15 dark:border-white/20 text-xs opacity-60">
          <Markdown text={content} />
        </div>
      )}
    </div>
  );
}

function AssistantBody({ content, inProgress, labelClass, sources }: { content: string; inProgress: boolean; labelClass: string; sources?: Source[] }) {
  // Map [n] to its article so the Markdown renderer makes citation chips
  // clickable. Memoized so the Markdown memo holds across renders.
  const cites = useMemo(
    () => Object.fromEntries((sources ?? []).map(s => [s.n, { url: s.url, title: s.title }])),
    [sources]
  );
  return (
    <>
      {splitThinking(content).map((seg, i) =>
        seg.type === "think"
          ? <ThinkBlock key={i} content={seg.content} active={!!seg.open && inProgress} labelClass={labelClass} />
          : (seg.content.trim() ? <Markdown key={i} text={seg.content} cites={cites} /> : null)
      )}
    </>
  );
}

// "Sources" disclosure under a reply: the articles the model actually cited.
function SourcesList({ sources, labelClass, textClass }: { sources: Source[]; labelClass: string; textClass: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 text-xs ${labelClass} opacity-60 hover:opacity-100 ${FOCUS_RING}`}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {sources.length} source{sources.length === 1 ? "" : "s"}
      </button>
      {open && (
        <ol className="mt-1 ml-1 pl-3 border-l-2 border-black/15 dark:border-white/20 flex flex-col gap-0.5">
          {sources.map(s => (
            <li key={s.n} className={`text-xs ${textClass} opacity-80`}>
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
                <span className="opacity-60">[{s.n}]</span> <span className="underline underline-offset-2">{s.title}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// Confirmation cards for the writes a reply proposed.
function ProposalCards({ proposals, c, onResolve }: { proposals: Proposal[]; c: ColorClasses; onResolve: (propIndex: number, accept: boolean) => void }) {
  return (
    <div className="flex flex-col gap-1.5 max-w-[85%]">
      {proposals.map((pr, j) => {
        const p = normalizeProposal(pr);
        const isCalendar = p.kind.startsWith("calendar");
        const isDelete = p.kind === "calendar-delete";
        const acceptLabel =
          p.kind === "calendar-create" ? "Add to calendar" :
          p.kind === "calendar-delete" ? "Delete event" :
          p.kind === "anytype-append" ? "Append to note" : "Save to Anytype";
        const doneLabel =
          p.kind === "calendar-create" ? "added to calendar" :
          p.kind === "calendar-delete" ? "deleted from calendar" :
          p.kind === "anytype-append" ? "appended to the note" : "saved to Anytype";
        const failLabel = isDemoMode()
          ? "not available in demo mode"
          : isCalendar ? "failed (check the calendar widget)" : "failed (check the Anytype bridge in settings)";
        const preview = !isCalendar && typeof p.payload.markdown === "string" ? String(p.payload.markdown) : "";
        return (
          <div key={j} className={`rounded-xl border ${c.border} bg-[var(--surface)] px-3 py-2 flex flex-col gap-1`}>
            <span className="flex items-center gap-1.5 text-xs text-[var(--text-primary)]">
              {isCalendar
                ? <CalendarDays size={12} className={`shrink-0 ${isDelete ? "text-red-500/80" : c.label}`} />
                : <Database size={12} className={`shrink-0 ${c.label}`} />}
              <span className="font-medium truncate">{p.summary}</span>
            </span>
            {p.detail && <span className="text-xs text-[var(--text-secondary)]">{p.detail}</span>}
            {preview && (
              <details className="text-xs text-[var(--text-secondary)]">
                <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">content</summary>
                <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap font-[inherit] text-xs leading-relaxed">{preview}</pre>
              </details>
            )}
            {pr.status === "pending" ? (
              <span className="flex items-center gap-2 mt-0.5">
                <button
                  onClick={() => onResolve(j, true)}
                  className={`inline-flex items-center h-7 px-2.5 text-xs text-white transition-colors ${FOCUS_RING} !rounded-lg ${isDelete ? "bg-red-600/90 hover:bg-red-600" : "bg-emerald-600/90 hover:bg-emerald-600"}`}
                >
                  {acceptLabel}
                </button>
                <SmallButton c={c} onClick={() => onResolve(j, false)}>Dismiss</SmallButton>
              </span>
            ) : (
              <span className={`text-xs ${pr.status === "added" ? "text-emerald-600 dark:text-emerald-400" : pr.status === "failed" ? "text-red-500" : "opacity-60 text-[var(--text-secondary)]"}`}>
                {pr.status === "added" ? doneLabel : pr.status === "failed" ? failLabel : "dismissed"}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Honest status under the streaming reply: residency-aware before the first
// byte, trail-aware while a think block is open (tool activity is
// "researching", chain-of-thought is "thinking"), and a quiet typing
// indicator once the answer flows.
function LiveStatus({ content, c, live }: { content: string; c: ColorClasses; live: LiveInfo }) {
  if (!content) {
    return <span className={`px-1 text-xs ${c.text} opacity-60`}>{live.waitingLabel}… <ElapsedSeconds start={live.start} active={live.active} /></span>;
  }
  const openIdx = content.lastIndexOf("<think>");
  if (openIdx > content.lastIndexOf("</think>")) {
    const tail = content.slice(openIdx);
    const researching = /\u{1F50E}|\u{1F4D6}|\u{1F4CA}|\u{1F9E9}|checking calendar|adding "/u.test(tail);
    return (
      <span className={`px-1 text-xs ${c.text} opacity-60`}>
        {researching ? "researching" : "thinking"}… <ElapsedSeconds start={live.start} active={live.active} />
      </span>
    );
  }
  return (
    <span className="px-1 flex items-center gap-1" aria-label="typing">
      {[0, 1, 2].map(j => (
        <span
          key={j}
          className={`w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-pulse ${c.text}`}
          style={{ animationDelay: `${j * 200}ms` }}
        />
      ))}
    </span>
  );
}

// Present only on the reply that is streaming right now.
export type LiveInfo = {
  waitingLabel: string; // shown before the first byte ("loading model", ...)
  start: number;        // performance.now() when the request started
  active: boolean;      // widget on screen (timers pause otherwise)
};

type Props = {
  m: ChatMessage;
  index: number;
  c: ColorClasses;
  daySep: string | null;
  canEdit: boolean;
  isLast: boolean;
  live?: LiveInfo;
  onEdit: (index: number) => void;
  onRetry: (index: number) => void;
  onContinue: (index: number) => void;
  onResolve: (index: number, propIndex: number, accept: boolean) => void;
  onOpenImage: (src: string) => void;
  onOpenMemory: () => void;
};

// One message with its attachments, cards and footer. Memoized: every prop is
// either data that changes only with this message or a stable handler, so a
// finished message does not re-render while another one streams.
function MessageRow({ m, index: i, c, daySep, canEdit, isLast, live, onEdit, onRetry, onContinue, onResolve, onOpenImage, onOpenMemory }: Props) {
  const inProgress = !!live;
  return (
    <Fragment>
      {daySep && (
        <div className="self-center my-1">
          <span className={`px-2 py-0.5 rounded-full text-[13px] font-ui opacity-60 ${c.label} bg-black/5 dark:bg-white/10`}>
            {daySep}
          </span>
        </div>
      )}
      <div className={`flex flex-col gap-0.5 group/msg ${m.role === "user" ? "items-end" : "items-start"}`}>
        {(m.images?.length ?? 0) > 0 && (
          <div className="max-w-[85%] flex flex-wrap gap-1.5 justify-end">
            {m.images!.map((src, k) => (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={k}
                src={src}
                alt="attachment"
                onClick={() => onOpenImage(src)}
                className="max-h-36 max-w-full rounded-xl border border-[var(--surface-border)] cursor-zoom-in"
              />
            ))}
          </div>
        )}
        {!(m.role === "assistant" && !m.content) && !(m.role === "user" && !m.content) && (
          <div
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words ${
              m.role === "user"
                ? "whitespace-pre-wrap bg-[var(--surface)] border border-[var(--surface-border)] text-[var(--text-primary)] shadow-sm"
                : c.text
            }`}
          >
            {m.role === "assistant" ? <AssistantBody content={m.content} inProgress={inProgress} labelClass={c.label} sources={m.sources} /> : m.content}
          </div>
        )}
        {!inProgress && m.role === "assistant" && m.sources && m.sources.length > 0 && (
          <SourcesList sources={m.sources} labelClass={c.label} textClass={c.text} />
        )}
        {!inProgress && m.role === "assistant" && (m.proposals?.length ?? 0) > 0 && (
          <ProposalCards proposals={m.proposals!} c={c} onResolve={(j, accept) => onResolve(i, j, accept)} />
        )}
        {!inProgress && m.role === "assistant" && (m.actions?.length ?? 0) > 0 && (
          <div className="flex flex-col gap-0.5 max-w-[85%] px-1">
            {m.actions!.map((a, j) => (
              <span key={j} className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check size={12} className="shrink-0" />
                <span className="truncate">{a.summary}{a.detail ? ` · ${a.detail}` : ""}</span>
              </span>
            ))}
          </div>
        )}
        {!inProgress && m.role === "assistant" && (m.memory?.length ?? 0) > 0 && (
          <button
            onClick={onOpenMemory}
            title="Open this character's memories"
            className={`flex flex-col items-start gap-0.5 px-1 text-left opacity-60 hover:opacity-100 transition-opacity ${FOCUS_RING} ${c.label}`}
          >
            {m.memory!.map((line, k) => (
              <span key={k} className="flex items-center gap-1 text-xs">
                <Brain size={12} className="shrink-0" />
                <span className="truncate max-w-[260px]">{line}</span>
              </span>
            ))}
          </button>
        )}
        {live && <LiveStatus content={m.content} c={c} live={live} />}
        <div className="flex items-center gap-2 px-1">
          {!inProgress && m.at != null && (
            <span className={`text-xs tabular-nums ${c.text} opacity-60`}>{msgTime(m.at)}</span>
          )}
          {!inProgress && m.role === "assistant" && m.stats && m.stats.tokens > 0 && (
            <span className={`text-xs ${c.text} opacity-0 group-hover/msg:opacity-60 [@media(hover:none)]:opacity-60 transition-opacity`}>
              {m.stats.tps.toFixed(1)} tok/s · {m.stats.tokens} tokens · {m.stats.total.toFixed(1)}s
              {m.stats.ttft >= 0.05 ? ` · ${m.stats.ttft.toFixed(1)}s to first` : ""}
            </span>
          )}
          {canEdit && (
            <button
              onClick={() => onEdit(i)}
              title={m.role === "user" ? "Edit message (reruns from here)" : "Edit reply"}
              aria-label={m.role === "user" ? "Edit message" : "Edit reply"}
              className={`opacity-0 group-hover/msg:opacity-60 [@media(hover:none)]:!opacity-60 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
            >
              <Pencil size={14} />
            </button>
          )}
          {canEdit && m.role === "user" && (
            <button
              onClick={() => onRetry(i)}
              title="Regenerate the reply from here"
              aria-label="Regenerate the reply"
              className={`opacity-0 group-hover/msg:opacity-60 [@media(hover:none)]:!opacity-60 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
            >
              <RefreshCw size={14} />
            </button>
          )}
          {canEdit && m.role === "assistant" && isLast && (
            <button
              onClick={() => onContinue(i)}
              title="Continue this reply where it left off"
              aria-label="Continue this reply"
              className={`opacity-0 group-hover/msg:opacity-60 [@media(hover:none)]:!opacity-60 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}
            >
              <ChevronsRight size={14} />
            </button>
          )}
        </div>
      </div>
    </Fragment>
  );
}

export default memo(MessageRow);
