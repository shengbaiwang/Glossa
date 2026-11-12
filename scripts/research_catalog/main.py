"""Command-line entry for read-only inventory and isolated catalog edits."""

import argparse
import contextlib
import json
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path

import obsidian
import sources
from catalog import Catalog, INBOX, register


def output(value):
    print(json.dumps(value, ensure_ascii=False, indent=2))


def read(path):
    if path == "-":
        return json.load(sys.stdin)
    return json.loads(Path(path).read_text(encoding="utf-8"))


def scan(connector, scope, scheme, hash_attachments):
    path = Path(scope)
    if connector == "glossa":
        return sources.glossa(path, scheme=scheme)
    if connector == "jieyi":
        return sources.jieyi(path)
    if connector == "zotero":
        return sources.zotero(hash_attachments=hash_attachments)
    if connector in {"sea", "obsidian"}:
        return sources.markdown(path, connector)
    raise ValueError("不支持的来源")


def inventory(args):
    if not 1 <= args.timeout <= 3600:
        raise ValueError("单个来源的超时须为 1–3600 秒")
    specifications = [(k, getattr(args, k)) for k in ("glossa", "jieyi", "sea", "obsidian")]
    rows = []
    for connector, paths in specifications + [("zotero", ["local"] if args.zotero else [])]:
        for path in paths:
            scope = str(Path(path).expanduser().absolute()) if connector != "zotero" else "local"
            entry = {"connector": connector, "scope": scope}
            try:
                child = subprocess.run(
                    [sys.executable, "-B", __file__, "_scan", connector, scope, args.glossa_scheme,
                     "1" if args.hash_attachments else "0"],
                    capture_output=True, timeout=args.timeout, check=False,
                )
                if child.returncode:
                    raise ValueError(child.stderr.decode(errors="replace").strip()[:800] or "盘点进程退出")
                records, folders = json.loads(child.stdout)
                entry.update(status="ready", records=records, folders=folders)
            except subprocess.TimeoutExpired:
                entry.update(status="unavailable", reason="来源读取超时；未将缺失记录视为删除")
            except (OSError, ValueError, KeyError, sqlite3.Error) as error:
                entry.update(status="unavailable", reason=str(error))
            rows.append(entry)
    if not rows:
        raise ValueError("至少选择一个盘点来源")
    output({"version": 1, "sources": rows, "suggestions": sources.preview(rows)})
    return 2 if any(r["status"] != "ready" for r in rows) else 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) == 5 and argv[0] == "_scan":
        output(scan(argv[1], argv[2], argv[3], argv[4] == "1"))
        return 0
    p = argparse.ArgumentParser(description="本机研究资料目录")
    p.add_argument("--db", type=Path, help="独立 SQLite 资料目录；写入命令必须显式指定")
    sub = p.add_subparsers(dest="action", required=True)
    inv = sub.add_parser("inventory", help="只读盘点，输出供核对的 JSON")
    for connector in ("glossa", "jieyi", "sea", "obsidian"):
        inv.add_argument("--" + connector, action="append", default=[])
    inv.add_argument("--glossa-scheme", default="glossa", choices=["glossa", "glossa-dev"])
    inv.add_argument("--zotero", action="store_true")
    inv.add_argument("--hash-attachments", action="store_true")
    inv.add_argument("--timeout", type=int, default=25, help="每个来源的读取时限（秒）")
    sub.add_parser("snapshot")
    changes = sub.add_parser("changes")
    changes.add_argument("--since", type=int, default=0)
    stage = sub.add_parser("stage", help="从盘点结果拟定登记，不写来源")
    stage.add_argument("inventory")
    stage.add_argument("--source", action="append", required=True,
                       choices=["glossa", "jieyi", "sea", "obsidian", "zotero"])
    stage.add_argument("--record", action="append", default=[], metavar="EXTERNAL_ID")
    apply = sub.add_parser("apply")
    apply.add_argument("edits")
    apply.add_argument("--op", required=True)
    undo = sub.add_parser("undo")
    undo.add_argument("original")
    undo.add_argument("--op", required=True)
    folder = sub.add_parser("folder", help="新建、重命名或移动目录")
    folder.add_argument("name")
    folder.add_argument("--id")
    folder.add_argument("--parent", help="root 表示顶层；省略则保留原父目录")
    folder.add_argument("--order", type=int)
    place = sub.add_parser("place", help="设置材料的主位置，或增减关联入口")
    place.add_argument("material")
    place.add_argument("folder")
    place.add_argument("--mode", choices=["main", "alias", "remove-alias"], default="main")
    remove = sub.add_parser("preview-remove-folder")
    remove.add_argument("folder")
    publish = sub.add_parser("publish-obsidian")
    publish.add_argument("root", type=Path)
    search = sub.add_parser("search")
    search.add_argument("query")
    open_ = sub.add_parser("open-source")
    open_.add_argument("binding")
    args = p.parse_args(argv)
    if args.action == "inventory":
        return inventory(args)
    if not args.db:
        p.error("--db 必须指向独立资料目录")
    db = args.db.expanduser()
    # A source DB passed by accident must never be initialized or upgraded.
    if db.exists():
        with sources.readonly(db) as check:
            tables = {r[0] for r in check.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables and not {"entities", "events", "projections"} <= tables:
                raise ValueError("目标不是独立资料目录")
    with contextlib.closing(Catalog(db)) as catalog:
        action = args.action
        if action == "snapshot":
            output(catalog.snapshot())
        elif action == "changes":
            output(catalog.events(args.since))
        elif action == "stage":
            document = read(args.inventory)
            if document["version"] != 1:
                raise ValueError("不支持的盘点版本")
            selected = [r for r in document["sources"] if r["connector"] in args.source]
            if set(args.source) != {r["connector"] for r in selected} or any(r["status"] != "ready" for r in selected):
                raise ValueError("选定来源盘点不完整")
            rows = [r for source in selected for r in source["records"]
                    if not args.record or r["external"] in args.record]
            if args.record and set(args.record) != {r["external"] for r in rows}:
                raise ValueError("找不到选定的来源记录")
            output(register(catalog.snapshot(), rows))
        elif action == "apply":
            spec = read(args.edits)
            result = catalog.apply(args.op, spec["edits"], generation=spec.get("generation"))
            output(result)
            return 3 if result["conflicts"] else 0
        elif action == "undo":
            output(catalog.undo(args.original, args.op))
        elif action == "preview-remove-folder":
            output(catalog.remove_folder(args.folder))
        elif action == "publish-obsidian":
            output(obsidian.publish(catalog, args.root.expanduser()))
        elif action in {"folder", "place"}:
            state = catalog.snapshot()["entities"]
            op = uuid.uuid4().hex
            if action == "folder":
                id_, kind = args.id or uuid.uuid4().hex, "folder"
                if args.id and state.get(id_, (None,))[0] != kind:
                    raise ValueError("文件夹不存在")
                before = state.get(id_, (None, None))[1]
                after = {**(before or {"parent": None, "order": 0}), "name": args.name}
                if args.parent:
                    after["parent"] = None if args.parent == "root" else args.parent
                if args.order is not None:
                    after["order"] = args.order
            else:
                id_, kind = args.material, "material"
                if state.get(id_, (None,))[0] != kind:
                    raise ValueError("材料不存在")
                before = state[id_][1]
                aliases = set(before["aliases"])
                home = before["folder"]
                if args.mode == "main":
                    home = args.folder
                    aliases.discard(home)
                elif args.mode == "alias":
                    if home == args.folder:
                        raise ValueError("该目录已经是主位置")
                    aliases.add(args.folder)
                else:
                    aliases.discard(args.folder)
                after = {**before, "folder": home, "aliases": sorted(aliases)}
            result = catalog.apply(op, [{"id": id_, "kind": kind, "before": before, "after": after}])
            output({"id": id_, "op": op, **result})
            return 3 if result["conflicts"] else 0
        elif action == "search":
            query = args.query.casefold().split()
            if not query:
                raise ValueError("请输入检索词")
            state = catalog.snapshot()["entities"]
            documents = {i: [b["title"], *b.get("tags", ())]
                         for i, (k, b) in state.items() if k == "material"}
            for _, (kind, body) in state.items():
                if kind == "binding":
                    documents[body["material"]].extend([body["title"], json.dumps(body.get("metadata", {}), ensure_ascii=False)])
            output([{"id": i, **state[i][1]} for i, fields in documents.items()
                    if all(any(word in field.casefold() for field in fields) for word in query)])
        elif action == "open-source":
            kind, record = catalog.snapshot()["entities"].get(args.binding, (None, {}))
            uri = obsidian.safe_uri(record.get("uri"))
            if kind != "binding" or not uri:
                raise ValueError("此来源没有已支持的打开链接")
            subprocess.run(["/usr/bin/open", uri], check=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, TypeError, sqlite3.Error, OSError, subprocess.CalledProcessError) as error:
        print(f"资料目录：{error}", file=sys.stderr)
        raise SystemExit(1)
