#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
RUN_DIR="$ROOT_DIR/.run"
LOG_DIR="$ROOT_DIR/.logs"
BACKEND_PID_FILE="$RUN_DIR/backend.pid"
FRONTEND_PID_FILE="$RUN_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
OBS_COMPOSE_FILE="$ROOT_DIR/docker-compose.observability.yml"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
PIP_BIN="$ROOT_DIR/.venv/bin/pip"

BACKEND_PORT=8000
FRONTEND_PORT=5173
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000

mkdir -p "$RUN_DIR" "$LOG_DIR"

kill_pid_file_process() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Encerrando processo antigo PID $pid"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

kill_by_pattern() {
  local pattern="$1"
  local pids
  pids="$(pgrep -f "$pattern" || true)"
  if [[ -n "$pids" ]]; then
    echo "Encerrando processos por padrao: $pattern"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

kill_by_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" || true)"
  if [[ -n "$pids" ]]; then
    echo "Encerrando processos na porta $port"
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 1
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

ensure_python_env() {
  if [[ ! -x "$PYTHON_BIN" ]]; then
    if ! command -v python3 >/dev/null 2>&1; then
      echo "Python 3 nao encontrado no sistema. Instale Python 3 e rode novamente."
      exit 1
    fi

    echo "Criando ambiente virtual em .venv..."
    (
      cd "$ROOT_DIR"
      python3 -m venv .venv
    )
  fi

  echo "Garantindo dependencias Python..."
  (
    cd "$ROOT_DIR"
    "$PIP_BIN" install -r requirements.txt >>"$BACKEND_LOG" 2>&1
  )
}

ensure_frontend_deps() {
  if [[ ! -d "$WEB_DIR/node_modules" ]]; then
    echo "Instalando dependencias do frontend..."
    (
      cd "$WEB_DIR"
      npm install >>"$FRONTEND_LOG" 2>&1
    )
  fi
}

start_observability_stack() {
  if [[ ! -f "$OBS_COMPOSE_FILE" ]]; then
    echo "Arquivo $OBS_COMPOSE_FILE nao encontrado. Pulando stack de observabilidade."
    return
  fi

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker nao encontrado. Pulando Prometheus/Grafana."
    return
  fi

  echo "Iniciando Prometheus e Grafana..."
  (
    cd "$ROOT_DIR"
    docker compose -f "$OBS_COMPOSE_FILE" up -d
  )
}

echo "Limpando instancias anteriores..."
kill_pid_file_process "$BACKEND_PID_FILE"
kill_pid_file_process "$FRONTEND_PID_FILE"
kill_by_pattern "uvicorn src.api.main:app"
kill_by_pattern "vite"
kill_by_port "$BACKEND_PORT"
kill_by_port "$FRONTEND_PORT"

mkdir -p "$RUN_DIR" "$LOG_DIR"

ensure_python_env
ensure_frontend_deps
start_observability_stack

echo "Iniciando backend na porta $BACKEND_PORT..."
(
  cd "$ROOT_DIR"
  "$PYTHON_BIN" -m uvicorn src.api.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$BACKEND_PID_FILE"

echo "Iniciando frontend na porta $FRONTEND_PORT..."
(
  cd "$WEB_DIR"
  npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) >"$FRONTEND_LOG" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$FRONTEND_PID_FILE"

sleep 2

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  echo "Erro ao iniciar backend. Veja: $BACKEND_LOG"
  exit 1
fi

if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  echo "Erro ao iniciar frontend. Veja: $FRONTEND_LOG"
  exit 1
fi

echo "Aplicacao iniciada com sucesso."
echo "Backend:  http://127.0.0.1:$BACKEND_PORT/docs"
echo "Frontend: http://127.0.0.1:$FRONTEND_PORT"
if command -v docker >/dev/null 2>&1 && [[ -f "$OBS_COMPOSE_FILE" ]]; then
  echo "Prometheus: http://127.0.0.1:$PROMETHEUS_PORT"
  echo "Grafana:    http://127.0.0.1:$GRAFANA_PORT"
  echo "Dashboard:  http://127.0.0.1:$GRAFANA_PORT/d/fraud-agent-overview/fraud-agent-overview"
fi
echo "Logs backend:  $BACKEND_LOG"
echo "Logs frontend: $FRONTEND_LOG"
