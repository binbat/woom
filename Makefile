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

.PHONY: cli-redis
cli-redis:
	$(CTR) run -it --rm --network=host \
		-e IREDIS_URL=redis://localhost:6379/0 \
		dbcliorg/iredis
