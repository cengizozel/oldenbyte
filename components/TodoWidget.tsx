"use client";

import { useEffect, useRef, useState } from "react";
import { ListTodo, Check, X, Eraser } from "lucide-react";
import { colorMap, type Widget } from "@/lib/widgets";
import * as storage from "@/lib/storage";
import { useScrollFade } from "@/lib/useScrollFade";
import FlipCard from "@/components/ui/FlipCard";
import { FOCUS_RING, HIT_AREA } from "@/components/ui/Field";
import { WidgetHeader, Chip, ScrollFades, SettingsFace, SettingsField, SmallButton } from "@/components/ui/WidgetChrome";

// A plain to-do list (docs/widgets/todo.md): type a task and press Enter,
// tick it when done. Tasks are edited in place, like a notes app's checklist.
// Open tasks stay on top in the order they were added; done ones sink below.

type Task = { id: string; text: string; done: boolean; doneAt?: number };
type Config = { tasks: Task[]; hideDone: boolean };
const DEFAULT: Config = { tasks: [], hideDone: false };

const newId = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export default function TodoWidget({ widget, className = "" }: { widget: Widget; className?: string }) {
  const c = colorMap[widget.color];
  const storageKey = `todo-widget-${widget.id}`;
  const [config, setConfig] = useState<Config>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draftHide, setDraftHide] = useState(false);
  const [input, setInput] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  const { ref, onScroll, topFade, bottomFade } = useScrollFade<HTMLDivElement>([config.tasks.length, config.hideDone]);

  useEffect(() => {
    storage.getItemResult(storageKey).then(res => {
      // A failed read leaves the list read-only rather than saving an empty
      // one over real tasks.
      if (!res.ok) return;
      try {
        if (res.value) setConfig({ ...DEFAULT, ...JSON.parse(res.value) });
      } catch {}
      setLoaded(true);
    });
  }, [storageKey]);

  function apply(next: Config) {
    setConfig(next);
    storage.setItem(storageKey, JSON.stringify(next));
  }

  function add() {
    const text = input.trim();
    if (!text || !loaded) return;
    apply({ ...config, tasks: [...config.tasks, { id: newId(), text, done: false }] });
    setInput("");
  }

  const toggle = (id: string) =>
    apply({ ...config, tasks: config.tasks.map(t => t.id === id ? { ...t, done: !t.done, doneAt: t.done ? undefined : Date.now() } : t) });
  const rename = (id: string, text: string) =>
    apply({ ...config, tasks: config.tasks.map(t => t.id === id ? { ...t, text } : t) });
  const remove = (id: string) => apply({ ...config, tasks: config.tasks.filter(t => t.id !== id) });
  const clearDone = () => apply({ ...config, tasks: config.tasks.filter(t => !t.done) });

  const open = config.tasks.filter(t => !t.done);
  const done = config.tasks.filter(t => t.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  const shown = config.hideDone ? open : [...open, ...done];

  return (
    <FlipCard
      c={c}
      flipped={settingsOpen}
      className={className}
      front={
        <>
          <WidgetHeader
            onSettings={() => { setDraftHide(config.hideDone); setSettingsOpen(true); }}
            c={c}
            icon={ListTodo}
            title={widget.title}
            after={open.length > 0 ? <span className={`text-sm opacity-70 tabular-nums ${c.label}`}>{open.length}</span> : undefined}
            right={done.length > 0 ? (
              <button type="button" onClick={clearDone} title="Clear completed" aria-label="Clear completed" className={`opacity-70 hover:opacity-100 ${HIT_AREA} ${FOCUS_RING} ${c.icon}`}>
                <Eraser size={14} />
              </button>
            ) : undefined}
          />
          <div className="flex-1 min-h-0 relative">
            <div ref={ref} onScroll={onScroll} className="absolute inset-0 overflow-y-auto pr-3">
              <ul className="flex flex-col">
                {shown.map(task => (
                  <li key={task.id} className="group/task flex items-start gap-2 py-1.5">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={task.done}
                      aria-label={task.done ? `Mark "${task.text}" not done` : `Mark "${task.text}" done`}
                      onClick={() => toggle(task.id)}
                      className={`shrink-0 mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${FOCUS_RING} ${
                        task.done ? `bg-current border-transparent ${c.label}` : `border-current opacity-70 hover:opacity-100 ${c.label}`
                      }`}
                    >
                      {task.done && <Check size={13} strokeWidth={3} className="text-[var(--surface)]" />}
                    </button>
                    <input
                      value={task.text}
                      onChange={e => rename(task.id, e.target.value)}
                      onBlur={e => { if (!e.target.value.trim()) remove(task.id); }}
                      onKeyDown={e => { if (e.key === "Enter") addRef.current?.focus(); }}
                      aria-label="Task"
                      className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm leading-snug outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--text-muted)] ${c.text} ${task.done ? "line-through opacity-70" : ""}`}
                    />
                    <button
                      type="button"
                      onClick={() => remove(task.id)}
                      title="Remove"
                      aria-label={`Remove "${task.text}"`}
                      className={`shrink-0 mt-0.5 opacity-0 group-hover/task:opacity-70 focus-visible:opacity-100 hover:!opacity-100 [@media(hover:none)]:opacity-70 ${HIT_AREA} ${FOCUS_RING} ${c.label}`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
                <li className="flex items-center gap-2 py-1.5">
                  <span aria-hidden className={`shrink-0 w-5 h-5 rounded-full border border-dashed border-current opacity-40 ${c.label}`} />
                  <input
                    ref={addRef}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") add(); }}
                    onBlur={add}
                    placeholder={config.tasks.length ? "Add a task" : "Add your first task"}
                    aria-label="Add a task"
                    enterKeyHint="done"
                    disabled={!loaded}
                    className={`flex-1 min-w-0 bg-transparent dark:!bg-transparent text-sm leading-snug outline-none rounded-sm focus-visible:ring-2 focus-visible:ring-[var(--text-muted)] placeholder:text-current placeholder:opacity-50 ${c.text}`}
                  />
                </li>
              </ul>
            </div>
            <ScrollFades c={c} top={topFade} bottom={bottomFade} />
          </div>
        </>
      }
      back={
        <SettingsFace
          c={c}
          onReset={() => setDraftHide(DEFAULT.hideDone)}
          onSave={() => { apply({ ...config, hideDone: draftHide }); setSettingsOpen(false); }}
          onCancel={() => setSettingsOpen(false)}
        >
          <SettingsField c={c} label="Completed tasks" inline>
            <Chip c={c} active={!draftHide} onClick={() => setDraftHide(false)}>Shown</Chip>
            <Chip c={c} active={draftHide} onClick={() => setDraftHide(true)}>Hidden</Chip>
          </SettingsField>
          <SettingsField c={c} label="Clean up" inline hint={done.length ? `${done.length} completed.` : "Nothing completed yet."}>
            <SmallButton c={c} onClick={clearDone} disabled={!done.length}>Clear completed</SmallButton>
          </SettingsField>
        </SettingsFace>
      }
    />
  );
}
