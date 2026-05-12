"""Parse the Critic's two-section output into (post_text, image_prompt)."""

import re


def extract_finalized_post(raw: str) -> tuple[str, str]:
    """Split critic output on `## Finalized Post` and `## DALL-E Prompt` headings."""
    post_match = re.search(
        r"##\s*Finalized Post\s*\n(.*?)(?=\n##\s*(?:DALL-E|Image)\s*Prompt|\Z)",
        raw,
        re.DOTALL | re.IGNORECASE,
    )
    img_match = re.search(
        r"##\s*(?:DALL-E|Image)\s*Prompt\s*\n(.*?)$",
        raw,
        re.DOTALL | re.IGNORECASE,
    )
    # Empty string on miss — DO NOT fall back to the raw crew output. The
    # raw output threads through agent reasoning that may have echoed the
    # user's topic/leader_angle verbatim; returning it leaked those inputs
    # back to the client as if they were the finished post. The caller is
    # expected to treat "" as a malformed-output error.
    post = post_match.group(1).strip() if post_match else ""
    image_prompt = img_match.group(1).strip() if img_match else ""
    return post, image_prompt


def parse_h2_sections(md: str) -> dict[str, str]:
    """Split markdown on `## ` headings → {heading: body}."""
    if not md:
        return {}
    parts = re.split(r"\n(?=## )", md)
    out: dict[str, str] = {}
    for part in parts:
        lines = part.strip().splitlines()
        if not lines:
            continue
        head = lines[0]
        if head.startswith("## "):
            out[head[3:].strip()] = "\n".join(lines[1:]).strip()
        else:
            out["__intro__"] = part.strip()
    return out
