"""Error-budget remaining for an availability SLO (authoring sample of a small fresh change)."""


def remaining(slo: float, good: int, total: int) -> float:
    if not 0 < slo < 1:
        raise ValueError("slo must be between 0 and 1")
    if total <= 0:
        return 1.0
    allowed = (1 - slo) * total
    return max(0.0, 1 - (total - good) / allowed) if allowed else 0.0
