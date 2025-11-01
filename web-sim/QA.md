# Web Simulation Randomness QA

This checklist verifies that the browser worker continues to respect deterministic
replays while exposing the new chaotic mode and intensity control.

1. **Deterministic replay**
   - Load the sim with `?seed=123&mode=deterministic` in the query string or via the control panel.
   - Observe a few ticks and note an agent position.
   - Refresh the page (or hit "Apply & Restart" without changing any values).
   - Confirm the agent follows the exact same path.
2. **Chaotic divergence**
   - Switch the control panel to **Chaotic** mode with the slider at `1.00` (full chaos).
   - Clear the seed (leave the seed field blank) and apply the settings twice in a row.
   - Verify the second run diverges (agents start in different positions).
3. **Temperature blend**
   - Stay in **Chaotic** mode but set the slider to an intermediate value such as `0.40`.
   - Provide a seed (e.g. `123`) and apply the settings twice.
   - Expect shared large-scale structure (seed-biased) with smaller variations caused by the chaotic blend.
4. **HUD check**
   - Ensure the overlay shows the current tick, randomness mode, temperature, and seed (if present).

> If any expectation fails, capture the settings, screenshot the overlay, and file a bug with the reproduction steps.
