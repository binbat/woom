CTR=docker
NAME=woom
GOBUILD=CGO_ENABLED=0 \
				go build -tags release -trimpath

.PHONY: default
default: webapp build

.PHONY: build
build:
	$(GOBUILD) -o $(NAME)

.PHONY: webapp
webapp:
	npm run build

.PHONY: webapp-clean
webapp-clean:
	rm -r static/dist

.PHONY: clean
clean: webapp-clean
	go clean -cache

.PHONY: cli-redis
cli-redis:
	$(CTR) run -it --rm --network=host \
		-e IREDIS_URL=redis://localhost:6379/0 \
		dbcliorg/iredis

