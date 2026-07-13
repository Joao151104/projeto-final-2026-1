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
CADDYFILE_PATH="$ROOT_DIR/deploy/render/Caddyfile"
PROMETHEUS_CONFIG_PATH="/etc/prometheus/prometheus.yml"
if [[ ! -f "$PROMETHEUS_CONFIG_PATH" ]]; then
  PROMETHEUS_CONFIG_PATH="$ROOT_DIR/deploy/render/prometheus.yml"
fi

BACKEND_PORT=8000
FRONTEND_PORT=5173
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000

mkdir -p "$RUN_DIR" "$LOG_DIR"

is_render_mode() {
  [[ "${START_MODE:-}" == "render" || -n "${RENDER_SERVICE_ID:-}" || "${RENDER:-false}" == "true" ]]
}

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

start_render_single_service() {
  local data_dir="${DATA_DIR:-/data}"
  local public_port="${PORT:-10000}"

  if [[ ! -x "/usr/bin/caddy" ]]; then
    echo "Caddy nao encontrado em /usr/bin/caddy. Verifique Dockerfile.render."
    exit 1
  fi

  if [[ ! -x "/bin/prometheus" ]]; then
    echo "Prometheus nao encontrado em /bin/prometheus. Verifique Dockerfile.render."
    exit 1
  fi

  if [[ ! -x "/usr/share/grafana/bin/grafana" ]]; then
    echo "Grafana nao encontrado em /usr/share/grafana/bin/grafana. Verifique Dockerfile.render."
    exit 1
  fi

  if [[ ! -f "$CADDYFILE_PATH" ]]; then
    echo "Arquivo $CADDYFILE_PATH nao encontrado."
    exit 1
  fi

  mkdir -p "$data_dir/grafana" "$data_dir/prometheus" "$data_dir/grafana/plugins" /tmp/grafana-logs

  export GF_SECURITY_ADMIN_USER="${GF_SECURITY_ADMIN_USER:-admin}"
  export GF_SECURITY_ADMIN_PASSWORD="${GF_SECURITY_ADMIN_PASSWORD:-admin}"
  export GF_SERVER_HTTP_ADDR="127.0.0.1"
  export GF_SERVER_HTTP_PORT="$GRAFANA_PORT"
  export GF_SERVER_ROOT_URL="${GF_SERVER_ROOT_URL:-%(protocol)s://%(domain)s/grafana/}"
  export GF_SERVER_SERVE_FROM_SUB_PATH="${GF_SERVER_SERVE_FROM_SUB_PATH:-true}"
  export GF_PATHS_DATA="$data_dir/grafana"
  export GF_PATHS_LOGS="/tmp/grafana-logs"
  export GF_PATHS_PLUGINS="$data_dir/grafana/plugins"
  export GF_PATHS_PROVISIONING="/etc/grafana/provisioning"
  export PORT="$public_port"

  echo "Iniciando API em 127.0.0.1:$BACKEND_PORT"
  (
    cd "$ROOT_DIR"
    python -m uvicorn src.api.main:app --host 127.0.0.1 --port "$BACKEND_PORT"
  ) &
  local api_pid=$!

  echo "Iniciando Prometheus em 127.0.0.1:$PROMETHEUS_PORT"
  /bin/prometheus \
    --config.file="$PROMETHEUS_CONFIG_PATH" \
    --storage.tsdb.path="$data_dir/prometheus" \
    --web.listen-address="127.0.0.1:$PROMETHEUS_PORT" \
    --web.external-url="/prometheus/" &
  local prom_pid=$!

  echo "Iniciando Grafana em 127.0.0.1:$GRAFANA_PORT"
  /usr/share/grafana/bin/grafana server \
    --homepath=/usr/share/grafana \
    --config=/etc/grafana/grafana.ini &
  local grafana_pid=$!

  echo "Iniciando proxy Caddy na porta publica $public_port"
  /usr/bin/caddy run --config "$CADDYFILE_PATH" --adapter caddyfile &
  local caddy_pid=$!

  cleanup_render() {
    kill "$api_pid" "$prom_pid" "$grafana_pid" "$caddy_pid" 2>/dev/null || true
    wait "$api_pid" "$prom_pid" "$grafana_pid" "$caddy_pid" 2>/dev/null || true
  }

  trap cleanup_render EXIT INT TERM

  wait -n "$api_pid" "$prom_pid" "$grafana_pid" "$caddy_pid"
  local exit_code=$?
  cleanup_render
  exit "$exit_code"
}

if is_render_mode; then
  start_render_single_service
  exit 0
fi

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
