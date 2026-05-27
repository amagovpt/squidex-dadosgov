# Squidex + squid-be — Guia de Instalação

Passo-a-passo para replicar num servidor novo a integração Squidex (CMS) → squid-be (GraphQL gateway) usando nginx como reverse proxy com TLS.

Assume-se um host único a correr nginx (rpm) e Docker, com:

- **Squidex** (container) na porta `8080` do host, `URLS__BASEPATH=/squidex`
- **squid-be** (container) na porta `3333` do host
- **nginx** no host a terminar TLS e a encaminhar `/squidex/` para Squidex

Ao longo do guia, substitua `<HOST_IP>` pelo IP/FQDN do servidor (ex.: `172.31.204.14`).

---

## 1. Squidex

### 1.1 Estrutura de ficheiros

```
/opt/udata/squidex/
├── docker-compose.yml
├── .env
└── certificates/
    ├── squidex.crt
    └── squidex.key
```

### 1.2 `.env`

```env
SQUIDEX_DOMAIN=<HOST_IP>/squidex
SQUIDEX_PROTOCOL=https
SQUIDEX_ADMIN_EMAIL=admin@admin.com
SQUIDEX_ADMIN_PASSWORD=<senha-admin-forte>
```

**Importante:** `SQUIDEX_DOMAIN` + `SQUIDEX_PROTOCOL` produzem `URLS__BASEURL`, que define:

- a URL pública usada nos redirects OAuth e como issuer dos JWT;
- a flag `Secure` dos cookies de sessão — se `https`, só funcionam em HTTPS. Aceder via HTTP causa o sintoma "página de login pisca e volta ao login" (cookie descartado pelo browser).

Conclusão: o valor aqui **tem de bater com a URL pela qual o browser acede ao admin UI**.

### 1.3 `docker-compose.yml`

Squidex expõe a porta interna 80 como 8080 no host; a persistência é feita num container MongoDB e em volumes nomeados:

```yaml
services:
  squidex_mongo:
    image: mongo:latest
    container_name: squidex_mongo
    volumes:
      - squidex_mongo_data:/data/db
    networks: [squidex_net]
    restart: unless-stopped

  squidex_app:
    image: squidex/squidex:latest
    container_name: squidex_app
    ports:
      - "8080:80"
    env_file: [.env]
    environment:
      - URLS__BASEPATH=/squidex
      - URLS__BASEURL=${SQUIDEX_PROTOCOL}://${SQUIDEX_DOMAIN}
      - EVENTSTORE__MONGODB__CONFIGURATION=mongodb://squidex_mongo
      - STORE__MONGODB__CONFIGURATION=mongodb://squidex_mongo
      - IDENTITY__ADMINEMAIL=${SQUIDEX_ADMIN_EMAIL}
      - IDENTITY__ADMINPASSWORD=${SQUIDEX_ADMIN_PASSWORD}
    depends_on: [squidex_mongo]
    volumes:
      - squidex_assets:/app/Assets
    networks: [squidex_net]
    restart: unless-stopped

networks:
  squidex_net:
    driver: bridge

volumes:
  squidex_mongo_data:
  squidex_assets:
```

### 1.4 Certificado TLS self-signed

Para um ambiente interno sem CA, gere um certificado para o IP do host:

```bash
mkdir -p /opt/udata/squidex/certificates
openssl req -x509 -nodes -newkey rsa:2048 \
  -keyout /opt/udata/squidex/certificates/squidex.key \
  -out   /opt/udata/squidex/certificates/squidex.crt \
  -subj "/CN=<HOST_IP>" \
  -addext "subjectAltName=IP:<HOST_IP>" \
  -days 3650
```

