"""Tests for app.utils.cache.BoundedDict."""
import pytest
from app.utils.cache import BoundedDict


def test_basic_set_and_get():
    bd = BoundedDict(maxsize=3)
    bd["a"] = 1
    assert bd["a"] == 1


def test_evicts_oldest_when_full():
    bd = BoundedDict(maxsize=3)
    bd["a"] = 1
    bd["b"] = 2
    bd["c"] = 3
    # Adding 4th key should evict "a" (FIFO)
    bd["d"] = 4
    assert "a" not in bd
    assert "b" in bd
    assert "c" in bd
    assert "d" in bd
    assert len(bd) == 3


def test_update_existing_key_does_not_evict():
    bd = BoundedDict(maxsize=3)
    bd["a"] = 1
    bd["b"] = 2
    bd["c"] = 3
    bd["a"] = 99  # update, not insert
    assert len(bd) == 3
    assert "a" in bd
    assert bd["a"] == 99


def test_maxsize_one():
    bd = BoundedDict(maxsize=1)
    bd["a"] = 1
    bd["b"] = 2
    assert "a" not in bd
    assert len(bd) == 1
    assert bd["b"] == 2


def test_invalid_maxsize():
    with pytest.raises(ValueError):
        BoundedDict(maxsize=0)
    with pytest.raises(ValueError):
        BoundedDict(maxsize=-5)


def test_inherits_dict_interface():
    bd = BoundedDict(maxsize=5)
    bd.update({"x": 10, "y": 20})
    assert bd["x"] == 10
    del bd["y"]
    assert "y" not in bd


def test_fifo_ordering_preserved():
    bd = BoundedDict(maxsize=3)
    for i in range(5):
        bd[i] = i * 10
    # After 5 inserts into maxsize=3, keys 2, 3, 4 remain
    assert list(bd.keys()) == [2, 3, 4]
