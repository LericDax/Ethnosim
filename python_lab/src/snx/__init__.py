"""Star Nexus (``snx``) Python lab package.

This namespace mirrors the larger Star Nexus simulation architecture, giving us
space to prototype algorithms in Python before porting them to the worker and
Unity layers. Subpackages:

* :mod:`snx.core` – shared data models, RNG helpers, and system primitives.
* :mod:`snx.sim` – orchestration of turn-based simulation loops and systems.
* :mod:`snx.io` – data-loading helpers bridging JSON assets and schemas.
* :mod:`snx.viz` – lightweight visualisation helpers for notebooks and reports.
"""

__all__ = ["core", "sim", "io", "viz"]
