# Web Simulation Worker Message Flow

The browser entry point (`src/main.js`) communicates with the simulation worker (`src/sim/sim.worker.js`) exclusively through the message helpers in `src/util/messageBus.js`. The protocol is intentionally small so it can be shared across future runtime ports.

1. **Initialization** – The main thread calls `sendInit(worker, payload)` with the deterministic seed, world dimensions, and cohort sizes. The worker receives this through `onInit(...)`, seeds its RNG, spawns initial agents/households, and immediately publishes a baseline snapshot.
2. **Tick updates** – While running, the worker advances the simulation by `ticksPerUpdate` on an internal interval. After each advancement it emits `postSnapshot(self, snapshot)` with the full `Snapshot` payload described in `src/util/snapshotTypes.js`. The main thread registers `onSnapshot(worker, callback)` to update the Three.js scene and UI overlay whenever new data arrives.
3. **Control messages** – UI or debug tooling can call `sendControl(worker, command, payload)` (e.g., `pause`, `resume`, `step`). The worker listens with `onControl(...)` to toggle the run loop without requiring ad-hoc message parsing in multiple files.

This layout keeps the message formats centralized while preserving determinism (all randomness is derived from the shared seed) and keeps rendering concerns isolated to the main thread.
