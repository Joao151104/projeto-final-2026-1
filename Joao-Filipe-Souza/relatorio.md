# Relatorio Final - Trilha 1.2 (Fraude em Cartao)

## Cabecalho
- Repositorio: https://github.com/Joao151104/projeto-final-2026-1
- Integrante(s): Joao Filipe de Oliveira Souza 231035141

---

## Definicao do problema

### Que dor e essa e por que importa?
Fraude em cartao de credito tem impacto financeiro direto para emissores, credenciadoras e lojistas. Em sistemas reais, a taxa de fraude e muito menor que a taxa de transacoes legitimas, o que torna o problema desbalanceado e operacionalmente sensivel: errar para mais gera friccao, errar para menos gera perda financeira.

O objetivo deste projeto foi construir um agente de decisao de fraude em tempo real que:
- receba uma transacao,
- estime risco de fraude,
- transforme score em decisao operacional (bloquear, revisar, liberar),
- explique o racional da decisao,
- e opere com monitoramento de latencia, custo, fallback e guardrails.

### Stakeholders
- Banco/emissor: reduz chargeback e perdas por fraude.
- Time de risco/fraude: recebe sinal priorizado para bloqueio/revisao.
- Cliente final: evita bloqueios indevidos de compra legitima.
- Time de engenharia/produto: garante confiabilidade, custo e observabilidade.

### Metricas de sucesso
- Negocio:
  - reducao de perdas por fraude (FN) mantendo experiencia do cliente aceitavel (controle de FP);
  - suporte a decisao operacional em tempo real.
- Tecnica:
  - PR-AUC, precision, recall, F1 no limiar final;
  - latencia ponta a ponta da API;
  - taxa de fallback do agente;
  - custo LLM acumulado por chamada/tokens.

---

## Como o sistema e montado

### Diagrama de arquitetura
```mermaid
flowchart LR
  U[Usuario / Frontend React] -->|/api/predict| API[FastAPI]
  U -->|/api/explain-decision| API
  API --> M[XGBoost + threshold]
  API --> A[Agente explicador]
  A -->|OpenAI Chat Completions| LLM[(gpt-4o-mini)]
  A -->|fallback local| F[Explicacao deterministica]
  API --> O[Observabilidade]
  O --> P[/metrics Prometheus]
  P --> PR[Prometheus]
  PR --> G[Grafana]
```

