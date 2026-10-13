"use client";

import { useState } from "react";
import { MessageSquare, Plus, X, Pencil } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { timeAgo } from "@/lib/chat/format";
import type { ConvMeta } from "@/lib/chat/types";
import { HIT_AREA, FOCUS_RING } from "../ui/Field";
import { WidgetHeader } from "../ui/WidgetChrome";

// Chats list: switches the whole widget to a list of saved conversations.
// The active chat's title, count and rename placeholder come from the live
// working copy (`active`), the rest from the index.
export default function HistoryPanel({ c, conversations, activeId, active, onNew, onClose, onSelect, onRename, onDelete }: {
  c: ColorClasses;
  conversations: ConvMeta[];
  activeId: string;
  active: { title: string; count: number; autoTitle: string };
  onNew: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  // Inline rename of a row.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  return (
    <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
      <div className="px-4 pt-3 shrink-0">
        <WidgetHeader
          c={c}
          icon={MessageSquare}
          title="Chats"
          right={
            <>
              <button onClick={onNew} title="New chat with the Assistant" aria-label="New chat" className={`opacity-60 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}>
                <Plus size={14} />
              </button>
              <button onClick={onClose} title="Close" aria-label="Close" className={`opacity-60 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}>
                <X size={14} />
              </button>
            </>
          }
        />
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-2 pb-2 flex flex-col gap-1">
        {[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(cv => {
          const isActive = cv.id === activeId;
          const title = isActive ? active.title : cv.title;
          const count = isActive ? active.count : cv.count;
          const renaming = renamingId === cv.id;
          return (
            <div
              key={cv.id}
              onClick={() => { if (!renaming) onSelect(cv.id); }}
              className={`group/row flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                isActive ? `${c.bg} ring-1 ring-[var(--surface-border-focus)]` : "hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <div className="flex-1 min-w-0">
                {renaming ? (
                  <input
                    autoFocus
                    value={renameDraft}
                    onClick={e => e.stopPropagation()}
                    onChange={e => setRenameDraft(e.target.value)}
                    onBlur={() => { onRename(cv.id, renameDraft); setRenamingId(null); }}
                    onKeyDown={e => {
                      if (e.key === "Enter") { onRename(cv.id, renameDraft); setRenamingId(null); }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    placeholder={isActive ? active.autoTitle : cv.autoTitle}
                    className={`w-full text-sm bg-transparent outline-none border-b border-current/30 ${c.text}`}
                  />
                ) : (
                  <p className={`text-sm font-medium truncate ${c.text} ${isActive ? "" : "opacity-80"}`}>{title}</p>
                )}
                <p className={`text-xs ${c.label} opacity-60`}>
                  {count} message{count === 1 ? "" : "s"}{cv.updatedAt ? ` · ${timeAgo(cv.updatedAt)}` : ""}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); setRenameDraft(cv.renamed ? cv.title : ""); setRenamingId(cv.id); }}
                title="Rename chat"
                aria-label="Rename chat"
                className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-60 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={e => { e.stopPropagation(); onDelete(cv.id); }}
                title="Delete chat"
                aria-label="Delete chat"
                className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-60 hover:!opacity-100 focus-visible:!opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
