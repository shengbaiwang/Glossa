"""Read-only adapters; an unavailable source never implies a deletion."""

import contextlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from catalog import SHA, fold, sha_file, stable_id

ZKEY = re.compile(r"[A-Z0-9]{8}\Z")
LOOPBACK = "http://127.0.0.1:23119/api/"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None


def request(path, *, headers=None, text=False):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    headers = {"Zotero-API-Version": "3", **(headers or {})}
    with opener.open(urllib.request.Request(LOOPBACK + path, headers=headers), timeout=4) as response:
        payload = response.read(16_000_001)
        if len(payload) > 16_000_000:
            raise ValueError("Zotero 响应过大")
        return payload.decode() if text else json.loads(payload), response.headers


def fingerprint(path):
    before = path.stat()
    digest = sha_file(path)
    after = path.stat()
    signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
    if signature(before) != signature(after):
        raise ValueError("文件在核验时发生变化")
    return digest


def zotero(*, hash_attachments=False):
    _, headers = request("", text=True)
    instance = headers.get("Zotero-Server-ID")
    if not instance or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", instance):
        raise ValueError("需要带本机实例标识的 Zotero 10 API")
    pinned = {"Zotero-Server-ID": instance}
    version = None

    def pages(route):
        nonlocal version
        for offset in range(0, 100_000, 100):
            delim = "&" if "?" in route else "?"
            rows, h = request(f"users/0/{route}{delim}limit=100&start={offset}", headers=pinned)
            v = h.get("Last-Modified-Version")
            if not v or not v.isdecimal() or (version is not None and v != version):
                raise ValueError("Zotero 盘点时库版本变化，请重试")
            version = v
            if not isinstance(rows, list) or len(rows) > 100:
                raise ValueError("无效的 Zotero 分页响应")
            yield from rows
            if len(rows) < 100:
                return
        raise ValueError("Zotero 盘点达到分页上限")

    def valid(key):
        if not isinstance(key, str) or not ZKEY.fullmatch(key):
            raise ValueError("无效的 Zotero 记录标识")
        return key

    cols = {valid(row["key"]): row["data"] for row in pages("collections")}

    def path(key):
        names, visited = [], set()
        while key:
            if key in visited or key not in cols:
                raise ValueError("Zotero 集合层级不完整")
            visited.add(key)
            names.append(cols[key]["name"])
            key = cols[key].get("parentCollection")
        return list(reversed(names))

    items = {valid(row["key"]): row["data"] for row in pages("items")}
    _, end = request("users/0/items?limit=1", headers=pinned)
    if end.get("Last-Modified-Version") != version:
        raise ValueError("Zotero 盘点时库版本变化，请重试")

    records = []
    for key, item in items.items():
        kind = item["itemType"]
        if kind in {"note", "annotation"}:
            continue
        parent_key = item.get("parentItem")
        parent = items.get(parent_key, item)
        if kind == "attachment" and item.get("contentType") not in ("application/pdf", "application/epub+zip"):
            continue
        record = {
            "connector": "zotero", "external": f"{instance}:{key}",
            "title": (item.get("title") or parent.get("title") or key)[:240],
            "uri": f"zotero://select/library/items/{key}",
            "paths": [path(k) for k in parent.get("collections", ()) if k in cols],
            "metadata": {"type": kind, "parent": parent_key, "doi": parent.get("DOI"),
                         "isbn": parent.get("ISBN"), "authors": parent.get("creators", [])},
        }
        if kind == "attachment" and hash_attachments:
            try:
                link, h = request(f"users/0/items/{key}/file/view/url", headers=pinned, text=True)
                url = urllib.parse.urlparse(link.strip())
                if url.scheme == "file" and not (url.netloc or url.query or url.fragment):
                    record.update(sha256=fingerprint(Path(urllib.parse.unquote(url.path))),
                                  format="pdf" if item["contentType"] == "application/pdf" else "epub")
            except (OSError, ValueError):
                record["metadata"]["file_status"] = "unverified"
        records.append(record)
    _, end = request("users/0/items?limit=1", headers=pinned)
    if end.get("Last-Modified-Version") != version:
        raise ValueError("Zotero 附件核验时库版本变化，请重试")
    return records, [path(k) for k in cols]


@contextlib.contextmanager
def readonly(path):
    with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=1)) as db:
        db.execute("PRAGMA query_only=ON")
        db.row_factory = sqlite3.Row
        yield db


