# Manual visual checks

Each JSON file stores `[ticks, held]` input segments at 60 Hz, selected while
looking at Chromium screenshots. The game still integrates at 240 Hz through
`window.__play.stepTick`. These are frame-stepped visual checks, not real-time
keyboard clears or beam-search output. No positions or physics state are edited.

| Level | Coverage | Last checked |
|---|---|---|
| Stereo Madness (1) | Start to completion, normal mode, one attempt; main route, no coins | 2026-09-09 |

With the dev server running on port 3222, recheck a completed route using Node 24:

```sh
node scripts/manual-replay.mjs scripts/manual-routes/stereo-madness.json
```

The replay renders between input segments, fails on death or page errors, and
requires the completion screen state. Replaying this saved route is a regression
check; it does not replace visual inspection of new levels or newly changed art.

Next full visual pass: Back on Track (2). The other 21 levels have not yet received
a complete manual visual pass. Separate partial checks exist for Clutterfunk's
mirror portals and Clubstep's gravity-pad/orb chain.
