#!/usr/bin/env python3
import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ID_RE = re.compile(r"^- \[ \] \*\*([A-Z0-9.]+)\*\*")
DEP_RE = re.compile(r"_Depends on: (.*)\._$")
BLOCKED_RE = re.compile(r"; blocked by ([A-Z0-9.,\- ]+?)\._$")
BLOCKS_RE = re.compile(r"_Blocks: (.*?)(?:\. Informs: .*)?\._$")
INFORMS_RE = re.compile(r"\. Informs: (.*)\._$")


def parse(path):
    lines = path.read_text().splitlines()
    tasks = {}
    order = []
    for number, line in enumerate(lines, 1):
        match = ID_RE.match(line)
        if not match:
            continue
        task_id = match.group(1)
        order.append(task_id)
        dep_match = DEP_RE.search(line)
        deps = []
        if dep_match:
            raw = dep_match.group(1).split(";")[0].strip()
            if raw != "none":
                deps = [part.strip() for part in raw.split(",") if part.strip()]
        blocked_match = BLOCKED_RE.search(line)
        blocked = []
        if blocked_match:
            blocked = [
                part.strip()
                for part in blocked_match.group(1).split(",")
                if part.strip()
            ]
        blocks_match = BLOCKS_RE.search(line)
        blocks = []
        if blocks_match:
            blocks = [
                part.strip()
                for part in blocks_match.group(1).split(",")
                if part.strip()
            ]
        informs_match = INFORMS_RE.search(line)
        informs = []
        if informs_match:
            informs = [
                part.strip()
                for part in informs_match.group(1).split(",")
                if part.strip()
            ]
        tasks[task_id] = {
            "deps": deps,
            "blocked": blocked,
            "blocks": blocks,
            "informs": informs,
            "line": number,
            "has_dep": dep_match is not None,
            "has_blocks": blocks_match is not None,
        }
    return tasks, order


def expand(ref, order, index):
    ref = ref.strip()
    if "-" in ref and ref.count("-") == 1:
        start, end = ref.split("-")
        if start in index and end in index:
            low, high = sorted((index[start], index[end]))
            return order[low : high + 1]
    return [ref]


def check(tasks, order):
    index = {task_id: position for position, task_id in enumerate(order)}
    problems = []
    edges = defaultdict(set)

    for task_id, count in Counter(order).items():
        if count > 1:
            problems.append(f"{task_id}: duplicate task ID")

    for task_id, task in tasks.items():
        if task_id.startswith("D."):
            if not task["has_blocks"]:
                problems.append(f"{task_id}:{task['line']}: decision has no Blocks annotation")
        elif not task["has_dep"]:
            problems.append(f"{task_id}:{task['line']}: task has no Depends on annotation")

        for raw in task["deps"]:
            for dep in expand(raw, order, index):
                if dep not in tasks:
                    problems.append(f"{task_id}:{task['line']}: missing dependency {dep}")
                else:
                    edges[task_id].add(dep)

        for raw in task["blocked"]:
            for decision in expand(raw, order, index):
                if decision not in tasks:
                    problems.append(f"{task_id}:{task['line']}: missing decision {decision}")
                elif not decision.startswith("D."):
                    problems.append(
                        f"{task_id}:{task['line']}: blocked by non-decision {decision}"
                    )
                else:
                    edges[task_id].add(decision)

        for label in ("blocks", "informs"):
            for raw in task[label]:
                for ref in expand(raw, order, index):
                    if ref not in tasks:
                        problems.append(
                            f"{task_id}:{task['line']}: {label} references missing {ref}"
                        )

    color = {task_id: 0 for task_id in tasks}
    stack = []
    cycles = []

    def visit(task_id):
        color[task_id] = 1
        stack.append(task_id)
        for dep in sorted(edges[task_id]):
            if color[dep] == 1:
                start = stack.index(dep)
                cycles.append(stack[start:] + [dep])
            elif color[dep] == 0:
                visit(dep)
        stack.pop()
        color[task_id] = 2

    for task_id in tasks:
        if color[task_id] == 0:
            visit(task_id)

    edge_count = sum(len(deps) for deps in edges.values())
    return problems, cycles, edge_count


def main():
    parser = argparse.ArgumentParser(
        description="Validate task IDs, references and dependency cycles in the implementation checklist."
    )
    parser.add_argument(
        "path",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "IMPLEMENTATION_CHECKLIST.md",
    )
    args = parser.parse_args()

    tasks, order = parse(args.path)
    problems, cycles, edge_count = check(tasks, order)

    print(f"tasks: {len(tasks)}")
    print(f"edges: {edge_count}")
    if problems:
        print("problems:")
        for problem in problems:
            print(f"  - {problem}")
    else:
        print("all references resolve")
    if cycles:
        print("cycles:")
        for cycle in cycles:
            print(f"  - {' -> '.join(cycle)}")
    else:
        print("no cycles")

    return 1 if problems or cycles else 0


if __name__ == "__main__":
    sys.exit(main())
