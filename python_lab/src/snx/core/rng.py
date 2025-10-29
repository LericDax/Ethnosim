"""Deterministic random utilities for Star Nexus experiments.

This module will eventually:

* Wrap :class:`numpy.random.Generator` with seed management tied to run metadata.
* Provide helpers for weighted choices, temperament sampling, and reproducible noise.
* Surface context managers so subsystems can temporarily branch RNG streams.
"""

# TODO: Implement seeded RNG manager and domain-specific sampling helpers.
