"""A recoverable projection into a dedicated vault subdirectory."""

import fcntl
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import parse_qs, quote, urlsplit

from catalog import dump, fold, sha_file

MARKER = ".research-catalog.json"
LOCK = ".research-catalog.lock"
INDEX = "00 统一资料目录.md"


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def safe_uri(uri):
    if not isinstance(uri, str) or any(c.isspace() for c in uri):
        return None
    if not re.fullmatch(r"[A-Za-z0-9%:/?&=+._~;@!$,*#-]+", uri):
        return None
    url = urlsplit(uri)
    if url.scheme in {"glossa", "glossa-dev"} and url.netloc == "book":
        if re.fullmatch(r"/[A-Za-z0-9_-]+(?:/annotation/[A-Za-z0-9_-]+)?", url.path):
            return uri
    if url.scheme == "zotero" and url.netloc in {"select", "open-pdf"}:
        if re.fullmatch(r"/library/items/[A-Z0-9]{8}", url.path):
            return uri
    if url.scheme == "obsidian" and url.netloc == "open" and url.path == "":
        query = parse_qs(url.query)
        paths = query.get("path", [])
        if query.keys() == {"path"} and len(paths) == 1 and Path(paths[0]).is_absolute():
            if Path(paths[0]).suffix.lower() in {".md", ".markdown"}:
                return uri
    return None


def markdown_text(value):
    # Escape source titles as text; vault cards must not interpret source markup.
    value = " ".join(value.split())
    return re.sub(r"([\\`*_{}\[\]<>()#+.!|~>-])", r"\\\1", value)


def cards(state):
    folders = {i: b for i, (k, b) in state.items() if k == "folder"}
    bindings, relations, evidence = {}, {}, {}
    for _, (kind, body) in state.items():
        if kind == "binding":
            bindings.setdefault(body["material"], []).append(body)
        elif kind == "relation":
            relations.setdefault(body["source"], []).append(body)
        elif kind == "evidence":
            evidence.setdefault(body["material"], []).append(body)

    def directory(folder):
        record = folders[folder]
        return (directory(record["parent"]) / record["name"]
                if record["parent"] is not None else Path(record["name"]))

    def home(id_):
        _, body = state[id_]
        return directory(body["folder"]) / f"{id_}.md"

    def link(src, dst):
        return quote(os.path.relpath(dst, src.parent), safe="/")

    result, entries, children = {}, {}, {}
    for id_, body in folders.items():
        children.setdefault(body["parent"], []).append(id_)
    for id_, (kind, body) in state.items():
        if kind != "material":
            continue
        main = home(id_)
        title = markdown_text(body["title"])
        lines = ["---", f"research_catalog_id: {json.dumps(id_)}",
                 "title: " + json.dumps(body["title"], ensure_ascii=False), "---", "", f"# {title}", ""]
        for source in sorted(bindings.get(id_, ()), key=lambda b: (b["connector"], b["external"])):
            name = markdown_text(f'{source["connector"]} · {source["title"]}')
            uri = safe_uri(source.get("uri"))
            lines.append(f"- [{name}](<{uri}>)" if uri else f"- {name}（{markdown_text(source['external'])}）")
        for relation in relations.get(id_, ()):
            target = relation["target"]
            lines.append(f'- {markdown_text(relation["role"])}：'
                         f'[{markdown_text(state[target][1]["title"])}]({link(main, home(target))})')
        for anchor in evidence.get(id_, ()):
            uri = safe_uri(anchor["locator"].get("uri"))
            text = markdown_text(anchor.get("quote") or "原文位置")
            lines.append(f"- [{text}](<{uri}>)" if uri else f"- {text}（未提供可打开的位置）")
        result[main.as_posix()] = "\n".join(lines) + "\n"
        entries.setdefault(body["folder"], []).append((title, main, False))
        for folder in body["aliases"]:
            path = directory(folder) / f"{id_}.md"
            result[path.as_posix()] = (
                f'---\nresearch_catalog_id: "{id_}"\nresearch_catalog_alias: true\n---\n\n'
                f"# {title}\n\n[打开材料]({link(path, main)})\n"
            )
            entries.setdefault(folder, []).append((title, path, True))

    index = ["# 统一资料目录", "", "从材料卡打开原软件。个人笔记请写在独立笔记中。", ""]

    def add_index(parent, depth):
        for id_ in sorted(children.get(parent, ()),
                          key=lambda i: (folders[i]["order"], fold(folders[i]["name"]), i)):
            indent = "  " * depth
            index.append(f'{indent}- **{markdown_text(folders[id_]["name"])}**')
            for title, path, alias in sorted(entries.get(id_, ())):
                note = "（关联入口）" if alias else ""
                index.append(f"  {indent}- [{title}]({link(Path(INDEX), path)}){note}")
            add_index(id_, depth + 1)

    add_index(None, 0)
    result[INDEX] = "\n".join(index) + "\n"
    return result, sorted({directory(i).as_posix() for i in folders})


def scoped(root, relative):
    p = Path(relative)
    if p.is_absolute() or not p.parts or any(part in {"..", "."} for part in p.parts):
        raise ValueError("无效的投影路径")
    current = root
    for part in p.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f"投影路径含符号链接：{relative}")
    return current


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_text(path, text, *, replace=False):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
            if replace:
                os.replace(tmp, path)
            else:
                os.link(tmp, path)
            fsync_dir(path.parent)
        finally:
            tmp.unlink(missing_ok=True)


