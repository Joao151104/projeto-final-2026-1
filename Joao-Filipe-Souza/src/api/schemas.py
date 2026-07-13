from __future__ import annotations

from datetime import datetime
from typing import Dict, Literal

from pydantic import BaseModel, Field


class TransactionInput(BaseModel):
    Time: float
    Amount: float = Field(ge=0)

    V1: float
    V2: float
    V3: float
    V4: float
    V5: float
    V6: float
    V7: float
    V8: float
    V9: float
    V10: float
    V11: float
    V12: float
    V13: float
    V14: float
    V15: float
    V16: float
    V17: float
    V18: float
    V19: float
    V20: float
    V21: float
    V22: float
    V23: float
    V24: float
    V25: float
    V26: float
    V27: float
    V28: float


class PredictResponse(BaseModel):
    transaction_id: str
    timestamp: datetime
    score_fraude: float
    limiar_usado: float
    decisao: Literal["fraude", "legitima"]
    recomendacao_operacional: Literal["bloquear", "revisar", "liberar"]
    explicacao: str
    top_fatores: Dict[str, float]
    model_version: str


class ExplainDecisionInput(BaseModel):
    transaction_id: str | None = None
    timestamp: datetime | None = None
    amount: float = Field(ge=0)
    score_fraude: float = Field(ge=0, le=1)
    limiar_usado: float = Field(ge=0, le=1)
    decisao: Literal["fraude", "legitima"]
    recomendacao_operacional: Literal["bloquear", "revisar", "liberar"]
    top_fatores: Dict[str, float] = Field(default_factory=dict)


class ExplainDecisionResponse(BaseModel):
    explanation: str
    provider: Literal["openai", "fallback"]
    model: str | None = None
