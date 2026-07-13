from __future__ import annotations

import json
import os
from urllib import error as url_error
from urllib import request as url_request
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from uuid import uuid4

import joblib
import numpy as np
import pandas as pd

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

from .schemas import ExplainDecisionInput, ExplainDecisionResponse, PredictResponse, TransactionInput
from ..monitoring.observability import (
    log_event,
    observe_agent_call,
    observe_fallback,
    observe_guardrail_error,
    observe_llm_call,
    observe_tool_call,
)


DATASET_PATH = Path(__file__).resolve().parents[2] / "creditcard.csv"
ARTIFACTS_DIR = Path(__file__).resolve().parents[2] / "artifacts"
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
MODEL_PATH = ARTIFACTS_DIR / "xgboost_model.joblib"
METADATA_PATH = ARTIFACTS_DIR / "xgboost_metadata.json"
DEFAULT_THRESHOLD = 0.50
DEFAULT_MODEL_VERSION = "xgboost-unknown"
OPENAI_API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

MODEL_PRICING_USD_PER_1M: dict[str, dict[str, float]] = {
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
}

ENGINEERED_FEATURES = {
    "Amount_log",
    "Hour",
    "Time_sin",
    "Time_cos",
    "Day",
    "V_mean",
    "V_std",
    "V_abs_max",
    "V_l2_norm",
}


def _load_env_with_fallback(env_path: Path) -> None:
    # Prefer python-dotenv when available; otherwise parse a basic KEY=VALUE .env.
    if load_dotenv is not None:
        load_dotenv(dotenv_path=env_path)
        return

    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_env_with_fallback(ENV_PATH)


@lru_cache(maxsize=1)
def _load_model() -> object:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            "Artifact do modelo nao encontrado. Execute o notebook para salvar "
            "xgboost_model.joblib em artifacts/."
        )

    try:
        return joblib.load(MODEL_PATH)
    except ModuleNotFoundError as exc:
        if exc.name == "xgboost":
            raise RuntimeError(
                "Dependencia ausente: xgboost. Instale com `pip install -r requirements.txt` "
                "ou `pip install xgboost`."
            ) from exc
        raise


@lru_cache(maxsize=1)
def _load_model_metadata() -> tuple[dict, list[str], float, str]:
    if not METADATA_PATH.exists():
        raise FileNotFoundError(
            "Artifact de metadados nao encontrado. Execute o notebook para salvar "
            "xgboost_metadata.json em artifacts/."
        )

    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    features = metadata.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Metadado invalido: 'features' ausente ou vazio")

    threshold = float(metadata.get("threshold", DEFAULT_THRESHOLD))
    model_version = str(metadata.get("model_version", DEFAULT_MODEL_VERSION))
    return metadata, features, threshold, model_version


@lru_cache(maxsize=1)
def _load_inference_artifacts() -> tuple[object, dict, list[str], float, str]:
    model = _load_model()
    metadata, features, threshold, model_version = _load_model_metadata()
    return model, metadata, features, threshold, model_version


def get_model_info() -> dict:
    try:
        metadata, features, threshold, model_version = _load_model_metadata()
    except (FileNotFoundError, ValueError) as exc:
        return {
            "model_loaded": False,
            "error": str(exc),
            "model_path": str(MODEL_PATH),
            "metadata_path": str(METADATA_PATH),
        }

    model_loaded = True
    model_error = None
    try:
        _load_model()
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        model_loaded = False
        model_error = str(exc)

    response = {
        "model_loaded": True,
        "model_version": model_version,
        "threshold": threshold,
        "features": features,
        "feature_engineering_features": [feature for feature in features if feature in ENGINEERED_FEATURES],
        "feature_engineering_enabled": any(feature in ENGINEERED_FEATURES for feature in features),
        "n_features": len(features),
        "validation_metrics": metadata.get("validation_metrics", {}),
        "metadata_path": str(METADATA_PATH),
        "model_path": str(MODEL_PATH),
        "metadata": metadata,
    }
    response["model_loaded"] = model_loaded
    if model_error is not None:
        response["model_error"] = model_error
    return response


def _decide(score: float, threshold: float) -> tuple[str, str]:
    if score >= threshold + 0.03:
        return "fraude", "bloquear"
    if threshold - 0.03 <= score < threshold + 0.03:
        return "fraude", "revisar"
    return "legitima", "liberar"


