import hashlib
from contextlib import closing
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from catalog import Catalog, INBOX, register
from obsidian import publish, safe_uri
from sources import glossa, jieyi, markdown, preview, zotero


def edit(id_, kind, after, before=None):
    return {"id": id_, "kind": kind, "before": before, "after": after}


def folder(name, parent=None):
    return {"name": name, "parent": parent, "order": 0}


class CatalogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.db_path = self.root / "catalog.db"
        self.db = Catalog(self.db_path)
        self.addCleanup(self.db.close)

    def fixture(self):
        self.db.apply("folders", [edit("f", "folder", folder("空间与流动")),
                                  edit("p", "folder", folder("项目")),
                                  edit("c", "folder", folder("子组", "f"))])
        spec = register(self.db.snapshot(), [
            {"connector": "glossa", "external": "G", "title": "文章", "sha256": "a" * 64, "format": "pdf",
             "uri": "glossa://book/test"},
            {"connector": "zotero", "external": "Z", "title": "正式题名", "sha256": "a" * 64, "format": "pdf"},
        ])
        self.db.apply("ingest", spec["edits"], generation=spec["generation"])
        state = self.db.state()
        id_, original = next((i, b) for i, (k, b) in state.items() if k == "material")
        body = {**original, "folder": "c", "aliases": ["p"]}
        self.db.apply("place", [edit(id_, "material", body, original)])
        return id_, body

    def test_idempotence_identity_and_independent_title(self):
        id_, body = self.fixture()
        self.assertEqual(body["title"], "文章")
        self.assertEqual({b["material"] for k, b in self.db.state().values() if k == "binding"}, {id_})
        spec = register(self.db.snapshot(), [
            {"connector": "zotero", "external": "Z", "title": "更正后的正式题名", "sha256": "a" * 64,
             "format": "pdf"},
            {"connector": "jieyi", "external": "J", "title": "文章", "sha256": "b" * 64, "format": "pdf"},
        ])
        first = self.db.apply("update", spec["edits"], generation=spec["generation"])
        self.assertEqual(first, self.db.apply("update", spec["edits"], generation=spec["generation"]))
        self.assertEqual(self.db.state()[id_][1]["title"], "文章")
        self.assertEqual(sum(k == "material" for k, _ in self.db.state().values()), 2)
        changed = register(self.db.snapshot(), [
            {"connector": "zotero", "external": "Z", "title": "另一个版本", "sha256": "c" * 64, "format": "pdf"},
        ])
        self.assertEqual(changed["edits"], [])
        self.assertEqual(len(changed["review"]), 1)

    def test_merge_conflict_and_guarded_undo(self):
        self.fixture()
        base = self.db.state()["f"][1]
        self.db.apply("rename", [edit("f", "folder", {**base, "name": "新名"}, base)])
        self.db.apply("reorder", [edit("f", "folder", {**base, "order": 2}, base)])
        self.assertEqual(self.db.state()["f"][1], {**base, "name": "新名", "order": 2})
        conflict = self.db.apply("other", [edit("f", "folder", {**base, "name": "另一名"}, base)])
        self.assertEqual(conflict["conflicts"][0]["fields"], ["name"])
        self.assertEqual(conflict["conflicts"][0]["current"]["name"], "新名")
        with self.assertRaisesRegex(ValueError, "后续修改"):
            self.db.undo("rename", "undo1")
        self.assertEqual(self.db.undo("reorder", "undo2"), self.db.undo("reorder", "undo2"))
        self.assertEqual(self.db.state()["f"][1]["order"], 0)

    def test_tree_validation_and_removal_preview(self):
        id_, original = self.fixture()
        with self.assertRaisesRegex(ValueError, "子目录"):
            self.db.apply("cycle", [edit("f", "folder", folder("空间与流动", "c"), folder("空间与流动"))])
        spec = self.db.remove_folder("f")
        self.db.apply("next", [edit("new", "folder", folder("后续"))])
        self.assertEqual(self.db.apply("stale", **spec)["status"], "conflict")
        spec = self.db.remove_folder("f")
        self.assertEqual(self.db.apply("remove", **spec)["status"], "applied")
        self.assertEqual(self.db.state()[id_][1], {**original, "folder": INBOX})
        self.assertEqual(sum(k == "binding" for k, _ in self.db.state().values()), 2)
        self.db.undo("remove", "restore")
        self.assertEqual(self.db.state()[id_][1], original)

    def test_projection_moves_and_protects_user_edits(self):
        id_, body = self.fixture()
        vault = self.root / "投影"
        publish(self.db, vault)
        old = vault / "空间与流动" / "子组" / f"{id_}.md"
        link = vault / "项目" / f"{id_}.md"
        self.assertIn("glossa://book/test", old.read_text())
        self.assertIn("%E7%A9%BA", link.read_text())
        self.db.apply("rename", [edit("f", "folder", folder("空间"), folder("空间与流动"))])
        publish(self.db, vault)
        new = vault / "空间" / "子组" / f"{id_}.md"
        self.assertFalse(old.exists())
        self.assertTrue(new.exists())
        self.assertIn("glossa://book/test", new.read_text())
        self.assertNotIn("%E4%B8%8E", link.read_text())
        original = link.read_bytes()
        link.write_text("手动编辑")
        self.db.apply("remove-alias", [edit(id_, "material", {**body, "aliases": []}, body)])
        with self.assertRaisesRegex(ValueError, "已保留"):
            publish(self.db, vault)
        self.assertEqual(link.read_text(), "手动编辑")
        link.write_bytes(original)
        publish(self.db, vault)
        self.assertFalse(link.exists())
        self.assertTrue(new.exists())

    def test_publish_resumes_after_first_file_write_and_restart(self):
        self.fixture()
        vault = self.root / "投影"
        import obsidian
        original = obsidian.atomic_text

        def crash(path, *args, **kwargs):
            original(path, *args, **kwargs)
            if path.suffix == ".md":
                raise OSError("模拟进程中断")

        with patch.object(obsidian, "atomic_text", side_effect=crash):
            with self.assertRaises(OSError):
                publish(self.db, vault)
        other = Catalog(self.db_path)
        try:
            self.assertEqual(publish(other, vault)["cards"], 2)
            self.assertEqual(len(list(vault.rglob("*.md"))), 3)
        finally:
            other.close()

    def test_projection_rejects_unowned_target(self):
        vault = self.root / "非空"
        vault.mkdir()
        note = vault / "笔记.md"
        note.write_text("笔记")
        with self.assertRaises(ValueError):
            publish(self.db, vault)
        self.assertEqual(list(vault.iterdir()), [note])

    def test_links_allow_only_known_actions(self):
        self.assertIsNone(safe_uri("obsidian://new?vault=work"))
        self.assertIsNone(safe_uri("obsidian://open?path=%2FApplications%2FTest.app"))
        self.assertIsNone(safe_uri("javascript:alert%281%29"))
        self.assertEqual(safe_uri("obsidian://open?path=%2Fnotes%2Fone.md"), "obsidian://open?path=%2Fnotes%2Fone.md")

    def test_five_adapters_one_sample_and_distinct_derivatives(self):
        pdf = self.root / "source.pdf"
        pdf.write_bytes(b"original sample bytes")
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        g = self.root / "glossa.db"
        with closing(sqlite3.connect(g)) as conn, conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("CREATE TABLE glossa_library_entries(key TEXT, payload TEXT)")
            conn.executemany("INSERT INTO glossa_library_entries VALUES (?,?)", [
                ("meta:version", '{"version":1}'),
                ("book:sample", json.dumps({"hash": "sample", "format": "PDF", "title": "论文",
                                             "groupName": "研究", "contentFingerprint": "sha256:" + digest})),
            ])
        j = self.root / "jieyi.db"
        with closing(sqlite3.connect(j)) as conn, conn:
            conn.executescript("CREATE TABLE projects(id,name); CREATE TABLE documents(id,title,source_hash,source_format,project_id);")
            conn.execute("INSERT INTO projects VALUES ('j','翻译')")
            conn.execute("INSERT INTO documents VALUES ('d','论文译稿',?,'pdf','j')", (digest,))
        sea = self.root / "课程"
        sea.mkdir()
        (sea / "课堂.md").write_text("---\nsea_id: lecture:1\n---\n")
        obs = self.root / "专业"
        obs.mkdir()
        (obs / "研究.md").write_text("# 研究笔记\n")
        headers = {"Zotero-Server-ID": "instance", "Last-Modified-Version": "11"}
        payloads = {
            "": None,
            "users/0/collections?limit=100&start=0": [{"key": "COLL0001", "data": {"name": "研究"}}],
            "users/0/items?limit=100&start=0": [
                {"key": "PARENT01", "data": {"itemType": "book", "title": "论文",
                                             "collections": ["COLL0001"]}},
                {"key": "FILE0001", "data": {"itemType": "attachment", "title": "论文 PDF",
                                             "parentItem": "PARENT01", "contentType": "application/pdf"}},
            ],
            "users/0/items?limit=1": [],
            "users/0/items/FILE0001/file/view/url": pdf.as_uri(),
        }
        with patch("sources.request", side_effect=lambda route, **_: (payloads[route], headers)):
            z = zotero(hash_attachments=True)
        sample = []
        for connector, result in [
            ("glossa", glossa(g)), ("jieyi", jieyi(j)), ("sea", markdown(sea, "sea")),
            ("obsidian", markdown(obs, "obsidian")), ("zotero", z),
        ]:
            records, folders = result
            sample.append({"connector": connector, "scope": connector, "records": records, "folders": folders})
        self.assertEqual(len(preview(sample)["identical_files"][0]), 3)
        spec = register(self.db.snapshot(), [r for entry in sample for r in entry["records"]])
        self.db.apply("sample", spec["edits"], generation=spec["generation"])
        state = self.db.state()
        matched = [b for k, b in state.values() if k == "binding" and b.get("file")]
        self.assertEqual({b["connector"] for b in matched}, {"glossa", "zotero", "jieyi"})
        self.assertEqual(len({b["material"] for b in matched}), 1)
        self.assertEqual(sum(k == "material" for k, _ in state.values()), 4)
        out = self.root / "样本"
        self.assertEqual(publish(self.db, out)["cards"], 4)
        self.assertEqual(len(list(out.rglob("*.md"))), 5)


if __name__ == "__main__":
    unittest.main()
