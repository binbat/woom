# WOOM

A painless self-hosted Meeting service, use [Live777](https://github.com/binbat/live777) engine

## Run

Depends: PostgreSQL, Live777 service

```bash
docker compose up
```

WebApp:

```bash
npm i
npm run dev
```

Server:

```bash
npm run build
go run . -migrate
```