@contextlib.contextmanager
def glossa_snapshot(path):
    # Turso and SQLite locking protocols differ. Never open the live DB with
    # SQLite; read a verified stable copy of DB + WAL and recover only the copy.
    wal = path.with_name(path.name + "-wal")
    for _ in range(3):
        with tempfile.TemporaryDirectory(prefix="research-catalog-") as directory:
            copy = Path(directory) / path.name
            try:
                sources = [path] + ([wal] if wal.exists() else [])
                pairs = [(p, copy.with_name(p.name)) for p in sources]
                before = [fingerprint(p) for p in sources]
                for src, target in pairs:
                    shutil.copyfile(src, target)
                if (wal.exists() != (wal in sources)
                        or before != [fingerprint(src) for src, _ in pairs]
                        or before != [sha_file(target) for _, target in pairs]):
                    continue
            except (FileNotFoundError, ValueError):
                continue
            # Writable only inside the temporary directory for WAL recovery.
            with contextlib.closing(sqlite3.connect(copy)) as db:
                db.execute("PRAGMA query_only=ON")
                if db.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                    raise ValueError("Glossa 书库副本校验失败")
                yield db
                return
    raise ValueError("Glossa 书库正在变化，未取得稳定副本")


def glossa(path, *, scheme="glossa"):
    if scheme not in {"glossa", "glossa-dev"}:
        raise ValueError("未知的 Glossa 版本")
    scope = stable_id(str(path.resolve()))
    records, folders = [], set()
    with glossa_snapshot(path) as db:
        marker = db.execute("SELECT payload FROM glossa_library_entries WHERE key='meta:version'").fetchone()
        if not marker or json.loads(marker[0]).get("version") != 1:
            raise ValueError("不支持的 Glossa 书库版本")
        rows = db.execute("SELECT key,payload FROM glossa_library_entries WHERE key LIKE 'book:%'")
        for key, payload in rows:
            book = json.loads(payload)
            book_id = book["hash"]
            if key != f"book:{book_id}" or not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", book_id):
                raise ValueError("无效的 Glossa 书籍记录")
            if book.get("deletedAt") or book.get("duplicateOf"):
                continue
            name = book.get("groupName")
            group = tuple(name.split("/")) if name else ()
            if group:
                folders.add(group)
            record = {
                "connector": "glossa", "external": f"{scope}:{book_id}",
                "title": (book.get("title") or book_id)[:240],
                "uri": f"{scheme}://book/{book_id}", "paths": [list(group)] if group else [],
                "metadata": {"author": book.get("author"), "zotero": book.get("zoteroSource")},
            }
            # Glossa labels its complete-byte digest; the shared catalog stores hex.
            raw_digest = book.get("contentFingerprint")
            digest = raw_digest[7:] if isinstance(raw_digest, str) and raw_digest.startswith("sha256:") else None
            if book.get("format") in {"PDF", "EPUB"} and not book.get("webSource") and SHA.fullmatch(digest or ""):
                record.update(sha256=digest, format=book["format"].lower())
            records.append(record)
    return records, [list(group) for group in sorted(folders)]


def jieyi(path):
    scope = stable_id(str(path.resolve()))
    records, folders = [], set()
    with readonly(path) as db:
        db.execute("BEGIN")
        for doc in db.execute("""SELECT d.id,d.title,d.source_hash,d.source_format,p.name,p.id AS project_id
                                 FROM documents d JOIN projects p ON d.project_id=p.id ORDER BY d.id"""):
            folders.add(doc["name"])
            record = {"connector": "jieyi", "external": f'{scope}:{doc["id"]}',
                      "title": (doc["title"] or doc["id"])[:240], "paths": [[doc["name"]]],
                      "metadata": {"project": doc["project_id"], "document": doc["id"],
                                   "project_name": doc["name"]}}
            if doc["source_format"] in {"pdf", "epub"} and SHA.fullmatch(doc["source_hash"] or ""):
                record.update(sha256=doc["source_hash"], format=doc["source_format"])
            records.append(record)
    return records, [[p] for p in sorted(folders)]


def sea_key(header):
    if header.startswith("---\n"):
        section, sep, _ = header[4:].partition("\n---")
        if sep:
            match = re.search(r'^sea_id:\s*["\']?([\w:.-]{1,160})["\']?\s*$', section, re.M)
            if match:
                return match[1]
    return None