Para domínio real, use um certificado de uma CA (ex.: Let's Encrypt) e aponte os paths no nginx para esse cert.

### 1.5 Arrancar

```bash
cd /opt/udata/squidex
docker compose up -d
```

Aguardar ~30s até o Squidex inicializar o MongoDB.

---

## 2. nginx

### 2.1 `/etc/nginx/nginx.conf`

Config mínima dedicada a Squidex. Pontos essenciais:

- `client_max_body_size 100M` — uploads de assets.
- `map $http_upgrade $connection_upgrade` + headers `Upgrade`/`Connection` — SignalR websockets do Squidex.
- `proxy_pass http://127.0.0.1:8080;` **sem** barra final — preserva o prefixo `/squidex/` no upstream (Squidex espera-o por causa de `URLS__BASEPATH`).
- `proxy_set_header Host $host` + `X-Forwarded-Proto` — Squidex usa-os para reconstruir URLs públicas.

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log;
pid /run/nginx.pid;

include /usr/share/nginx/modules/*.conf;

events {
    worker_connections 1024;
}

http {
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile            on;
    tcp_nopush          on;
    tcp_nodelay         on;
    keepalive_timeout   65;
    types_hash_max_size 4096;
    client_max_body_size 100M;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    map $http_upgrade $connection_upgrade {
        default upgrade;
        ''      close;
    }

    # SQUIDEX - HTTP
    server {
        listen 80 default_server;
        server_name <HOST_IP>;

        location /squidex/ {
            proxy_pass http://127.0.0.1:8080;
            proxy_http_version 1.1;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade           $http_upgrade;
            proxy_set_header Connection        $connection_upgrade;
            proxy_read_timeout 300s;
        }

        access_log /var/log/nginx/squidex_access.log main;
        error_log /var/log/nginx/squidex_error.log warn;
    }

    # SQUIDEX - HTTPS (obrigatório para admin UI — cookies Secure)
    server {
        listen 443 ssl http2 default_server;
        server_name <HOST_IP>;

        ssl_certificate     /opt/udata/squidex/certificates/squidex.crt;
        ssl_certificate_key /opt/udata/squidex/certificates/squidex.key;
        ssl_session_cache   shared:SSL:1m;
        ssl_session_timeout 10m;
        ssl_ciphers         PROFILE=SYSTEM;
        ssl_prefer_server_ciphers on;

        location /squidex/ {
            proxy_pass http://127.0.0.1:8080;
            proxy_http_version 1.1;
            proxy_set_header Host              $host;
            proxy_set_header X-Real-IP         $remote_addr;
            proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade           $http_upgrade;
            proxy_set_header Connection        $connection_upgrade;
            proxy_read_timeout 300s;
        }

        access_log /var/log/nginx/squidex_access_ssl.log main;
        error_log /var/log/nginx/squidex_error_ssl.log warn;
    }
}
```

### 2.2 Aplicar

```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak     # backup
sudo vim /etc/nginx/nginx.conf                              # colar config acima
sudo nginx -t                                               # validar
sudo systemctl reload nginx
```

### 2.3 Smoke test

```bash
curl -sS -o /dev/null -w "HTTP root: %{http_code}\n"  http://<HOST_IP>/squidex/
curl -sS -k -o /dev/null -w "HTTPS root: %{http_code}\n" https://<HOST_IP>/squidex/
```

Ambos devem devolver `200`.

---

## 3. Bootstrap do Squidex (via admin UI)

O Squidex não suporta `grant_type=password`. A primeira app + client **têm de ser criados via browser**.

1. Abrir `https://<HOST_IP>/squidex/`. O browser avisa cert self-signed — aceitar.
2. Login com `admin@admin.com` e a senha de `SQUIDEX_ADMIN_PASSWORD`.
3. **Create new App** → nome exacto: `dados-gov` (bate com `APP_NAME` do squid-be).
4. Dentro da app → **Settings → Clients → Create** → nome: `api-dados-gov`.
5. Guardar o **Client Secret** mostrado (só é visível depois de expandir o client).
6. Atribuir role ao client (ex.: `Editor` ou `Reader`) consoante o que o squid-be precisa ler.
7. Criar pelo menos **um schema** publicado — o squid-be faz schema stitching e falha no arranque se não encontrar nada.

O formato do `CLIENT_ID` usado pelo squid-be é `<app>:<client>` (neste caso `dados-gov:api-dados-gov`).

---

## 4. squid-be

### 4.1 `.env`

```env
NODE_ENV=production
PORT=3333
FRONTEND_ORIGIN="https://<FRONTEND_HOST>:<FRONTEND_PORT>"   # lista separada por vírgulas; OBRIGATÓRIO em produção
TRUST_PROXY=1                       # nº de proxies à frente (ex.: 2 para F5 + nginx) — IP real p/ rate-limit
NODE_TLS_REJECT_UNAUTHORIZED='0'    # ver aviso abaixo — só para cert self-signed

CMS_URL="https://<HOST_IP>"          # SEM o sufixo /squidex (o código já o acrescenta)
API_KEY=""

CLIENT_ID="dados-gov:api-dados-gov"
CLIENT_SECRET="<secret-gerado-pelo-squidex>"
APP_NAME="dados-gov"

# Tuning do gateway (têm defaults sensatos)
GRAPHQL_MAX_DEPTH=12        # profundidade máxima de query GraphQL (anti-DoS); >= 1
SCHEMA_REFRESH_MS=300000    # re-introspeção periódica do schema; 0 desativa
```

> **Aviso de segurança:** `NODE_TLS_REJECT_UNAUTHORIZED='0'` desativa a verificação TLS para **todas** as chamadas outbound do processo, não apenas o Squidex. Em produção, prefira um certificado de uma CA real (Let's Encrypt) no Squidex e deixe esta flag por definir.

> As variáveis obrigatórias (`CMS_URL`, `CLIENT_ID`, `CLIENT_SECRET`, `APP_NAME`, e `FRONTEND_ORIGIN` em produção) são validadas no arranque — se faltar alguma, o processo termina com uma mensagem clara. Variáveis numéricas em branco usam o default; valores inválidos (ex.: `GRAPHQL_MAX_DEPTH=0` ou não-numérico) abortam o arranque.

**Ciladas comuns:**

- **`CMS_URL` com `/squidex` no fim** → o código faz `CMS_URL + '/squidex/identity-server/...'` e fica com `/squidex/squidex/...` → `404`.
- **`CMS_URL` em HTTP** quando o `URLS__BASEURL` do Squidex é HTTPS → funciona para o token endpoint, mas o issuer do JWT será `https://...` e pode causar problemas noutras chamadas. Manter HTTPS aqui.
- **`CLIENT_SECRET` desalinhado** com o que o Squidex gerou → `HTTP 401 invalid_client`.

### 4.2 Logging

O squid-be escreve os logs para **stdout** (formato `combined` em produção, colorido em desenvolvimento). A rotação é feita pelo driver `json-file` do Docker, já configurado no `docker-compose.yml` (`max-size: 10m`, `max-file: 5`). **Não** há bind mount de `access.log` — o footgun antigo do `EISDIR` deixou de existir.

Ver logs: `docker compose logs -f --tail=30`.

### 4.3 Arrancar

```bash
cd /opt/udata/squid-be
docker compose up -d
docker compose logs -f --tail=30
```

Sinal de sucesso: `Server started on 0.0.0.0:3333` sem stack trace a seguir.

---

## 5. Verificação end-to-end

```bash
# 1. Squidex responde
curl -sS -k -o /dev/null -w "%{http_code}\n" https://<HOST_IP>/squidex/

# 2. Token endpoint aceita credenciais
curl -sS -k -X POST https://<HOST_IP>/squidex/identity-server/connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=dados-gov:api-dados-gov&client_secret=<SECRET>&scope=squidex-api" \
  | head -c 120
# esperado: {"access_token":"...","expires_in":...,"token_type":"Bearer",...}

# 3. squid-be vivo e pronto
curl -sS http://127.0.0.1:3333/api/healthcheck   # {"status":"Server running"}
curl -sS http://127.0.0.1:3333/api/readiness     # {"status":"ready"} (503 enquanto não carrega o schema)

# 4. squid-be a servir GraphQL
curl -sS http://127.0.0.1:3333/graphql -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"{ heartbeat }"}'
# esperado: {"data":{"heartbeat":"OK"}}
```

---

## 6. Troubleshooting — resumo por sintoma

| Sintoma | Causa provável | Onde corrigir |
|---|---|---|
| `Invalid environment configuration` no arranque | Falta uma variável obrigatória (`CMS_URL`/`CLIENT_ID`/`CLIENT_SECRET`/`APP_NAME`) | Preencher o `.env` |
| `/api/readiness` devolve `503` | Schema ainda não carregou (Squidex em baixo / sem schemas publicados) | Ver logs; confirmar Squidex e schema publicado |
| `HTTP 502 Bad Gateway` ao chamar token | nginx sem server block para `/squidex/`, cai no default (serviço ausente) | Adicionar server block em `nginx.conf` |
| Login no admin UI pisca e volta | Cookies `Secure` emitidos (BASEURL=https) mas a aceder por HTTP | Aceder via `https://<HOST_IP>/squidex/` |
| `HTTP 401 invalid_client` | `CLIENT_ID`/`CLIENT_SECRET` errados, ou app/client não existe | Recriar via admin UI e copiar o secret |
| `HTTP 404 Not Found` no token | `CMS_URL` tem `/squidex` duplicado | Remover sufixo `/squidex` de `CMS_URL` |
| `Error: Failed to get remote schema` após 200 OK no token | App sem schemas publicados | Criar e publicar pelo menos um schema |
