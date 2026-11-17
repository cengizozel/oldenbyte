# Twitch Widget

Follow channels, or see what is most watched. Settings start with which.

- Channels: one row per channel, live ones first by audience, with the category being streamed and the viewer count; offline channels are dimmed. A row opens the channel.
- Top categories: the twelve most watched categories right now, with their box art.

## Storage Keys

| Key | Value |
|---|---|
| `twitch-widget-{id}` | JSON: `{ mode, channels }` |

- `mode` - `channels` or `games`
- `channels` - channel names (a twitch.tv address typed in settings is reduced to the name)

## Connecting Twitch

The widget uses Twitch's official API, which needs a Twitch application of your own. It is free:

1. At [dev.twitch.tv](https://dev.twitch.tv/console/apps), register an application (any name, `http://localhost` as the redirect address, category Website Integration).
2. Copy its client ID and create a client secret.
3. Enter both on the Admin page, under Server, Twitch. They are tried against Twitch before being saved.

Or set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in the server's environment, which takes precedence. An application made for IGDB (RomM and others use one) is the same kind and works here.

The secret stays on the server. It is stored in the `AppConfig` table (or the environment) and is never sent to a browser: the Admin page shows only the client ID. Until Twitch is connected the widget says so.

## Behaviour

- `GET /api/twitch`: the server signs in with the application's credentials, keeps the token until shortly before it expires, and asks Twitch for the channels' profiles and live streams, or the top categories.
- Kept on the server for a minute (channels) or five (categories); the widget asks again every two or ten minutes while its dashboard is showing.
- Only public information is read. No Twitch account is signed in, so it cannot show who you follow there: you list the channels yourself.

Not digestable.

(component: `components/TwitchWidget.tsx`, server: `lib/twitch.ts`, `lib/appconfig.ts`)
