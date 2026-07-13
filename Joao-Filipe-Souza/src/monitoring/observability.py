from __future__ import annotations

import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest


_REQUEST_ID_CTX: ContextVar[str] = ContextVar("request_id", default="-")

HTTP_REQUESTS_TOTAL = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"],
)

HTTP_REQUEST_LATENCY_SECONDS = Histogram(
    "http_request_latency_seconds",
    "HTTP request latency in seconds",
    ["method", "path"],
)

AGENT_CALLS_TOTAL = Counter(
    "agent_calls_total",
    "Total agent calls",
    ["operation", "provider", "status"],
)

AGENT_LATENCY_SECONDS = Histogram(
    "agent_latency_seconds",
    "Agent call latency in seconds",
    ["operation", "provider"],
)

LLM_CALLS_TOTAL = Counter(
    "llm_calls_total",
    "Total LLM calls",
    ["model", "status"],
)

LLM_LATENCY_SECONDS = Histogram(
    "llm_latency_seconds",
    "LLM call latency in seconds",
    ["model"],
)

LLM_COST_USD_TOTAL = Counter(
    "llm_cost_usd_total",
    "Accumulated LLM cost in USD",
    ["model"],
)

LLM_PROMPT_TOKENS_TOTAL = Counter(
    "llm_prompt_tokens_total",
    "Accumulated prompt tokens",
    ["model"],
)

LLM_COMPLETION_TOKENS_TOTAL = Counter(
    "llm_completion_tokens_total",
    "Accumulated completion tokens",
    ["model"],
)

FALLBACK_TOTAL = Counter(
    "fallback_total",
    "Fallback activations",
    ["reason"],
)

GUARDRAIL_ERRORS_TOTAL = Counter(
    "guardrail_errors_total",
    "Guardrail validation errors",
    ["error_type"],
)

TOOL_CALLS_TOTAL = Counter(
    "tool_calls_total",
    "Agent tool calls",
    ["tool", "status"],
)


def configure_logging() -> None:
    logger = logging.getLogger("fraud_observability")
    if logger.handlers:
        return

    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def set_request_id(request_id: str):
    return _REQUEST_ID_CTX.set(request_id)


def reset_request_id(token) -> None:
    _REQUEST_ID_CTX.reset(token)


def get_request_id() -> str:
    return _REQUEST_ID_CTX.get()


def log_event(event: str, **fields) -> None:
    configure_logging()
    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "event": event,
        "request_id": get_request_id(),
        **fields,
    }
    logging.getLogger("fraud_observability").info(json.dumps(payload, ensure_ascii=False, default=str))


def observe_http_request(method: str, path: str, status: int, latency_seconds: float) -> None:
    HTTP_REQUESTS_TOTAL.labels(method=method, path=path, status=str(status)).inc()
    HTTP_REQUEST_LATENCY_SECONDS.labels(method=method, path=path).observe(latency_seconds)


def observe_agent_call(operation: str, provider: str, status: str, latency_seconds: float) -> None:
    AGENT_CALLS_TOTAL.labels(operation=operation, provider=provider, status=status).inc()
    AGENT_LATENCY_SECONDS.labels(operation=operation, provider=provider).observe(latency_seconds)


def observe_llm_call(
    model: str,
    status: str,
    latency_seconds: float,
    prompt_tokens: int,
    completion_tokens: int,
    cost_usd: float,
) -> None:
    LLM_CALLS_TOTAL.labels(model=model, status=status).inc()
    LLM_LATENCY_SECONDS.labels(model=model).observe(latency_seconds)

    if prompt_tokens > 0:
        LLM_PROMPT_TOKENS_TOTAL.labels(model=model).inc(prompt_tokens)
    if completion_tokens > 0:
        LLM_COMPLETION_TOKENS_TOTAL.labels(model=model).inc(completion_tokens)
    if cost_usd > 0:
        LLM_COST_USD_TOTAL.labels(model=model).inc(cost_usd)


def observe_fallback(reason: str) -> None:
    FALLBACK_TOTAL.labels(reason=reason).inc()


def observe_guardrail_error(error_type: str) -> None:
    GUARDRAIL_ERRORS_TOTAL.labels(error_type=error_type).inc()


def observe_tool_call(tool: str, status: str) -> None:
    TOOL_CALLS_TOTAL.labels(tool=tool, status=status).inc()


def prometheus_metrics_payload() -> tuple[bytes, str]:
    return generate_latest(), CONTENT_TYPE_LATEST
