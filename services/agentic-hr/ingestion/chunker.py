"""
chunker.py — splits Markdown into parent sections and child sliding windows.
"""
import re
from config import WINDOW_SIZE, OVERLAP


def split_by_headings(markdown: str) -> list[dict]:
    """Split Markdown into sections by H1/H2/H3 boundaries."""
    sections = []
    current_heading = "Preamble"
    current_lines: list[str] = []

    for line in markdown.split("\n"):
        if re.match(r"^#{1,3}\s+", line):
            if current_lines:
                sections.append({
                    "heading": current_heading,
                    "content": "\n".join(current_lines).strip(),
                })
            current_heading = re.sub(r"^#+\s+", "", line).strip()
            current_lines = [line]
        else:
            current_lines.append(line)

    if current_lines:
        sections.append({
            "heading": current_heading,
            "content": "\n".join(current_lines).strip(),
        })

    # Drop empty sections
    return [s for s in sections if s["content"].strip()]


def create_child_windows(
    section_content: str,
    window_size: int = WINDOW_SIZE,
    overlap: int = OVERLAP,
) -> list[str]:
    """Create overlapping sliding windows (in words) within a section."""
    words = section_content.split()
    if not words:
        return []
    windows = []
    start = 0
    while start < len(words):
        end = min(start + window_size, len(words))
        window = " ".join(words[start:end])
        windows.append(window)
        if end == len(words):
            break
        start += window_size - overlap
    return windows
