# Releases Widget

The latest release of the projects you follow, newest first: the repository, its version tag and how long ago it came out. A row opens the release page.

## Storage Keys

| Key | Value |
|---|---|
| `releases-widget-{id}` | JSON: `{ repos: string[] }` |

Each entry is `owner/repo` for GitHub, or the address of a repository on another forge (`https://codeberg.org/forgejo/forgejo`).

## Behaviour

- Read from each repository's releases feed (`/releases.atom` on GitHub, Gitea, Forgejo and Codeberg; `/-/releases.atom` on GitLab) through the existing `/api/rss` route, so there is no API key and no API rate limit to manage. The server caches each feed like any other.
- The version shown is the release's tag; the feed's title is used when the link carries no tag.
- A repository with no releases, or one that does not exist, shows "no releases found" in its row.
- Feeds are fetched from public addresses only, so a Gitea on your own network is not reachable here.

Not digestable.

(component: `components/ReleasesWidget.tsx`)
