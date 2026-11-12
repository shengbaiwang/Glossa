"""Local catalog. All edits, conflict decisions and publication requests are journaled."""

import contextlib
import hashlib
import json
import re
import sqlite3
import unicodedata
from pathlib import Path

INBOX = "inbox"
ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
SHA = re.compile(r"[a-f0-9]{64}\Z")
FIELDS = {
    "folder": {"name", "parent", "order"},
    "material": {"title", "folder", "aliases", "work", "edition", "tags"},
    "work": {"title"},
    "edition": {"title", "work"},
    "file": {"sha256", "format", "material"},
    "relation": {"source", "target", "role", "revision"},
    "evidence": {"material", "file", "source", "locator", "quote", "prefix", "suffix"},
    "binding": {"connector", "external", "material", "title", "uri", "file", "metadata"},
}


def dump(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def stable_id(*parts):
    return hashlib.sha256(dump(parts).encode()).hexdigest()[:32]


def label(value, *, folder=False):
    if not isinstance(value, str) or not value.strip() or len(value) > 240:
        raise ValueError("名称应为 1–240 字符")
    if folder and (
        value != value.strip() or value.endswith(".") or value.startswith(".")
        or any(c in '/\\:*?"<>|\r\n' or ord(c) < 32 for c in value)
        or len(value.encode()) > 220
    ):
        raise ValueError("文件夹名称不能用作共享路径")
    return value


def fold(value):
    return unicodedata.normalize("NFKC", value).casefold()


def valid_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError("无效的对象 ID")
    return value


def merge(base, current, proposed):
    """Three-way merge per field; deletion is atomic."""
    if current == base or current == proposed:
        return proposed, []
    if proposed == base:
        return current, []
    if None in (base, current, proposed):
        return current, ["*"]
    if not all(isinstance(x, dict) for x in (base, current, proposed)):
        return current, ["*"]
    missing = object()
    result, conflicts = {}, []
    for key in sorted(base.keys() | current.keys() | proposed.keys()):
        b, c, p = (x.get(key, missing) for x in (base, current, proposed))
        if c != b and p != b and c != p:
            conflicts.append(key)
        value = p if c == b else c
        if value is not missing:
            result[key] = value
    return result, conflicts


class Catalog:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None)
        try:
            version = self.db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, 1):
                raise ValueError("无法打开此版本的资料目录")
            self.db.executescript("""
                BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS entities (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS events (
                    seq INTEGER PRIMARY KEY, op TEXT UNIQUE NOT NULL,
                    request TEXT NOT NULL, result TEXT NOT NULL, changes TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS projections (
                    target TEXT PRIMARY KEY, receipt TEXT NOT NULL
                );
                INSERT OR IGNORE INTO entities VALUES
                    ('inbox','folder','{"name":"待归类","parent":null,"order":0}');
                PRAGMA user_version = 1;
                COMMIT;
            """)
        except BaseException:
            self.db.close()
            raise

    def close(self):
        self.db.close()

    @contextlib.contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.commit()
        except BaseException:
            self.db.rollback()
            raise

    def state(self):
        return {id_: (kind, json.loads(body)) for id_, kind, body in self.db.execute(
            "SELECT id,kind,body FROM entities ORDER BY id"
        )}

    def revision(self):
        return self.db.execute("SELECT COALESCE(MAX(seq),0) FROM events").fetchone()[0]

    def snapshot(self):
        with self.transaction():
            return {"revision": self.revision(), "entities": self.state()}

    def events(self, since=0):
        return [{"seq": seq, "op": op, "result": json.loads(result), "changes": json.loads(changes)}
                for seq, op, result, changes in self.db.execute(
                    "SELECT seq,op,result,changes FROM events WHERE seq>? ORDER BY seq", (since,)
                )]

    def apply(self, op, edits, *, generation=None, _undo=False):
        """Each edit supplies the last observed value and intended value (null = absent)."""
        valid_id(op)
        request = dump([generation, edits])
        with self.transaction():
            prior = self.db.execute("SELECT request,result FROM events WHERE op=?", (op,)).fetchone()
            if prior:
                if prior[0] != request:
                    raise ValueError("操作 ID 已被用于另一项修改")
                return json.loads(prior[1])
            if not isinstance(edits, list):
                raise ValueError("修改必须为数组")
            state = self.state()
            changes, conflicts, seen = [], [], set()
            if generation is not None and generation != self.revision():
                conflicts.append({"field": "revision", "base": generation, "current": self.revision()})
            for edit in edits:
                id_, kind = valid_id(edit["id"]), edit["kind"]
                if kind not in FIELDS or id_ == INBOX or id_ in seen:
                    raise ValueError("无效、重复或受保护的目录对象")
                seen.add(id_)
                current_kind, current = state.get(id_, (kind, None))
                if current_kind != kind:
                    raise ValueError("对象类型不可变更")
                base, proposed = edit["before"], edit["after"]
                for body in (base, proposed):
                    if body is not None and (not isinstance(body, dict) or body.keys() - FIELDS[kind]):
                        raise ValueError(f"无效字段：{kind}")
                if kind == "file" and base and proposed and base["sha256"] != proposed.get("sha256"):
                    raise ValueError("不能更改已登记文件的内容身份")
                if proposed is None and kind not in {"folder", "relation"} and base is not None and not _undo:
                    raise ValueError("保留材料、来源、文件与证据记录")
                value, fields = merge(base, current, proposed)
                if fields:
                    conflicts.append({"id": id_, "kind": kind, "fields": fields,
                                      "base": base, "current": current, "proposed": proposed})
                elif value != current:
                    changes.append({"id": id_, "kind": kind, "before": current, "after": value})
                    if value is None:
                        state.pop(id_, None)
                    else:
                        state[id_] = (kind, value)
            if not conflicts:
                validate(state)
                for change in changes:
                    id_, kind, value = change["id"], change["kind"], change["after"]
                    if value is None:
                        self.db.execute("DELETE FROM entities WHERE id=?", (id_,))
                    else:
                        self.db.execute("INSERT OR REPLACE INTO entities VALUES (?,?,?)", (id_, kind, dump(value)))
            else:
                changes = []
            result = {"status": "conflict" if conflicts else "applied", "conflicts": conflicts,
                      "revision": self.revision() + 1, "changed": len(changes)}
            self.db.execute("INSERT INTO events(op,request,result,changes) VALUES (?,?,?,?)",
                            (op, request, dump(result), dump(changes)))
            return result

    def undo(self, original, op):
        valid_id(original)
        valid_id(op)
        undo_id = f"undo-{stable_id(original, op)}"
        row = self.db.execute("SELECT seq,changes FROM events WHERE op=?", (original,)).fetchone()
        if not row or not json.loads(row[1]):
            raise ValueError("没有可撤销的修改")
        prior = self.db.execute("SELECT result FROM events WHERE op=?", (undo_id,)).fetchone()
        if prior:
            return json.loads(prior[0])
        edits = [{**edit, "before": edit["after"], "after": edit["before"]}
                 for edit in json.loads(row[1])]
        # Only allow undo when the affected objects still match the applied values.
        state = self.snapshot()
        for edit in edits:
            if state["entities"].get(edit["id"], (None, None))[1] != edit["before"]:
                raise ValueError("对象已被后续修改，不能撤销")
        return self.apply(undo_id, edits, generation=state["revision"], _undo=True)

    def remove_folder(self, folder):
        """Preview a full branch removal. Pass the preview generation back on apply."""
        snap = self.snapshot()
        state = snap["entities"]
        if folder == INBOX or state.get(folder, (None,))[0] != "folder":
            raise ValueError("目录不存在或受保护")
        children = {}
        for id_, (kind, body) in state.items():
            if kind == "folder":
                children.setdefault(body["parent"], []).append(id_)
        branch, stack = set(), [folder]
        while stack:
            node = stack.pop()
            branch.add(node)
            stack.extend(children.get(node, ()))
        edits = []
        for id_, (kind, body) in state.items():
            if id_ in branch:
                edits.append({"id": id_, "kind": kind, "before": body, "after": None})
            elif kind == "material":
                home = INBOX if body["folder"] in branch else body["folder"]
                aliases = [a for a in body["aliases"] if a not in branch and a != home]
                after = {**body, "folder": home, "aliases": aliases}
                if after != body:
                    edits.append({"id": id_, "kind": kind, "before": body, "after": after})
        return {"generation": snap["revision"], "edits": edits}


