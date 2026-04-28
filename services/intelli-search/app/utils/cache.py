"""Shared bounded dictionary with FIFO eviction."""
from typing import TypeVar, Generic

K = TypeVar("K")
V = TypeVar("V")


class BoundedDict(dict, Generic[K, V]):
    """A dict that evicts the oldest entry (FIFO) once it exceeds *maxsize*.

    Drop-in replacement for plain dict caches that manually do:
        if len(cache) >= maxsize:
            cache.pop(next(iter(cache)))
        cache[key] = value
    """

    def __init__(self, maxsize: int, *args, **kwargs):
        if maxsize < 1:
            raise ValueError("maxsize must be >= 1")
        self._maxsize = maxsize
        super().__init__(*args, **kwargs)

    def __setitem__(self, key: K, value: V) -> None:
        if key not in self and len(self) >= self._maxsize:
            oldest = next(iter(self))
            super().__delitem__(oldest)
        super().__setitem__(key, value)
