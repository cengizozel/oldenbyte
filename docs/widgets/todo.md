# Todo Widget

A plain to-do list. Type a task in the last row and press Enter; tick the circle when it is done. Tasks are edited in place, like a notes app's checklist.

## Storage Keys

| Key | Value |
|---|---|
| `todo-widget-{id}` | JSON: `{ tasks: Task[]; hideDone: boolean }` |

`Task` is `{ id, text, done, doneAt? }`.

## Behaviour

- Open tasks stay on top in the order they were added; done ones sink below them, newest first, struck through.
- Click a task's text to edit it. Clearing the text and leaving the field removes the task; the cross at the end of a row removes it too.
- The header shows how many are open. With any done, the options hold "Clear completed"; settings can hide completed tasks instead.
- If the list cannot be read at load (server restarting), adding is off until a reload, so an empty list is never saved over real tasks.

Not digestable. The Chat widget's `read_widget` tool reads it through `lib/widgetData.ts` (`readTodo`).

(component: `components/TodoWidget.tsx`)