def validate(state):
    def ref(id_, kind):
        if state.get(valid_id(id_), (None,))[0] != kind:
            raise ValueError(f"引用的 {kind} 对象不存在：{id_}")

    names, digests, bindings = set(), set(), set()
    for id_, (kind, body) in state.items():
        if kind == "folder":
            name, parent = label(body["name"], folder=True), body["parent"]
            if parent is not None:
                ref(parent, "folder")
                if parent == INBOX:
                    raise ValueError("待归类目录不能包含子目录")
            if type(body["order"]) is not int or body["order"] < 0:
                raise ValueError("排序位置必须为非负整数")
            key = (parent, fold(name))
            if key in names:
                raise ValueError("同级目录名称重复")
            names.add(key)
        elif kind == "material":
            label(body["title"])
            ref(body["folder"], "folder")
            aliases = body["aliases"]
            if not isinstance(aliases, list) or len(set(aliases)) != len(aliases) or body["folder"] in aliases:
                raise ValueError("关联入口重复或与主位置相同")
            for alias in aliases:
                ref(alias, "folder")
            for field in ("work", "edition"):
                if body.get(field) is not None:
                    ref(body[field], field)
            if body.get("work") and body.get("edition") and state[body["edition"]][1]["work"] != body["work"]:
                raise ValueError("版本与作品对应不一致")
            if "tags" in body:
                if not isinstance(body["tags"], list):
                    raise ValueError("标签必须为数组")
                for tag in body["tags"]:
                    label(tag)
        elif kind in ("edition", "work"):
            label(body["title"])
            if kind == "edition":
                ref(body["work"], "work")
        elif kind == "file":
            if not SHA.fullmatch(body["sha256"]) or body["sha256"] in digests:
                raise ValueError("完整文件指纹无效或已登记")
            digests.add(body["sha256"])
            ref(body["material"], "material")
            label(body["format"])
        elif kind == "binding":
            ref(body["material"], "material")
            if body.get("file"):
                ref(body["file"], "file")
                if state[body["file"]][1]["material"] != body["material"]:
                    raise ValueError("来源文件与材料不一致")
            key = (label(body["connector"]), label(body["external"]))
            if key in bindings:
                raise ValueError("该来源记录已关联")
            bindings.add(key)
            label(body["title"])
        elif kind == "relation":
            for field in ("source", "target"):
                ref(body[field], "material")
            if body["source"] == body["target"]:
                raise ValueError("材料不能与自身建立关系")
            label(body["role"])
        elif kind == "evidence":
            ref(body["material"], "material")
            ref(body["file"], "file")
            ref(body["source"], "binding")
            if any(state[body[field]][1]["material"] != body["material"] for field in ("file", "source")):
                raise ValueError("证据的文件、来源与材料不一致")
            if state[body["source"]][1].get("file") != body["file"]:
                raise ValueError("证据须绑定已验证的来源文件")
            if not isinstance(body["locator"], dict) or not body["locator"]:
                raise ValueError("缺少原文定位")
            for field in ("quote", "prefix", "suffix"):
                if field in body and not isinstance(body[field], str):
                    raise ValueError("原文片段须为文字")
    for id_, (kind, _) in state.items():
        if kind != "folder":
            continue
        seen, cursor = set(), id_
        while cursor is not None:
            if cursor in seen:
                raise ValueError("不能将文件夹移到自己的子目录")
            if len(seen) >= 4:
                raise ValueError("共享目录最多四层，以适配 Glossa 分组")
            seen.add(cursor)
            cursor = state[cursor][1]["parent"]


