import json
import unittest
from pathlib import Path


BRAIN_NAMES = [
    "BabyMind_v1",
    "ChildMind_v1",
    "TeenMind_v1",
    "AdultMind_v1",
    "HouseMind_v1",
    "UrbanMind_v1",
]


class BrainJsonSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        test_dir = Path(__file__).resolve().parent
        python_lab_dir = test_dir.parent
        repo_root = python_lab_dir.parent
        self.shared_brain_dir = repo_root / "shared" / "brains"
        self.node_brain_dir = repo_root / "node" / "src" / "sim" / "data"
        self.python_brain_dir = python_lab_dir / "data" / "brains"

    def test_shared_brain_files_exist_without_duplicates(self):
        for name in BRAIN_NAMES:
            with self.subTest(brain=name):
                shared_path = self.shared_brain_dir / f"{name}.json"
                self.assertTrue(shared_path.is_file(), f"Missing {shared_path}")
                node_path = self.node_brain_dir / f"{name}.json"
                self.assertFalse(
                    node_path.exists(),
                    f"Legacy brain copy should be removed: {node_path}",
                )
                python_path = self.python_brain_dir / f"{name}.json"
                self.assertFalse(
                    python_path.exists(),
                    f"Legacy brain copy should be removed: {python_path}",
                )

    def test_brain_schema(self):
        for name in BRAIN_NAMES:
            with self.subTest(brain=name):
                data = self._load_brain(name)
                self._assert_brain_schema(name, data)

    def _load_brain(self, name: str):
        path = self.shared_brain_dir / f"{name}.json"
        return json.loads(path.read_text(encoding="utf-8"))

    def _assert_brain_schema(self, name: str, data: dict):
        self.assertIsInstance(data, dict)
        self.assertEqual(data.get("version"), 1)
        self.assertEqual(data.get("name"), name)
        nodes = data.get("nodes")
        self.assertIsInstance(nodes, list)
        self.assertGreater(len(nodes), 0)
        node_ids = set()
        for node in nodes:
            self.assertIsInstance(node, dict)
            node_id = node.get("id")
            self.assertIsInstance(node_id, str)
            node_ids.add(node_id)
            base_freq = node.get("base_freq")
            self.assertIsInstance(base_freq, (int, float))
            self.assertGreaterEqual(base_freq, 0)
            duration = node.get("duration")
            self.assertIsInstance(duration, (int, float))
            self.assertGreater(duration, 0)
            tags = node.get("tags")
            self.assertIsInstance(tags, list)
            self.assertGreater(len(tags), 0)
            for tag in tags:
                self.assertIsInstance(tag, str)
            if "charge_capacity" in node:
                charge_capacity = node.get("charge_capacity")
                charge_leak = node.get("charge_leak")
                self.assertIsInstance(charge_capacity, (int, float))
                self.assertGreater(charge_capacity, 0)
                self.assertIsInstance(charge_leak, (int, float))
                self.assertGreaterEqual(charge_leak, 0)
            if "pulse_budget_scale" in node:
                pulse_budget_scale = node.get("pulse_budget_scale")
                self.assertIsInstance(pulse_budget_scale, (int, float))
                self.assertGreater(pulse_budget_scale, 0)
        edges = data.get("edges")
        self.assertIsInstance(edges, list)
        for edge in edges:
            self.assertIsInstance(edge, list)
            self.assertEqual(len(edge), 3)
            src, dst, weight = edge
            self.assertIn(src, node_ids)
            self.assertIn(dst, node_ids)
            self.assertIsInstance(weight, (int, float))
            self.assertGreaterEqual(weight, 0)
        start_node = data.get("start_node")
        self.assertIsInstance(start_node, str)
        self.assertIn(start_node, node_ids)


if __name__ == "__main__":
    unittest.main()
