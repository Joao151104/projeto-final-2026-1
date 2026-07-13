#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/app"
DATA_DIR="/data"

: "${PORT:=10000}"

mkdir -p "$DATA_DIR/grafana" "$DATA_DIR/prometheus" "$DATA_DIR/grafana/plugins" /tmp/grafana-logs

export GF_SECURITY_ADMIN_USER="${GF_SECURITY_ADMIN_USER:-admin}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_SECURITY_ADMIN_PASSWORD:-admin}"
export GF_SERVER_HTTP_ADDR="127.0.0.1"
export GF_SERVER_HTTP_PORT="3000"
export GF_SERVER_ROOT_URL="%(protocol)s://%(domain)s/grafana/"
export GF_SERVER_SERVE_FROM_SUB_PATH="true"
export GF_PATHS_DATA="$DATA_DIR/grafana"
export GF_PATHS_LOGS="/tmp/grafana-logs"
export GF_PATHS_PLUGINS="$DATA_DIR/grafana/plugins"
export GF_PATHS_PROVISIONING="/etc/grafana/provisioning"

cd "$APP_DIR"

python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000 &
API_PID=$!

/bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path="$DATA_DIR/prometheus" \
  --web.listen-address=127.0.0.1:9090 \
  --web.external-url="%(protocol)s://%(domain)s/prometheus/" &
PROM_PID=$!

/usr/share/grafana/bin/grafana server \
  --homepath=/usr/share/grafana \
  --config=/etc/grafana/grafana.ini &
GRAFANA_PID=$!

/usr/bin/caddy run --config /app/deploy/render/Caddyfile --adapter caddyfile &
CADDY_PID=$!

cleanup() {
  kill "$API_PID" "$PROM_PID" "$GRAFANA_PID" "$CADDY_PID" 2>/dev/null || true
  wait "$API_PID" "$PROM_PID" "$GRAFANA_PID" "$CADDY_PID" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

wait -n "$API_PID" "$PROM_PID" "$GRAFANA_PID" "$CADDY_PID"
exit_code=$?
cleanup
exit "$exit_code"
