# Embed Widget

Another web page inside a widget: a status page, a graph, a tool you host.

## Storage Keys

| Key | Value |
|---|---|
| `embed-widget-{id}` | JSON: `{ url, name }` |

`name` is shown as the widget's title.

## Behaviour

- The page runs in a sandboxed iframe: its scripts and forms work, it may open links in new tabs, and it cannot navigate the dashboard itself. No referrer is sent.
- The dashboard's own address is refused: a page from the same origin could reach out of its frame.
- On a dashboard served over https, an http address is refused with an explanation, since browsers block it.
- Many sites forbid being framed; those stay blank, which the widget cannot detect. Pages you host yourself usually work.

Not digestable.

(component: `components/EmbedWidget.tsx`)
