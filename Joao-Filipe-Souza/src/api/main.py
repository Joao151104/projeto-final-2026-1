from __future__ import annotations

from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi import Request, Response

from .schemas import ExplainDecisionInput, ExplainDecisionResponse, PredictResponse, TransactionInput
from .service import explain_decision, get_hourly_metrics, get_model_info, predict_transaction
from ..monitoring.observability import (
    log_event,
    observe_http_request,
    prometheus_metrics_payload,
    reset_request_id,
    set_request_id,
)

app = FastAPI(title="Fraud Detection Agent API", version="0.1.0")


@app.middleware("http")
async def observability_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id", str(uuid4()))
    token = set_request_id(request_id)
    started_at = perf_counter()

    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception as exc:
        elapsed_seconds = perf_counter() - started_at
        observe_http_request(request.method, request.url.path, 500, elapsed_seconds)
        log_event(
            "http_request_error",
            method=request.method,
            path=request.url.path,
            status=500,
            latency_ms=round(elapsed_seconds * 1000, 2),
            error_type=type(exc).__name__,
        )
        reset_request_id(token)
        raise

    elapsed_seconds = perf_counter() - started_at
    observe_http_request(request.method, request.url.path, status_code, elapsed_seconds)
    response.headers["X-Request-ID"] = request_id
    log_event(
        "http_request",
        method=request.method,
        path=request.url.path,
        status=status_code,
        latency_ms=round(elapsed_seconds * 1000, 2),
    )
    reset_request_id(token)
    return response


@app.get("/health")
def health() -> dict:
    info = get_model_info()
    return {
        "status": "ok",
        "model_loaded": info.get("model_loaded", False),
        "model_version": info.get("model_version", "unknown"),
    }


@app.get("/model-info")
def model_info() -> dict:
    return get_model_info()


@app.post("/predict", response_model=PredictResponse)
def predict(payload: TransactionInput) -> PredictResponse:
    try:
        return predict_transaction(payload)
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/explain-decision", response_model=ExplainDecisionResponse)
def explain(payload: ExplainDecisionInput) -> ExplainDecisionResponse:
    try:
        return explain_decision(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/metrics/hourly")
def hourly_metrics(hours: int = 48) -> list[dict]:
    return get_hourly_metrics(hours)


@app.get("/metrics")
def metrics() -> Response:
    payload, content_type = prometheus_metrics_payload()
    return Response(content=payload, media_type=content_type)
