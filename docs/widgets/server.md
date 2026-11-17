# Server Widget

The machine the dashboard runs on: processor load, memory, the disk your data is on, uptime, and temperature when the system exposes a sensor.

No settings and nothing stored.

## Behaviour

- Admin only (`GET /api/server-stats`): it describes the owner's machine. Other accounts see "only the admin can see the server".
- Inside Docker the processor and memory figures are the host's, since `/proc` is not separated for them. The disk is the filesystem holding the data folder (the mounted `./data` volume on a standard install).
- Memory used is total minus what Linux reports as available, so cache does not make the machine look full.
- Processor is the busy share across all threads since the previous reading. The widget reads every five seconds while its dashboard is showing and the tab is visible.
- A bar turns red past 90%.

Not digestable.

(component: `components/ServerWidget.tsx`, server: `lib/serverStats.ts`)
