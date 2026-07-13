from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

import numpy as np


@dataclass
class ThresholdResult:
    threshold: float
    expected_cost: float
    precision: float
    recall: float
    false_positives: int
    false_negatives: int


def _safe_div(num: float, den: float) -> float:
    return num / den if den else 0.0


def choose_threshold_by_cost(
    y_true: Iterable[int],
    y_score: Iterable[float],
    cost_fp: float = 1.0,
    cost_fn: float = 20.0,
    min_recall: float = 0.0,
    thresholds: int = 1001,
) -> ThresholdResult:
    """Choose threshold that minimizes cost under an optional recall constraint."""
    y_true_arr = np.asarray(list(y_true), dtype=int)
    y_score_arr = np.asarray(list(y_score), dtype=float)

    if y_true_arr.shape[0] != y_score_arr.shape[0]:
        raise ValueError("y_true and y_score must have the same length")

    if y_true_arr.size == 0:
        raise ValueError("y_true and y_score cannot be empty")

    best: ThresholdResult | None = None

    for t in np.linspace(0.0, 1.0, thresholds):
        y_pred = (y_score_arr >= t).astype(int)

        tp = int(np.sum((y_pred == 1) & (y_true_arr == 1)))
        fp = int(np.sum((y_pred == 1) & (y_true_arr == 0)))
        fn = int(np.sum((y_pred == 0) & (y_true_arr == 1)))

        precision = _safe_div(tp, tp + fp)
        recall = _safe_div(tp, tp + fn)
        expected_cost = cost_fp * fp + cost_fn * fn

        if recall < min_recall:
            continue

        candidate = ThresholdResult(
            threshold=float(t),
            expected_cost=float(expected_cost),
            precision=float(precision),
            recall=float(recall),
            false_positives=fp,
            false_negatives=fn,
        )

        if best is None or candidate.expected_cost < best.expected_cost:
            best = candidate

    if best is None:
        raise ValueError("No threshold satisfies min_recall constraint")

    return best