Trechos de implementacao correspondentes:
- Middleware de observabilidade HTTP: [src/api/main.py](src/api/main.py#L23)
- Endpoint de inferencia: [src/api/main.py](src/api/main.py#L74)
- Endpoint de explicacao: [src/api/main.py](src/api/main.py#L84)
- Endpoint de metricas Prometheus: [src/api/main.py](src/api/main.py#L97)

### Agent/model exploration
Abordagens consideradas e adotadas:
- Modelo de classificacao:
  - baseline com modelo supervisionado para score de fraude;
  - escolha final: XGBoost (artefato versionado em artifacts).
- Conversao score -> decisao:
  - threshold operacional carregado de metadados do modelo;
  - zona cinzenta em torno do limiar para recomendar revisao manual.
- Agente explicador:
  - caminho principal com LLM (OpenAI);
  - caminho de contingencia com fallback deterministico local.
- Ferramentas do agente:
  - chamada HTTP para modelo de linguagem;
  - observabilidade de tool calls, tokens, custo e latencia.

### Deployment
- API: FastAPI com endpoints de inferencia, explicacao e metricas.
- Produto: frontend React (Vite) consumindo API em /api.
- Observabilidade:
  - endpoint /metrics no backend;
  - Prometheus + Grafana com dashboard provisionado.
- Empacotamento:
  - modo local: start_app.sh sobe frontend + backend + (opcional) observabilidade;
  - modo Render (servico unico): Dockerfile.render + start_app.sh em modo render sobem API, Grafana, Prometheus e proxy no mesmo container.

Trechos de codigo (deploy):
- Docker de servico unico: [Dockerfile.render](Dockerfile.render#L1)
- Entrada unica em modo render: [Dockerfile.render](Dockerfile.render#L52)
- Script que sobe API + Prometheus + Grafana + Caddy: [start_app.sh](start_app.sh#L120)
- Regras de roteamento /api, /grafana e /prometheus: [deploy/render/Caddyfile](deploy/render/Caddyfile#L12)

---

## Descricao do agente

### Modelo base e ferramentas
- Modelo base de classificacao: XGBoost (model_version: xgboost-v1).
- LLM para explicacao: gpt-4o-mini (configuravel por OPENAI_MODEL).
- Justificativa:
  - custo e latencia adequados para explicacoes curtas;
  - fallback local evita indisponibilidade total.

Ferramentas do agente:
- OpenAI Chat Completions para explicacao textual.
- Motor de fallback local para explicacao deterministica.
- Coleta de metricas Prometheus e logs JSON de eventos do agente.

Trecho de codigo (agente):
```python
def explain_decision(payload: ExplainDecisionInput) -> ExplainDecisionResponse:
  ...
  observe_tool_call("openai_chat_completions", "started")
  ...
  observe_fallback("guardrail")
```
Fonte: [src/api/service.py](src/api/service.py#L468)

### Engenharia de features
Foi implementada uma camada de engenharia de features na inferencia para enriquecer sinais de valor, tempo e comportamento agregado dos componentes V. O catalogo de variaveis derivadas esta definido em [src/api/service.py](src/api/service.py#L47).

Transformacoes implementadas:
- Escala de valor: `Amount_log = log1p(Amount)` para reduzir assimetria e impacto de outliers monetarios ([src/api/service.py](src/api/service.py#L181)).
- Sazonalidade temporal: `Hour`, `Time_sin`, `Time_cos` e `Day` para capturar padrao ciclico de horario ([src/api/service.py](src/api/service.py#L185)).
- Estatisticas dos componentes V1..V28: `V_mean`, `V_std`, `V_abs_max`, `V_l2_norm` para representar intensidade e dispersao do perfil transacional ([src/api/service.py](src/api/service.py#L198)).

A aplicacao dessas transformacoes em runtime ocorre em [src/api/service.py](src/api/service.py#L175), antes da selecao final de colunas para o modelo em [src/api/service.py](src/api/service.py#L239).

Estado atual no artefato de modelo:
- O pipeline ja esta preparado para usar features derivadas.
- O metadata atual (`xgboost-v1`) ainda lista apenas o conjunto base (`Time`, `V1..V28`, `Amount`) em [artifacts/xgboost_metadata.json](artifacts/xgboost_metadata.json#L4).

Conclusao tecnica: a infraestrutura de feature engineering esta pronta e integrada ao backend, mas o ganho direto no score depende de um proximo ciclo de treino/publicacao de artefato incluindo essas variaveis no campo `features`.

### Dados e contexto
- Base utilizada: creditcard.csv (transacoes anonimizadas com V1..V28 + Time + Amount + Class).
- Uso dos dados no sistema:
  - treinamento offline do modelo de score (fora da API);
  - inferencia online pela API usando artefatos salvos.
- Licenca/origem:
  - conforme fonte adotada no projeto (registrar no video/entrega final a URL da fonte original e sua licenca).

### Guardrails
Guardrails de entrada:
- validacao de schema com Pydantic:
  - Amount >= 0
  - score_fraude e limiar_usado em [0,1] para endpoint de explicacao
  - campos obrigatorios da transacao

Guardrails de saida (agente explicador):
- resposta vazia -> erro empty_response
- resposta sem referencia a limiar/threshold -> missing_threshold_reference
- resposta sem referencia a fatores enviados -> missing_factor_reference
- resposta longa demais (> 1200 chars) -> response_too_long

Trecho de codigo (guardrails):
```python
def _validate_guardrails(content: str, payload: ExplainDecisionInput) -> str | None:
  text = content.strip()
  if not text:
    return "empty_response"
  if "limiar" not in lowered and "threshold" not in lowered:
    return "missing_threshold_reference"
```
Fonte: [src/api/service.py](src/api/service.py#L436)

Acao quando guardrail aciona:
- incrementa metricas de guardrail e fallback,
- registra evento de erro,
- retorna explicacao fallback local em vez de erro cru para o usuario.

Trechos de codigo (fallback e custo):
- Custo por tokens do LLM: [src/api/service.py](src/api/service.py#L421)
- Fallback por falta de API key: [src/api/service.py](src/api/service.py#L484)
- Fallback por erro do LLM: [src/api/service.py](src/api/service.py#L616)
- Contadores de fallback e guardrail: [src/monitoring/observability.py](src/monitoring/observability.py#L67)

### Iteracoes de prompt e design
Evolucao resumida:
1. Baseline: score + decisao sem explicacao generativa.
2. Adicao de endpoint de explicacao com prompt orientado a causalidade e limiar.
3. Inclusao de fallback deterministico para indisponibilidade do LLM.
4. Inclusao de guardrails de saida para evitar resposta fraca/generica.
5. Inclusao de observabilidade operacional completa (traces + metricas + custo).

Tentativas que exigiram ajuste:
- datasource Grafana com localhost dentro de container falhava; corrigido para URL interna correta.
- deploy monorepo no Render exigiu ajuste de contexto/root directory.

---

## Avaliacao do sistema

### Performance
Metricas de validacao registradas no artefato do modelo:
- threshold: 0.82
- precision: 0.90
- recall: 0.8265
- f1: 0.8617
- pr_auc: 0.8664
- roc_auc: 0.9797

Fonte dos valores de validacao:
- [artifacts/xgboost_metadata.json](artifacts/xgboost_metadata.json#L3)
- [artifacts/xgboost_metadata.json](artifacts/xgboost_metadata.json#L36)

Leitura operacional:
- o threshold alto (0.82) prioriza qualidade de alerta (precision) sem derrubar recall para niveis muito baixos;
- a recomendacao operacional em tres classes (bloquear/revisar/liberar) ajuda no manejo de casos limiares.

### UX
- Frontend permite envio completo dos 30 atributos exigidos pela API.
- O usuario recebe retorno claro: score, decisao, acao e limiar usado.
- Em caso de falha de API/LLM, o sistema apresenta mensagem amigavel e fallback, sem stacktrace tecnico.
- Historico de transacoes e popup de explicacao aumentam auditabilidade para operador humano.

Trechos de codigo (UX e integracao):
- Envio de transacao para inferencia: [web/src/components/NewTransactionPanel.jsx](web/src/components/NewTransactionPanel.jsx#L133)
- Chamada de explicacao detalhada: [web/src/components/AlertsTable.jsx](web/src/components/AlertsTable.jsx#L48)
- Carga de model-info e serie horaria: [web/src/components/ControlTower.jsx](web/src/components/ControlTower.jsx#L99)

---

## Demonstracao

Video demonstrando fluxo ponta a ponta:
- Link: https://youtu.be/AQHEgY4VL8w

Roteiro recomendado usado na demo:
1. Subir aplicacao (local ou Render).
2. Enviar exemplo legitimo e exemplo de fraude.
3. Mostrar score, decisao e recomendacao operacional.
4. Abrir explicacao do agente (openai/fallback).
5. Mostrar metricas em /metrics e dashboard Grafana.

Pontos do codigo para abrir durante a demonstracao:
- Decisao score -> acao operacional: [src/api/service.py](src/api/service.py#L288)
- Endpoint /metrics ativo na API: [src/api/main.py](src/api/main.py#L97)
- Estrutura de metricas e traces: [src/monitoring/observability.py](src/monitoring/observability.py#L13)

---

## Reflexao sobre o que aprendemos

### O que funcionou bem
- Separacao clara entre score (modelo) e explicacao (agente) tornou o sistema modular.
- Fallback + guardrails aumentaram robustez em cenarios de falha.
- Observabilidade permitiu visibilidade real de latencia, custo e degradacao.

### O que nao funcionou como planejado
- Deploy em monorepo no Render exigiu ajustes de contexto de build.
- Um unico servico com varios processos simplifica custo, mas aumenta acoplamento operacional.
- CI/CD automatizado ainda nao foi implementado nesta entrega.

### Proximos passos
- Adicionar pipeline CI/CD com testes e deploy automatico.
- Incluir monitoramento de drift de dados e calibracao periodica.
- Incorporar explicabilidade local mais robusta (ex.: SHAP em producao).
- Endurecer seguranca de observabilidade (auth e politicas de acesso).

---

## Impactos e etica

### Quem pode ser prejudicado por erro
- FN (fraude liberada): prejuizo financeiro direto e risco reputacional.
- FP (legitima bloqueada): prejuizo de experiencia, abandono e atrito com cliente.

### Risco de vies
- O dataset usa features anonimizadas (V1..V28), reduzindo interpretabilidade social direta.
- Ainda assim, vies operacional pode surgir por threshold e politicas de bloqueio.

### Privacidade e seguranca
- Dados de producao exigem governanca forte de acesso, retencao e auditoria.
- Segredos (API key) devem ficar somente em variaveis de ambiente no provedor.

### Mitigacoes adotadas/recomendadas
- Guardrails na entrada e saida.
- Fallback para falha externa.
- Logs estruturados sem expor payload sensivel completo.
- Monitoramento continuo de erro, fallback e custo.

---

## Referencias
- FastAPI
- Pydantic
- XGBoost
- Prometheus
- Grafana
- React + Vite + Tailwind
- OpenAI Chat Completions (gpt-4o-mini)
- Base credit card fraud detection (registrar URL e licenca da fonte final utilizada)
