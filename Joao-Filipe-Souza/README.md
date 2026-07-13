# Projeto Final - Fraude em Cartao (Trilha 1.2)

Este projeto implementa um agente de decisao de fraude em tempo real com:
- classificacao binaria em base extremamente desbalanceada,
- escolha de limiar por custo de erro (FN vs FP),
- API para inferencia,
- painel de monitoramento.

## Estrutura
- Veja o plano completo em `estrutura-projeto-fraude.md`.
- Codigo principal em `src/`.
- API em `src/api/`.
- Interface web em `web/`.

## Como rodar local
1. Crie e ative seu ambiente virtual.
2. Instale as dependencias:

```bash
pip install -r requirements.txt
```

3. Suba a API (FastAPI):

```bash
uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000
```

4. Suba a interface web:

```bash
cd web
npm install
npm run dev
```

Ou suba tudo com um comando (backend + frontend):

```bash
./start_app.sh
```

O script encerra instancias anteriores da aplicacao e inicia tudo novamente.

5. Acesse:
- API docs: http://127.0.0.1:8000/docs
- Control Tower: http://localhost:5173

## Dados
Use o arquivo `creditcard.csv` nesta pasta para modelagem.

## Monitoramento em producao
O backend agora expoe sinais operacionais para acompanhar o agente no mundo real.

### Endpoint de metricas
- `GET /metrics` no formato Prometheus.
- URL local: `http://127.0.0.1:8000/metrics`

### Grafana + Prometheus (auto-configurado)
Arquivos de stack e provisionamento:
- `docker-compose.observability.yml`
- `monitoring/prometheus.yml`
- `monitoring/grafana/provisioning/datasources/prometheus.yml`
- `monitoring/grafana/provisioning/dashboards/dashboards.yml`
- `monitoring/grafana/dashboards/fraud-agent-overview.json`

Suba a stack:

```bash
docker compose -f docker-compose.observability.yml up -d
```

URLs:
- Prometheus: `http://127.0.0.1:9090`
- Grafana: `http://127.0.0.1:3000`
- Dashboard principal: `http://127.0.0.1:3000/d/fraud-agent-overview/fraud-agent-overview`

Login do Grafana:
- usuario: `admin`
- senha: `admin`

Observacao importante:
- No Grafana, o datasource correto e `http://prometheus:9090` (nao use `localhost:9090` dentro do container).

Metricas principais:
- `agent_calls_total{operation,provider,status}`
- `agent_latency_seconds{operation,provider}`
- `llm_calls_total{model,status}`
- `llm_latency_seconds{model}`
- `llm_cost_usd_total{model}`
- `llm_prompt_tokens_total{model}` e `llm_completion_tokens_total{model}`
- `fallback_total{reason}`
- `guardrail_errors_total{error_type}`
- `tool_calls_total{tool,status}`
- `http_requests_total{method,path,status}` e `http_request_latency_seconds{method,path}`

### Traces em logs estruturados
Cada chamada gera eventos JSON no log com `request_id`, incluindo:
- `agent_input`: resumo da entrada
- `agent_tools_invoked`: ferramentas acionadas
- `agent_response`: provider final, latencias, tokens e custo
- `guardrail_failed` e `agent_error` quando aplicavel

### Custo por chamada ao LLM
O custo e calculado por tokens de entrada e saida e acumulado em `llm_cost_usd_total`.

Precos default por 1M tokens:
- `gpt-4o-mini`: input 0.15 USD, output 0.60 USD

Opcionalmente, sobrescreva via `.env`:
- `OPENAI_PRICE_INPUT_PER_1M`
- `OPENAI_PRICE_OUTPUT_PER_1M`

### Guardrails e fallback
- Se a resposta do LLM vier vazia, sem referencia ao limiar, sem referencia aos fatores, ou muito longa, o sistema aciona fallback.
- Toda ativacao de fallback e erro de guardrail entra nas metricas.

## Deploy no Render (servico unico)

Este repositorio inclui um deploy completo em um unico container (API + frontend + Prometheus + Grafana + proxy).

Importante: nao precisa usar Blueprint.

Arquivos de deploy:
- `Dockerfile.render`
- `render.yaml`
- `start_app.sh` (modo render)
- `deploy/render/Caddyfile`
- `deploy/render/prometheus.yml`

### Como publicar (sem Blueprint)
1. Suba o codigo para o GitHub.
2. No Render, clique em **New +** > **Web Service**.
3. Conecte o repositorio.
4. Em **Environment**, selecione **Docker**.
5. Em **Dockerfile Path**, informe `Dockerfile.render`.
6. Em **Health Check Path**, informe `/health`.
7. Crie um **Persistent Disk** montado em `/data`.
8. Configure o secret `OPENAI_API_KEY` no painel do Render.
9. Aguarde o build/deploy.

No deploy em Render, o container inicia via `start_app.sh` em modo render e sobe tudo no mesmo servico:
- API (127.0.0.1:8000)
- Prometheus (127.0.0.1:9090)
- Grafana (127.0.0.1:3000)
- Caddy na porta publica `$PORT`

### Endpoints apos deploy
- App web: `/`
- API health: `/health`
- API docs: `/docs`
- API via frontend: `/api/*`
- Prometheus UI: `/prometheus/`
- Grafana UI: `/grafana/`

### Persistencia
- O blueprint ja cria Disk em `/data`.
- Grafana e Prometheus gravam dados nesse caminho para nao perder estado a cada deploy.

### Credenciais Grafana
- Usuario: valor de `GF_SECURITY_ADMIN_USER`
- Senha: valor de `GF_SECURITY_ADMIN_PASSWORD` (gerado automaticamente no blueprint)

### Variaveis recomendadas no Render
- `OPENAI_API_KEY` (secret)
- `OPENAI_MODEL=gpt-4o-mini`
- `GF_SECURITY_ADMIN_USER=admin`
- `GF_SECURITY_ADMIN_PASSWORD=<senha forte>`

## Status atual
Estrutura inicial pronta. Proximos passos:
- treinar modelo e salvar artefatos em `artifacts/`,
- calibrar score,
- definir limiar final via custo,
- integrar metricas reais no dashboard.
