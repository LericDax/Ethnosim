# Star Nexus Node Simulation Layer

Browser-based visualization and worker-driven simulation built with Vite and three.js.

Run `npm run dev` to launch the local development server.

## Plasticity visualization

Brains in the worker now emit signed plasticity adjustments for each edge. Positive rewards (potentiation) brighten an edge in teal, while negative rewards (depression) render in rose. The in-browser inspector lists the strongest adjustments numerically so you can correlate what the brain viewer shows with the serialized state that travels through snapshots.
