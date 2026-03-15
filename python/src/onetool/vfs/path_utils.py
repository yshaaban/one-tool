from __future__ import annotations


def posix_normalize(input_path: str) -> str:
    raw = input_path if input_path.startswith("/") else f"/{input_path}"
    segments: list[str] = []

    for segment in raw.split("/"):
        if segment == "" or segment == ".":
            continue
        if segment == "..":
            if segments:
                segments.pop()
            continue
        segments.append(segment)

    return "/" + "/".join(segments)


def parent_of(normalized_path: str) -> str:
    index = normalized_path.rfind("/")
    if index <= 0:
        return "/"
    return normalized_path[:index]


def base_name(normalized_path: str) -> str:
    index = normalized_path.rfind("/")
    return normalized_path[index + 1 :]


def is_strict_descendant_path(ancestor_path: str, candidate_path: str) -> bool:
    if candidate_path == ancestor_path:
        return False
    if ancestor_path == "/":
        return candidate_path.startswith("/")
    return candidate_path.startswith(f"{ancestor_path}/")
