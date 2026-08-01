CTR=docker
NAME=woom

.PHONY: default
default: webapp build

.PHONY: build
build:
	cargo build --release

.PHONY: webapp
webapp:
	npm run build

.PHONY: webapp-clean
webapp-clean:
	rm -r static/dist

.PHONY: clean
clean: webapp-clean
	cargo clean
