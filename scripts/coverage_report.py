#!/usr/bin/env python3
"""
Generate a coverage report for PR comments.

Compares coverage between base (master) and PR branches,
generates a markdown report for changed files.
"""

import argparse
import json
import sys
from pathlib import Path


def parse_coverage(coverage_file, base_path=""):
    """Parse V8/Istanbul coverage-final.json output.

    Returns dict with 'overall' percentage and 'files' dict, or None.
    """
    if not coverage_file.exists():
        return None

    try:
        with open(coverage_file) as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError):
        return None

    if not data:
        return None

    files = {}
    total_statements = 0
    covered_statements = 0

    for filepath, file_data in data.items():
        statements = file_data.get("s", {})
        num_statements = len(statements)
        num_covered = sum(1 for v in statements.values() if v > 0)

        rel_path = filepath
        if base_path:
            normalized_base = base_path.rstrip("/")
            if filepath.startswith(normalized_base + "/"):
                rel_path = filepath[len(normalized_base) + 1 :]

        if num_statements > 0:
            files[rel_path] = {
                "percent": (num_covered / num_statements) * 100,
                "covered": num_covered,
                "total": num_statements,
            }
            total_statements += num_statements
            covered_statements += num_covered

    if total_statements == 0:
        return None

    return {
        "overall": (covered_statements / total_statements) * 100,
        "files": files,
    }


def calculate_delta(base_pct, pr_pct, threshold=1.0):
    """Calculate coverage delta and determine pass/fail status."""
    if base_pct is None:
        return {"delta": None, "indicator": "NEW", "passed": True}

    delta = pr_pct - base_pct

    if delta >= 0:
        return {"delta": delta, "indicator": "+", "passed": True}
    elif delta >= -threshold:
        return {"delta": delta, "indicator": "~", "passed": True}
    else:
        return {"delta": delta, "indicator": "!", "passed": False}


def format_delta(delta_info):
    """Format delta for display in markdown table."""
    if delta_info["delta"] is None:
        return delta_info["indicator"]
    sign = "+" if delta_info["delta"] >= 0 else ""
    return f"{sign}{delta_info['delta']:.1f}% {delta_info['indicator']}"


def filter_changed_files(coverage_files, changed_files):
    """Filter coverage data to only include changed files."""
    changed_set = set(changed_files)
    return {
        filepath: data
        for filepath, data in coverage_files.items()
        if filepath in changed_set
    }


def generate_report(base_data, pr_data, changed_files, threshold=1.0):
    """Generate markdown coverage report for PR comment."""
    if not pr_data:
        return """<!-- coverage-report-marker -->
## Coverage Report

Coverage data unavailable.

No coverage artifacts were found for this PR. This can happen when:
- The test workflows have not completed yet
- The coverage artifacts failed to upload
- This is the first run on a new branch

Coverage will be reported once test workflows complete successfully.
"""

    lines = [
        "<!-- coverage-report-marker -->",
        "## Coverage Report",
        "",
        "### Summary",
        "| Metric | Coverage | Change |",
        "|--------|----------|--------|",
    ]

    pr_delta = calculate_delta(
        base_data["overall"] if base_data else None,
        pr_data["overall"],
        threshold,
    )
    delta_str = format_delta(pr_delta)
    lines.append(f"| **Overall** | {pr_data['overall']:.1f}% | {delta_str} |")

    # Changed files section
    pr_changed = {}
    if changed_files:
        pr_changed = filter_changed_files(pr_data.get("files", {}), changed_files)

    if pr_changed:
        lines.extend(
            [
                "",
                "<details>",
                "<summary>Changed Files</summary>",
                "",
                "| File | Coverage | Change |",
                "|------|----------|--------|",
            ]
        )
        for filepath, data in sorted(pr_changed.items()):
            base_pct = None
            if base_data and filepath in base_data.get("files", {}):
                base_pct = base_data["files"][filepath]["percent"]
            delta = calculate_delta(base_pct, data["percent"], threshold)
            delta_str = format_delta(delta)
            lines.append(f"| `{filepath}` | {data['percent']:.1f}% | {delta_str} |")
        lines.append("")
        lines.append("</details>")

    lines.append("")
    return "\n".join(lines)


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Generate coverage report for PR")
    parser.add_argument(
        "--base", type=Path, help="Base branch coverage-final.json"
    )
    parser.add_argument(
        "--pr", type=Path, required=True, help="PR branch coverage-final.json"
    )
    parser.add_argument(
        "--changed-files",
        type=str,
        default="",
        help="Comma-separated list of changed files",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=1.0,
        help="Max allowed coverage drop percentage",
    )
    parser.add_argument(
        "--output", type=Path, required=True, help="Output markdown file path"
    )
    parser.add_argument(
        "--base-path",
        type=str,
        default="",
        help="Base path to strip from file paths",
    )

    args = parser.parse_args()

    base_data = parse_coverage(args.base, args.base_path) if args.base else None
    pr_data = parse_coverage(args.pr, args.base_path)

    changed_files = [f.strip() for f in args.changed_files.split(",") if f.strip()]

    report = generate_report(
        base_data=base_data,
        pr_data=pr_data,
        changed_files=changed_files,
        threshold=args.threshold,
    )

    args.output.write_text(report)
    print(f"Coverage report written to {args.output}")

    passed = True
    if pr_data and base_data:
        delta = calculate_delta(
            base_data["overall"], pr_data["overall"], args.threshold
        )
        if not delta["passed"]:
            passed = False
            print(
                f"Coverage dropped by {abs(delta['delta']):.1f}% "
                f"(threshold: {args.threshold}%)"
            )

    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
