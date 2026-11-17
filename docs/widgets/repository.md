# Repository Widget

A GitHub repository at a glance: stars, forks, the counts of open pull requests and issues, and the newest five of each. Rows open on GitHub.

## Storage Keys

| Key | Value |
|---|---|
| `repository-widget-{id}` | JSON: `{ repo, show }` |

- `repo` - `owner/repo` (a github.com address typed in settings is reduced to this)
- `show` - `both`, `pulls` or `issues`: which lists to show

## Behaviour

- Read through `/api/repository` from GitHub's public API: one call for the repository and one search each for pull requests and issues, which return the total and the newest few together.
- GitHub allows a server 60 anonymous calls an hour, so answers are cached like the feeds; the refresh button forces a fresh read. When the limit is used up the widget says so. Setting `GITHUB_TOKEN` in the server's environment lifts the limit and reaches private repositories that token can see.
- GitHub only. For releases on other forges, see the Releases widget.

Not digestable.

(component: `components/RepositoryWidget.tsx`, server: `lib/github.ts`)
