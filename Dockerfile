FROM node:20-alpine AS builder-node

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

RUN npm run build

FROM rust:1-alpine AS builder

WORKDIR /app

RUN apk add --no-cache musl-dev

COPY Cargo.toml Cargo.lock ./

COPY . .

COPY --from=builder-node /app/static/dist /app/static/dist

RUN cargo build --release

# Bin
FROM alpine AS bin

COPY --from=builder /app/target/release/woom /usr/bin/woom

EXPOSE 4000/tcp

ENTRYPOINT ["/usr/bin/woom"]
