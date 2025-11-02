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

## Attention embeddings

Brains now reason about outgoing edges using compact tag embeddings defined in
`node/src/sim/engine/embeddings.ts`. Each tag is mapped to an eight-dimensional
vector; runtime nodes inherit a normalized average of their tag vectors during
`buildRuntimeGraph`. A rolling `contextEmbedding` is stored on every
`BrainState`, blending:

- the current node's embedding,
- multiplier-driven embeddings built from mood, personality, and demand maps,
- and pulse payload contributions accumulated during `distributePulseBudget`.

Candidate desirability uses an exponentiated dot-product attention weight
against that context vector. Mood levels contribute multiplicatively as
`1 + mood`, so rising pressures directly steer the attention query toward tags
that need relief. The inspector and brain viewer surface the query vector and
per-candidate attention scores so designers can understand why a transition was
chosen.
Update tag behaviour by tweaking the vectors in `embeddings.ts`; changes propagate
deterministically across serialization and UI snapshots.
