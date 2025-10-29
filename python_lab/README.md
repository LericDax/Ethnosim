# Star Nexus Python Lab

This workspace houses experimental simulation code used to prototype mechanics
before they migrate to the browser and Unity layers.

## Environment setup

We manage dependencies with [Poetry](https://python-poetry.org/) (compatible
with `uv pip` if you prefer that workflow).

```bash
cd python_lab
poetry install  # or: uv sync
```

Run the test suite or notebooks from the project root:

```bash
poetry run pytest
poetry run jupyter lab
```

Generated artefacts should be written to `out/runs/` so they stay out of the
source tree.