def _apply_feature_engineering_for_inference(row: pd.DataFrame) -> pd.DataFrame:
    engineered_row = row.copy()

    v_columns = [f"V{i}" for i in range(1, 29)]
    has_v_columns = all(col in engineered_row.columns for col in v_columns)

    if "Amount" in engineered_row.columns and "Amount_log" not in engineered_row.columns:
        engineered_row["Amount_log"] = np.log1p(engineered_row["Amount"])

    if "Time" in engineered_row.columns:
        seconds_in_day = 24 * 60 * 60
        if "Hour" not in engineered_row.columns:
            engineered_row["Hour"] = ((engineered_row["Time"] % seconds_in_day) // 3600).astype(int)
        angle = 2 * np.pi * (engineered_row["Time"] % seconds_in_day) / seconds_in_day
        if "Time_sin" not in engineered_row.columns:
            engineered_row["Time_sin"] = np.sin(angle)
        if "Time_cos" not in engineered_row.columns:
            engineered_row["Time_cos"] = np.cos(angle)
        if "Day" not in engineered_row.columns:
            engineered_row["Day"] = (engineered_row["Time"] // seconds_in_day).astype(int)

    if has_v_columns:
        v_data = engineered_row[v_columns]
        if "V_mean" not in engineered_row.columns:
            engineered_row["V_mean"] = v_data.mean(axis=1)
        if "V_std" not in engineered_row.columns:
            engineered_row["V_std"] = v_data.std(axis=1)
        if "V_abs_max" not in engineered_row.columns:
            engineered_row["V_abs_max"] = v_data.abs().max(axis=1)
        if "V_l2_norm" not in engineered_row.columns:
            engineered_row["V_l2_norm"] = np.sqrt((v_data**2).sum(axis=1))

    return engineered_row


def _build_top_factors(model: object, model_features: list[str], row_for_model: pd.DataFrame, limit: int = 5) -> dict[str, float]:
    # Prefer model global importances to avoid raw-scale bias (e.g., Time magnitude).
    importances = getattr(model, "feature_importances_", None)
    if importances is not None and len(importances) == len(model_features):
        importance_map = {feature: float(importance) for feature, importance in zip(model_features, importances)}
        ranked = sorted(model_features, key=lambda feat: importance_map.get(feat, 0.0), reverse=True)
        selected = [feat for feat in ranked if importance_map.get(feat, 0.0) > 0][:limit]
        if selected:
            return {feat: float(row_for_model.iloc[0][feat]) for feat in selected}

    row_values = row_for_model.iloc[0].to_dict()
    ranked_items = sorted(
        row_values.items(),
        key=lambda item: abs(float(item[1])),
        reverse=True,
    )
    return {k: float(v) for k, v in ranked_items[:limit]}


def _predict_score(tx: TransactionInput) -> tuple[float, float, str, list[str], dict, object, pd.DataFrame]:
    model, metadata, features, threshold, model_version = _load_inference_artifacts()
    tx_dict = tx.model_dump()
    row = pd.DataFrame([tx_dict])
    row = _apply_feature_engineering_for_inference(row)

    missing = [col for col in features if col not in row.columns]
    if missing:
        raise ValueError(f"Transacao sem features obrigatorias: {missing}")

    row = row[features]
    score = float(model.predict_proba(row)[0, 1])
    return score, threshold, model_version, features, metadata, model, row


@lru_cache(maxsize=1)
def _load_hourly_metrics() -> list[dict]:
    if not DATASET_PATH.exists():
        return []

    df = pd.read_csv(DATASET_PATH, usecols=["Time", "Amount", "Class"])
    df["hour_bucket"] = (df["Time"] // 3600).astype(int)

    aggregated = (
        df.groupby("hour_bucket", as_index=False)
        .agg(
            transactions=("Class", "size"),
            fraud_rate=("Class", "mean"),
            amount_p95=("Amount", lambda series: float(series.quantile(0.95))),
        )
        .sort_values("hour_bucket")
    )

    aggregated["api_error_rate"] = (aggregated["fraud_rate"] * 100).clip(0.02, 5.0)
    aggregated["timestamp"] = aggregated["hour_bucket"].apply(
        lambda bucket: (datetime(2024, 1, 1, tzinfo=timezone.utc) + pd.Timedelta(hours=int(bucket))).isoformat()
    )
    aggregated["hour"] = aggregated["hour_bucket"].apply(lambda bucket: f"{int(bucket) % 24:02d}:00")

    return [
        {
            "hour": str(row["hour"]),
            "timestamp": str(row["timestamp"]),
            "fraud_rate": float(row["fraud_rate"]),
            "amount_p95": float(row["amount_p95"]),
            "transactions": int(row["transactions"]),
            "api_error_rate": float(row["api_error_rate"]),
        }
        for _, row in aggregated.iterrows()
    ]


def get_hourly_metrics(hours: int = 48) -> list[dict]:
    series = _load_hourly_metrics()
    if hours <= 0:
        return []
    return series[-hours:]


def predict_transaction(tx: TransactionInput, threshold: float | None = None) -> PredictResponse:
    score, model_threshold, model_version, model_features, metadata, model, row_for_model = _predict_score(tx)
    threshold_used = model_threshold if threshold is None else float(threshold)
    decisao, recomendacao = _decide(score, threshold_used)

    top_fatores = _build_top_factors(model, model_features, row_for_model, limit=5)

    has_engineered = any(feature in ENGINEERED_FEATURES for feature in model_features)
    if has_engineered:
        explicacao = (
            "Decisao baseada na probabilidade prevista pelo XGBoost com features originais e de "
            "feature engineering, comparada ao threshold operacional."
        )
    else:
        explicacao = (
            "Decisao baseada na probabilidade prevista pelo XGBoost comparada ao threshold operacional. "
            "Observacao: o artefato atual nao inclui features de feature engineering."
        )

    return PredictResponse(
        transaction_id=str(uuid4()),
        timestamp=datetime.now(timezone.utc),
        score_fraude=score,
        limiar_usado=threshold_used,
        decisao=decisao,
        recomendacao_operacional=recomendacao,
        explicacao=explicacao,
        top_fatores={k: float(v) for k, v in top_fatores.items()},
        model_version=model_version,
    )


def _fallback_decision_explanation(payload: ExplainDecisionInput) -> str:
    score_pct = payload.score_fraude * 100
    limiar_pct = payload.limiar_usado * 100
    margem = score_pct - limiar_pct
    diferenca_abs_pct = abs(margem)

    fatores_ordenados = sorted(payload.top_fatores.items(), key=lambda item: abs(float(item[1])), reverse=True)
    fatores_fmt = ", ".join(f"{nome}={valor:.3f}" for nome, valor in fatores_ordenados[:3])
    fatores_txt = fatores_fmt if fatores_fmt else "sem fatores destacados"
    engineered_in_top = [nome for nome, _ in fatores_ordenados if nome in ENGINEERED_FEATURES]

    fatores_com_zona = _build_factor_zone_summary(payload.top_fatores, limit=2)
    if fatores_com_zona:
        if payload.decisao == "fraude":
            fator_causal_txt = (
                f"Os parametros mais extremos foram {fatores_com_zona}, e esse padrao elevou o risco da transacao."
            )
        else:
            fator_causal_txt = (
                f"Os parametros com maior impacto foram {fatores_com_zona}, mas sem formar um padrao forte de fraude."
            )
    else:
        fator_causal_txt = (
            "Nao recebi os parametros V1..V28 desta linha para identificar um fator principal. "
            "Reenvie a transacao para gerar explicacao causal completa."
        )

    limiar_txt = "acima" if margem >= 0 else "abaixo"

    return (
        f"A transacao foi classificada como {payload.decisao}. "
        f"{fator_causal_txt} "
        f"O score final ficou {score_pct:.2f}% ({limiar_txt} do limiar de {limiar_pct:.2f}% em {diferenca_abs_pct:.2f} p.p.). "
        f"Acao recomendada: {payload.recomendacao_operacional}. "
        f"Principais fatores numericos observados: {fatores_txt}. "
        + (
            "A explicacao inclui features de engenharia (ex: Amount_log, Hour, Time_sin/Time_cos, agregados de V)."
            if engineered_in_top
            else ""
        )
    )


def _factor_risk_zone(value: float) -> str:
    abs_value = abs(float(value))
    if abs_value >= 5.0:
        return "zona critica"
    if abs_value >= 3.0:
        return "zona de alto risco"
    if abs_value >= 1.5:
        return "zona de atencao"
    return "zona normal"


def _build_factor_zone_summary(top_fatores: dict, limit: int = 2) -> str:
    if not top_fatores:
        return ""

    fatores_ordenados = sorted(top_fatores.items(), key=lambda item: abs(float(item[1])), reverse=True)
    partes = []
    for nome, valor in fatores_ordenados[:limit]:
        zona = _factor_risk_zone(float(valor))
        partes.append(f"{nome}={float(valor):.3f} ({zona})")

    return " e ".join(partes)


def _build_openai_prompt(payload: ExplainDecisionInput) -> str:
    fatores_ordenados = sorted(payload.top_fatores.items(), key=lambda item: abs(float(item[1])), reverse=True)
    fatores = [{"feature": nome, "valor": float(valor)} for nome, valor in fatores_ordenados[:5]]
    score_fraude = float(payload.score_fraude)
    limiar_usado = float(payload.limiar_usado)
    passou_limiar = score_fraude >= limiar_usado
    diferenca_limiar_pp = (score_fraude - limiar_usado) * 100.0
    fatores_interpretados = [
        {
            "feature": nome,
            "valor": float(valor),
            "zona_risco": _factor_risk_zone(float(valor)),
        }
        for nome, valor in fatores_ordenados[:5]
    ]

    return json.dumps(
        {
            "transaction_id": payload.transaction_id,
            "timestamp": payload.timestamp.isoformat() if payload.timestamp else None,
            "amount": float(payload.amount),
            "score_fraude": score_fraude,
            "limiar_usado": limiar_usado,
            "passou_limiar_fraude": passou_limiar,
            "diferenca_limiar_pp": diferenca_limiar_pp,
            "decisao": payload.decisao,
            "recomendacao_operacional": payload.recomendacao_operacional,
            "top_fatores": fatores,
            "top_fatores_interpretados": fatores_interpretados,
        },
        ensure_ascii=False,
    )


def _estimate_llm_cost_usd(model_name: str, prompt_tokens: int, completion_tokens: int) -> float:
    input_price_env = os.getenv("OPENAI_PRICE_INPUT_PER_1M")
    output_price_env = os.getenv("OPENAI_PRICE_OUTPUT_PER_1M")

    if input_price_env is not None and output_price_env is not None:
        input_price = float(input_price_env)
        output_price = float(output_price_env)
    else:
        pricing = MODEL_PRICING_USD_PER_1M.get(model_name, MODEL_PRICING_USD_PER_1M[DEFAULT_OPENAI_MODEL])
        input_price = float(pricing["input"])
        output_price = float(pricing["output"])

    return (prompt_tokens * input_price + completion_tokens * output_price) / 1_000_000


def _validate_guardrails(content: str, payload: ExplainDecisionInput) -> str | None:
    text = content.strip()
    if not text:
        return "empty_response"

    lowered = text.lower()
    if "limiar" not in lowered and "threshold" not in lowered:
        return "missing_threshold_reference"

    if payload.top_fatores:
        has_factor_reference = any(feature.lower() in lowered for feature in payload.top_fatores)
        if not has_factor_reference:
            return "missing_factor_reference"

    if len(text) > 1200:
        return "response_too_long"

    return None


def _safe_agent_input_summary(payload: ExplainDecisionInput) -> dict:
    return {
        "has_transaction_id": payload.transaction_id is not None,
        "score_fraude": float(payload.score_fraude),
        "limiar_usado": float(payload.limiar_usado),
        "decisao": payload.decisao,
        "recomendacao_operacional": payload.recomendacao_operacional,
        "n_top_fatores": len(payload.top_fatores),
        "top_fatores_keys": list(payload.top_fatores.keys())[:5],
    }


def explain_decision(payload: ExplainDecisionInput) -> ExplainDecisionResponse:
    operation = "explain_decision"
    started_at = perf_counter()

    api_key = os.getenv("OPENAI_API_KEY")
    model_name = os.getenv("OPENAI_MODEL", DEFAULT_OPENAI_MODEL)
    fallback_text = _fallback_decision_explanation(payload)

    log_event(
        "agent_input",
        operation=operation,
        provider="openai_or_fallback",
        input_summary=_safe_agent_input_summary(payload),
    )

    if not api_key:
        observe_fallback("missing_api_key")
        elapsed = perf_counter() - started_at
        observe_agent_call(operation=operation, provider="fallback", status="ok", latency_seconds=elapsed)
        log_event(
            "agent_response",
            operation=operation,
            provider="fallback",
            fallback_reason="missing_api_key",
            latency_ms=round(elapsed * 1000, 2),
        )
        return ExplainDecisionResponse(explanation=fallback_text, provider="fallback", model=None)

    request_payload = {
        "model": model_name,
        "temperature": 0.2,
        "max_tokens": 220,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Voce e um analista de fraude em cartao. Explique em portugues brasileira, em 3 a 5 frases. "
                    "Foque primeiro no motivo causal da decisao: quais parametros (ex: V14, V17) puxaram o risco e em qual zona de risco eles estao. "
                    "Quando houver features derivadas (ex: Amount_log, Hour, Time_sin, Time_cos, V_mean), explique o papel delas tambem. "
                    "Depois, em no maximo uma frase, relacione com score e limiar. "
                    "Nao faca texto genérico e nao invente dados. Use apenas os fatores fornecidos."
                ),
            },
            {
                "role": "user",
                "content": _build_openai_prompt(payload),
            },
        ],
    }

    req = url_request.Request(
        OPENAI_API_URL,
        data=json.dumps(request_payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    llm_started_at = perf_counter()
    observe_tool_call("openai_chat_completions", "started")
    log_event(
        "agent_tools_invoked",
        operation=operation,
        tools=["openai_chat_completions"],
        model=model_name,
    )

    try:
        with url_request.urlopen(req, timeout=20) as response:
            body = response.read().decode("utf-8")
            parsed = json.loads(body)

        usage = parsed.get("usage", {})
        prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
        completion_tokens = int(usage.get("completion_tokens", 0) or 0)
        llm_elapsed = perf_counter() - llm_started_at
        llm_cost = _estimate_llm_cost_usd(model_name, prompt_tokens, completion_tokens)
        observe_tool_call("openai_chat_completions", "ok")
        observe_llm_call(
            model=model_name,
            status="ok",
            latency_seconds=llm_elapsed,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_usd=llm_cost,
        )

        content = (
            parsed.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

        guardrail_error = _validate_guardrails(content, payload)
        if guardrail_error is not None:
            observe_guardrail_error(guardrail_error)
            observe_fallback("guardrail")
            total_elapsed = perf_counter() - started_at
            observe_agent_call(operation=operation, provider="fallback", status="ok", latency_seconds=total_elapsed)
            log_event(
                "guardrail_failed",
                operation=operation,
                model=model_name,
                error_type=guardrail_error,
            )
            log_event(
                "agent_response",
                operation=operation,
                provider="fallback",
                fallback_reason="guardrail",
                model=model_name,
                llm_latency_ms=round(llm_elapsed * 1000, 2),
                agent_latency_ms=round(total_elapsed * 1000, 2),
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                llm_cost_usd=round(llm_cost, 8),
            )
            return ExplainDecisionResponse(explanation=fallback_text, provider="fallback", model=None)

        total_elapsed = perf_counter() - started_at
        observe_agent_call(operation=operation, provider="openai", status="ok", latency_seconds=total_elapsed)
        log_event(
            "agent_response",
            operation=operation,
            provider="openai",
            model=model_name,
            llm_latency_ms=round(llm_elapsed * 1000, 2),
            agent_latency_ms=round(total_elapsed * 1000, 2),
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            llm_cost_usd=round(llm_cost, 8),
        )

        return ExplainDecisionResponse(explanation=content, provider="openai", model=model_name)
    except (TimeoutError, ValueError, KeyError, IndexError, json.JSONDecodeError, url_error.URLError) as exc:
        llm_elapsed = perf_counter() - llm_started_at
        observe_tool_call("openai_chat_completions", "error")
        observe_llm_call(
            model=model_name,
            status="error",
            latency_seconds=llm_elapsed,
            prompt_tokens=0,
            completion_tokens=0,
            cost_usd=0.0,
        )
        observe_fallback("llm_exception")
        total_elapsed = perf_counter() - started_at
        observe_agent_call(operation=operation, provider="fallback", status="ok", latency_seconds=total_elapsed)
        log_event(
            "agent_error",
            operation=operation,
            provider="openai",
            model=model_name,
            error_type=type(exc).__name__,
            llm_latency_ms=round(llm_elapsed * 1000, 2),
            agent_latency_ms=round(total_elapsed * 1000, 2),
        )
        log_event(
            "agent_response",
            operation=operation,
            provider="fallback",
            fallback_reason="llm_exception",
            model=model_name,
            agent_latency_ms=round(total_elapsed * 1000, 2),
        )
        return ExplainDecisionResponse(explanation=fallback_text, provider="fallback", model=None)
