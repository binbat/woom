FROM rust:1.99-alpine AS builder

WORKDIR /app

# The `opus` crate (opusic-sys) builds its vendored libopus from source with
# CMake and links it statically, so no system opus-dev/pkgconf is needed here
# and no libopus is needed in the runtime stage.
RUN apk add --no-cache musl-dev cmake make g++

COPY Cargo.toml Cargo.lock ./

COPY src ./src

RUN cargo build --release --locked

FROM alpine:3.23

RUN apk add --no-cache ca-certificates

COPY --from=builder /app/target/release/woom-caption /usr/bin/woom-caption

ENTRYPOINT ["/usr/bin/woom-caption"]