def register(snapshot, records):
    """Stage only; identities never follow a changed external file silently."""
    state = dict(snapshot["entities"])
    bindings = {(x["connector"], x["external"]): (i, x)
                for i, (k, x) in state.items() if k == "binding"}
    files = {x["sha256"]: (i, x) for i, (k, x) in state.items() if k == "file"}
    edits, review = [], []

    def add(id_, kind, body):
        prior = state.get(id_, (kind, None))[1]
        if prior != body:
            edits.append({"id": id_, "kind": kind, "before": prior, "after": body})
            state[id_] = (kind, body)

    processed = set()
    for record in records:
        key = (record["connector"], record["external"])
        if key in processed:
            raise ValueError("盘点存在重复来源标识")
        processed.add(key)
        digest = record.get("sha256")
        prior = bindings.get(key)
        if prior:
            old_id, old = prior
            old_file = state.get(old.get("file"), (None, {}))[1]
            if digest and digest != old_file.get("sha256"):
                review.append({"source": key, "reason": "file-identity-changed-or-unverified"})
                continue
            material, file_id, binding_id = old["material"], old.get("file"), old_id
        else:
            file = files.get(digest)
            material = file[1]["material"] if file else stable_id("material", *key)
            binding_id = stable_id("binding", *key)
            if material not in state:
                add(material, "material", {"title": record["title"], "folder": INBOX, "aliases": []})
            file_id = None
            if digest:
                file_id = stable_id("file", digest)
                if not file:
                    body = {"sha256": digest, "material": material, "format": record["format"]}
                    add(file_id, "file", body)
                    files[digest] = (file_id, body)
        binding = {k: record[k] for k in ("connector", "external", "title", "uri", "metadata") if k in record}
        add(binding_id, "binding", {**binding, "material": material, "file": file_id})
    return {"generation": snapshot["revision"], "edits": edits, "review": review}


def sha_file(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()
