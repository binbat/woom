CTR=docker
NAME=woom

.PHONY: default
default: build

.PHONY: build
build: webapp
	cargo build --release --locked

.PHONY: webapp
webapp:
	npm run build

.PHONY: webapp-clean
webapp-clean:
	rm -rf static/dist

.PHONY: clean
clean: webapp-clean
	cargo clean
