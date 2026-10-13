"use client";

import { useState } from "react";
import { Users, Plus, X, Check, Pencil, Copy, Trash2 } from "lucide-react";
import type { ColorClasses } from "@/lib/widgets";
import { DEFAULT_CHARACTER_ID, type Character } from "@/lib/chat/types";
import { SettingsInput, SettingsTextarea } from "../ui/Field";

// Characters list: pick and manage personas.
export function CharactersPanel({ c, characters, activeCharId, onCreate, onClose, onActivate, onEdit, onDuplicate, onDelete }: {
  c: ColorClasses;
  characters: Character[];
  activeCharId: string;
  onCreate: () => void;
  onClose: () => void;
  onActivate: (id: string) => void;
  onEdit: (ch: Character) => void;
  onDuplicate: (ch: Character) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className={`absolute inset-0 z-40 rounded-2xl flex flex-col ${c.bg}`}>
      <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
        <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
          <Users size={13} /> Characters
        </span>
        <div className="flex items-center gap-3">
          <button onClick={onCreate} title="New character" className={`opacity-60 hover:opacity-100 ${c.label}`}><Plus size={15} /></button>
          <button onClick={onClose} title="Close" className={`opacity-50 hover:opacity-90 ${c.label}`}><X size={14} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-1">
        {characters.map(ch => {
          const isActive = ch.id === activeCharId;
          return (
            <div
              key={ch.id}
              onClick={() => onActivate(ch.id)}
              className={`group/row flex items-start gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isActive ? `${c.bg} ring-1 ring-[var(--surface-border-focus)]` : "hover:bg-black/5 dark:hover:bg-white/5"}`}
            >
              <span className="text-base leading-none mt-0.5 shrink-0">{ch.id === DEFAULT_CHARACTER_ID ? "🤖" : ch.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${c.text} ${isActive ? "font-medium" : "opacity-80"}`}>{ch.name}</p>
                <p className={`text-[12px] ${c.label} opacity-60 truncate`}>
                  {ch.id === DEFAULT_CHARACTER_ID ? "default · no memory" : (ch.focus ? `remembers: ${ch.focus}` : "no focus, won't auto-remember")}
                  {ch.memories.length ? ` · ${ch.memories.length} ${ch.memories.length === 1 ? "memory" : "memories"}` : ""}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); onEdit(ch); }} title="Edit" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><Pencil size={12} /></button>
              <button onClick={e => { e.stopPropagation(); onDuplicate(ch); }} title="Duplicate: same persona, fresh memory" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><Copy size={12} /></button>
              {ch.id !== DEFAULT_CHARACTER_ID && (
                <button onClick={e => { e.stopPropagation(); onDelete(ch.id); }} title="Delete character" className={`shrink-0 mt-0.5 opacity-0 group-hover/row:opacity-50 hover:!opacity-90 ${c.label}`}><X size={13} /></button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Character editor: persona, memory focus, and the memory list itself. Edits
// a local draft; nothing is saved until the check is clicked.
export function CharacterEditor({ c, character, onCancel, onSave }: {
  c: ColorClasses;
  character: Character;
  onCancel: () => void;
  onSave: (draft: Character) => void;
}) {
  const [charDraft, setCharDraft] = useState<Character>(() => ({ ...character }));
  const set = (patch: Partial<Character>) => setCharDraft(d => ({ ...d, ...patch }));

  return (
    <div className={`absolute inset-0 z-50 rounded-2xl flex flex-col ${c.bg}`}>
      <div className={`flex items-center justify-between px-4 pt-3 pb-2 shrink-0 border-b ${c.border}`}>
        <span className={`flex items-center gap-1.5 text-xs font-medium opacity-70 ${c.label}`}>
          <Users size={13} /> Edit character
        </span>
        <div className="flex items-center gap-3">
          <button onClick={onCancel} title="Cancel" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
          <button onClick={() => onSave(charDraft)} title="Save" className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Check size={14} /></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-3">
        <div className="flex gap-2">
          <SettingsInput value={charDraft.emoji} onChange={e => set({ emoji: e.target.value })} placeholder="🎓" maxLength={8} className="!w-14 text-center text-lg px-2" />
          <SettingsInput value={charDraft.name} onChange={e => set({ name: e.target.value })} placeholder="Education Coach" className="flex-1" />
        </div>
        {charDraft.id === DEFAULT_CHARACTER_ID ? (
          <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">This is the default Assistant. Edit its system prompt in Settings; it doesn&apos;t keep memory. Create a new character for a persona with its own scoped memory.</p>
        ) : (
          <>
            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Persona <span className="opacity-60">(its system prompt)</span></p>
              <SettingsTextarea value={charDraft.persona} onChange={e => set({ persona: e.target.value })} rows={4} placeholder="You are my education coach. Help me plan, stay accountable, and learn effectively." />
            </div>
            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Remembers <span className="opacity-60">(what it cares about; empty = no memory)</span></p>
              <SettingsInput value={charDraft.focus} onChange={e => set({ focus: e.target.value })} placeholder="my education, goals, academic background" />
            </div>
            <div>
              <p className={`text-xs mb-1 opacity-50 ${c.label}`}>Memories <span className="opacity-60">({charDraft.memories.length})</span></p>
              <div className="flex flex-col gap-1">
                {charDraft.memories.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={m} onChange={e => setCharDraft(d => { const mem = [...d.memories]; mem[i] = e.target.value; return { ...d, memories: mem }; })} className="flex-1 text-xs border border-[var(--surface-border)] rounded-lg px-2 py-1.5 outline-none focus:border-[var(--surface-border-focus)] text-[var(--text-primary)] bg-[var(--surface)]" />
                    <button onClick={() => setCharDraft(d => ({ ...d, memories: d.memories.filter((_, j) => j !== i) }))} className="shrink-0 text-[var(--text-muted)] hover:text-red-400"><Trash2 size={13} /></button>
                  </div>
                ))}
                <button onClick={() => setCharDraft(d => ({ ...d, memories: [...d.memories, ""] }))} className="self-start text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center gap-1 mt-0.5"><Plus size={11} /> add memory</button>
              </div>
              <p className="text-[12px] text-[var(--text-muted)] mt-1">It also adds to these automatically after chats, based on what you share that fits its focus.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