def file_digest(path):
    if path.is_symlink() or (path.exists() and not path.is_file()):
        raise ValueError(f"投影路径与现有文件冲突：{path.name}")
    return sha_file(path) if path.is_file() else None


def publish(catalog, root):
    root = root.absolute()
    if root.is_symlink() or root.parent.resolve() != root.parent or not root.parent.is_dir():
        raise ValueError("请选择现有目录下的独立投影目录，路径不能包含符号链接")
    if not root.exists():
        root.mkdir(mode=0o700)
    if not root.is_dir():
        raise ValueError("投影目标必须为目录")
    # Lock the target, not the source vault. Do not create even a lock file in
    # an unmanaged non-empty destination.
    marker = root / MARKER
    if marker.is_symlink() or (not marker.exists() and any(p.name != LOCK for p in root.iterdir())):
        raise ValueError("投影目标须为空或已由本目录管理")
    fd = os.open(root / LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "rb") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return publish_locked(catalog, root, marker)


def publish_locked(catalog, root, marker):
    target = str(root)
    with catalog.transaction():
        row = catalog.db.execute("SELECT receipt FROM projections WHERE target=?", (target,)).fetchone()
        receipt = json.loads(row[0]) if row else None
        if marker.exists():
            if not receipt or json.loads(marker.read_text()) != {"id": receipt["id"]}:
                raise ValueError("此投影目录归属另一资料库")
        elif receipt and (receipt["revision"] is not None or not receipt.get("pending")):
            raise ValueError("投影标记丢失，拒绝覆盖")
        if receipt is None:
            if any(p.name != LOCK for p in root.iterdir()):
                raise ValueError("投影目标不为空")
            from uuid import uuid4
            receipt = {"id": uuid4().hex, "files": {}, "dirs": [], "revision": None}
        if not receipt.get("pending"):
            output, dirs = cards(catalog.state())
            pending = {"files": output, "dirs": dirs, "revision": catalog.revision()}
            # An ordinary collision must not pin a generation. If publication
            # has already begun, recovery must complete the pinned generation.
            preflight(root, receipt, pending)
            receipt["pending"] = pending
            catalog.db.execute("INSERT OR REPLACE INTO projections VALUES (?,?)", (target, dump(receipt)))
        else:
            pending = receipt["pending"]
    # Receipt is durable before the first file change; resume the same
    # generation after interruption, even when new catalog edits have arrived.
    if not marker.exists():
        atomic_text(marker, dump({"id": receipt["id"]}))
    output, prior = pending["files"], receipt["files"]
    desired = preflight(root, receipt, pending)
    for relative in pending["dirs"]:
        scoped(root, relative).mkdir(parents=True, exist_ok=True)
    for relative in sorted(output):
        path = scoped(root, relative)
        actual = file_digest(path)
        if actual == desired[relative]:
            continue
        if actual != prior.get(relative):
            raise ValueError(f"投影期间文件已变化：{relative}")
        atomic_text(path, output[relative], replace=actual is not None)
    for relative in sorted(prior.keys() - desired.keys()):
        path = scoped(root, relative)
        actual = file_digest(path)
        if actual is None:
            continue
        if actual != prior[relative]:
            raise ValueError(f"投影期间文件已变化：{relative}")
        path.unlink()
        fsync_dir(path.parent)
    for relative in sorted(set(receipt["dirs"]) - set(pending["dirs"]), key=lambda p: -p.count("/")):
        path = scoped(root, relative)
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    with catalog.transaction():
        complete = {"id": receipt["id"], "files": desired, "dirs": pending["dirs"],
                    "revision": pending["revision"]}
        catalog.db.execute("UPDATE projections SET receipt=? WHERE target=?", (dump(complete), target))
        return {"published_revision": complete["revision"], "latest_revision": catalog.revision(),
                "cards": len(desired) - 1, "index": str(root / INDEX)}


def preflight(root, receipt, pending):
    prior = receipt["files"]
    desired = {p: digest(text) for p, text in pending["files"].items()}
    all_paths = prior.keys() | desired.keys()
    if {fold(p) for p in pending["dirs"]} & {fold(p) for p in desired}:
        raise ValueError("目录名与受管文件重名")
    # Prevent an old path on a case-insensitive filesystem from deleting a
    # newly written card under a different spelling.
    spellings = {}
    for relative in sorted(set(receipt["dirs"]) | set(pending["dirs"]) | all_paths):
        key = fold(relative)
        if key in spellings and spellings[key] != relative:
            raise ValueError("仅大小写或 Unicode 形式变化：请经中间目录名重命名")
        spellings[key] = relative
    for relative in pending["dirs"]:
        path = scoped(root, relative)
        if path.exists() and not path.is_dir():
            raise ValueError(f"目录与现有文件冲突：{relative}")
    for relative in sorted(all_paths):
        actual = file_digest(scoped(root, relative))
        if actual not in {prior.get(relative), desired.get(relative)}:
            raise ValueError(f"检测到投影之外的改动，已保留：{relative}")
    return desired
