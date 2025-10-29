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
        self.python_brain_dir = python_lab_dir / "data" / "brains"
        self.node_brain_dir = repo_root / "node" / "src" / "sim" / "data"

    def test_brain_files_exist_and_match(self):
        for name in BRAIN_NAMES:
            with self.subTest(brain=name):
                python_path = self.python_brain_dir / f"{name}.json"
                node_path = self.node_brain_dir / f"{name}.json"
                self.assertTrue(python_path.is_file(), f"Missing {python_path}")
                self.assertTrue(node_path.is_file(), f"Missing {node_path}")
                self.assertEqual(
                    python_path.read_text(encoding="utf-8"),
                    node_path.read_text(encoding="utf-8"),
                    "Brain JSON copies diverged between python_lab and node directories",
                )

    def test_brain_schema(self):
        for name in BRAIN_NAMES:
            with self.subTest(brain=name):
                data = self._load_brain(name)
                self._assert_brain_schema(name, data)

    def _load_brain(self, name: str):
        path = self.python_brain_dir / f"{name}.json"
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