def markdown(root, connector):
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError("笔记库路径不是目录")
    scope = stable_id(str(root))
    records, folders = [], []
    def on_error(error):
        raise error

    for directory, children, files in os.walk(root, followlinks=False, onerror=on_error):
        d = Path(directory)
        children[:] = sorted(c for c in children if not c.startswith(".")
                             and not (d / c).is_symlink()
                             and not (d / c / ".research-catalog.json").exists())
        parts = d.relative_to(root).parts
        if parts:
            folders.append(list(parts))
        for file in sorted(files):
            p = d / file
            if p.is_symlink() or p.suffix.lower() not in {".md", ".markdown"} or file.startswith("."):
                continue
            sea_id = None
            if connector == "sea":
                with p.open("rb") as stream:
                    header = stream.read(8192).decode("utf-8", errors="replace").replace("\r\n", "\n")
                sea_id = sea_key(header)
            rel = p.relative_to(root).as_posix()
            records.append({"connector": connector, "external": f"{scope}:{sea_id or stable_id(rel)}",
                            "title": p.stem[:240], "paths": [list(parts)] if parts else [],
                            "uri": "obsidian://open?" + urllib.parse.urlencode({"path": str(p)}),
                            "metadata": {"relative_path": rel, "sea_id": sea_id,
                                         "identity": "sea_id" if sea_id else "path"}})
    return records, folders


def preview(sources):
    """Group only suggestions; leave every proposed mapping for review."""
    by_path, by_leaf, by_file, by_title, by_reference = {}, {}, {}, {}, {}
    members, by_member = {}, {}
    for source in sources:
        connector, scope = source["connector"], source["scope"]
        for path in source.get("folders", []):
            key = tuple(fold(p) for p in path)
            entry = {"connector": connector, "scope": scope, "path": path}
            by_path.setdefault(key, []).append(entry)
            by_leaf.setdefault(key[-1], []).append(entry)
        for row in source.get("records", []):
            key = [row["connector"], row["external"]]
            if row.get("sha256"):
                digest = row["sha256"]
                by_file.setdefault(digest, []).append(key)
                for path in row.get("paths", []):
                    for size in range(1, len(path) + 1):
                        node = (connector, scope, tuple(path[:size]))
                        members.setdefault(node, set()).add(digest)
                        by_member.setdefault(digest, set()).add(node)
            title = row["title"]
            if title:
                by_title.setdefault(fold(title), []).append(key)
            metadata = row.get("metadata", {})
            identifiers = metadata.get("zotero") or metadata
            doi = identifiers.get("doi") or identifiers.get("DOI")
            isbn = identifiers.get("isbn")
            if isinstance(doi, str):
                doi = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", doi.strip().lower())
                if doi.startswith("10.") and "/" in doi:
                    by_reference.setdefault(("doi", doi), []).append(key)
            if isinstance(isbn, str):
                isbn = re.sub(r"[-\s]", "", isbn.upper())
                if re.fullmatch(r"(?:\d{9}[\dX]|\d{13})", isbn):
                    by_reference.setdefault(("isbn", isbn), []).append(key)
    pairs = {}
    for nodes in by_member.values():
        # Compare immediate folders across sources. Ancestors are included to
        # expose plausible matches between differently nested taxonomies.
        nodes = sorted(nodes)
        for i, left in enumerate(nodes):
            for right in nodes[i + 1:]:
                if left[:2] != right[:2]:
                    pairs[(left, right)] = pairs.get((left, right), 0) + 1
    overlap = []
    for (left, right), count in sorted(pairs.items(), key=lambda pair: (-pair[1], pair[0])):
        union = len(members[left]) + len(members[right]) - count
        overlap.append({"left": left, "right": right, "same_files": count, "union": union})
    return {
        "matching_paths": [items for items in by_path.values() if len(items) > 1],
        "same_leaf_different_path": [items for items in by_leaf.values()
                                     if len({tuple(fold(p) for p in e["path"]) for e in items}) > 1],
        "identical_files": [items for items in by_file.values() if len(items) > 1],
        "title_candidates": [items for items in by_title.values() if len(items) > 1],
        "bibliographic_candidates": [{"type": key[0], "value": key[1], "records": items}
                                    for key, items in by_reference.items() if len(items) > 1],
        "folder_member_overlap": overlap,
    }
