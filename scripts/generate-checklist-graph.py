#!/usr/bin/env python3
import argparse
import re
from pathlib import Path

ID_RE = re.compile(r"^- \[([ xX])\] \*\*([A-Z0-9.]+)\*\* (.*)$")
DEP_RE = re.compile(r"_Depends on: (.*?)\._$")
BLOCKED_RE = re.compile(r"; blocked by ([A-Z0-9.,\- ]+?)\._$")
DESC_RE = re.compile(r"\s*_(Depends on|Blocks|Decision).*$")

CLUSTERS = [
    ("CT", "Cross-cutting test infrastructure"),
    ("M1", "Milestone 1: Skeleton"),
    ("M2", "Milestone 2: Rules core"),
    ("M3", "Milestone 3: Map, DB and content"),
    ("M4", "Milestone 4: Worker, API and auth"),
    ("M5", "Milestone 5: Vertical slice"),
    ("M6", "Milestone 6: Barter and social"),
    ("M7", "Milestone 7: Seasons, goals, push"),
    ("M8", "Milestone 8: Content and onboarding"),
    ("M9", "Milestone 9: Deployment and playtest"),
    ("D", "Decisions to close"),
]

STYLE_DONE = ("#dff2df", "#4d7a4d", "box", '"rounded,filled"')
STYLE_TODO = ("#ffe9cc", "#b36b00", "box", '"rounded,filled"')
STYLE_DECISION = ("#dce6f5", "#3b5b8c", "diamond", "filled")


def parse(path):
    tasks = {}
    order = []
    for line in path.read_text().splitlines():
        match = ID_RE.match(line)
        if not match:
            continue
        done = match.group(1).lower() == "x"
        task_id = match.group(2)
        rest = match.group(3)

        dep_match = DEP_RE.search(rest)
        deps = []
        if dep_match:
            raw = dep_match.group(1).split(";")[0].strip()
            if raw != "none":
                deps = [part.strip() for part in raw.split(",") if part.strip()]

        blocked_match = BLOCKED_RE.search(rest)
        blocked = (
            [part.strip() for part in blocked_match.group(1).split(",") if part.strip()]
            if blocked_match
            else []
        )

        desc = DESC_RE.sub("", rest).strip().rstrip(".").strip()
        if len(desc) > 48:
            desc = desc[:45].rstrip() + "..."

        tasks[task_id] = {
            "done": done,
            "deps": deps,
            "blocked": blocked,
            "desc": desc,
        }
        order.append(task_id)
    return tasks, order


def make_expander(order):
    index = {task_id: position for position, task_id in enumerate(order)}

    def expand(ref):
        ref = ref.strip()
        if ref.count("-") == 1:
            start, end = ref.split("-")
            if start in index and end in index:
                low, high = sorted((index[start], index[end]))
                return order[low : high + 1]
        return [ref]

    return expand


def node_id(task_id):
    return "n_" + re.sub(r"[^A-Za-z0-9]", "_", task_id)


def escape(text):
    return text.replace("\\", "\\\\").replace('"', '\\"')


def prefix(task_id):
    return task_id.split(".")[0]


def render(tasks, order):
    expand = make_expander(order)
    lines = [
        "digraph implementation_dependencies {",
        "  graph [",
        "    rankdir=LR,",
        '    fontname="Helvetica", fontsize=14,',
        '    label="Barter Village implementation checklist: task dependencies",',
        "    labelloc=t,",
        "    nodesep=0.22, ranksep=0.55,",
        "    compound=true, newrank=true,",
        '    bgcolor="white"',
        "  ];",
        '  node [shape=box, style="rounded,filled", fontname="Helvetica", fontsize=8, margin="0.06,0.03"];',
        '  edge [color="#7a7a7a", arrowsize=0.55, penwidth=0.8];',
        "",
        "  subgraph cluster_legend {",
        '    label="Legend"; fontsize=10; style="rounded,dashed"; color="#999999";',
        '    leg_done [label="completed", fillcolor="#dff2df", color="#4d7a4d"];',
        '    leg_todo [label="remaining", fillcolor="#ffe9cc", color="#b36b00"];',
        '    leg_dec  [label="decision", shape=diamond, style="filled", fillcolor="#dce6f5", color="#3b5b8c"];',
        '    leg_dep  [label="dependency", shape=plaintext, fontsize=8];',
        '    leg_blk  [label="blocked by decision", shape=plaintext, fontsize=8];',
        "    leg_done -> leg_dep [style=invis];",
        "    leg_dep -> leg_blk [style=invis];",
        "  }",
        "",
    ]

    for cluster_prefix, label in CLUSTERS:
        members = [task_id for task_id in order if prefix(task_id) == cluster_prefix]
        if not members:
            continue
        lines.append(f"  subgraph cluster_{cluster_prefix} {{")
        lines.append(
            f'    label="{escape(label)}"; fontsize=11; color="#bbbbbb"; style="rounded";'
        )
        for task_id in members:
            if cluster_prefix == "D":
                fill, color, shape, style = STYLE_DECISION
            elif tasks[task_id]["done"]:
                fill, color, shape, style = STYLE_DONE
            else:
                fill, color, shape, style = STYLE_TODO
            label = f'{task_id}\\n{escape(tasks[task_id]["desc"])}'
            lines.append(
                f'    {node_id(task_id)} [label="{label}", fillcolor="{fill}", '
                f'color="{color}", shape={shape}, style={style}];'
            )
        lines.append("  }")
        lines.append("")

    seen = set()

    def add_edge(source, target, attrs=""):
        key = (source, target)
        if key in seen:
            return
        seen.add(key)
        suffix = f" [{attrs}]" if attrs else ""
        lines.append(f"  {node_id(source)} -> {node_id(target)}{suffix};")

    for task_id in order:
        for raw in tasks[task_id]["deps"]:
            for dep in expand(raw):
                if dep in tasks:
                    add_edge(task_id, dep)

    lines.append("")
    for task_id in order:
        for raw in tasks[task_id]["blocked"]:
            for decision in expand(raw):
                if decision in tasks:
                    add_edge(
                        task_id,
                        decision,
                        'style=dashed, color="#b34747", penwidth=1.0',
                    )

    lines.append("}")
    return "\n".join(lines) + "\n", len(seen)


def main():
    parser = argparse.ArgumentParser(
        description="Generate a Graphviz dependency graph from IMPLEMENTATION_CHECKLIST.md."
    )
    parser.add_argument(
        "checklist",
        nargs="?",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "IMPLEMENTATION_CHECKLIST.md",
        help="path to the checklist (default: repo IMPLEMENTATION_CHECKLIST.md)",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "implementation-dependencies.dot",
        help="output dot file (default: repo implementation-dependencies.dot)",
    )
    args = parser.parse_args()

    tasks, order = parse(args.checklist)
    contents, edge_count = render(tasks, order)
    args.output.write_text(contents)
    print(f"wrote {args.output} with {len(tasks)} tasks and {edge_count} edges")


if __name__ == "__main__":
    main()
