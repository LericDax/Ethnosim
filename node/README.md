# Star Nexus Node Simulation Layer

Browser-based visualization and worker-driven simulation built with Vite and three.js.

Run `npm run dev` to launch the local development server.

## Plasticity visualization

Brains in the worker now emit signed plasticity adjustments for each edge. Positive rewards (potentiation) brighten an edge in teal, while negative rewards (depression) render in rose. The in-browser inspector lists the strongest adjustments numerically so you can correlate what the brain viewer shows with the serialized state that travels through snapshots.

## Trace association tuning

Temporary trace edges derived from residual node charge are governed by a few tunable constants inside `node/src/sim/engine/brain.ts`:

- `RECENT_ASSOCIATION_TTL` — number of ticks a trace edge persists while its charge cache remains.
- `RECENT_ASSOCIATION_DECAY` — per-tick multiplier applied to the trace edge weight.
- `RECENT_ASSOCIATION_WEIGHT_SCALE` — scales normalized charge into an edge weight.
- `RECENT_ASSOCIATION_MAX_WEIGHT` — clamps the strongest possible transient weight.
- `RECENT_ASSOCIATION_MIN_WEIGHT` — minimum meaningful weight; weaker traces are discarded.

Designers can adjust these values to lengthen association lifetimes, intensify short-lived traces, or dampen noisy signals without touching rendering code.
