FROM node:26-alpine AS builder-node

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM rust:1.99-alpine AS builder

WORKDIR /app

RUN apk add --no-cache musl-dev

COPY Cargo.toml Cargo.lock ./

COPY . .

COPY --from=builder-node /app/static/dist /app/static/dist

RUN cargo build --release --locked

FROM alpine:3.23 AS bin

RUN mkdir -p /data

COPY --from=builder /app/target/release/woom /usr/bin/woom

ENV DATA_FILE=/data/woom.json
VOLUME ["/data"]
EXPOSE 4000/tcp

ENTRYPOINT ["/usr/bin/woom"]
