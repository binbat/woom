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
	rm -r dist

.PHONY: clean
clean: webapp-clean
	go clean -cache

.PHONY: cli-pg
cli-pg:
	$(CTR) run -it --rm --network=host \
		-e PGHOST=localhost \
		-e PGPORT=5432 \
		-e PGUSER=postgres \
		-e PGPASSWORD=password \
		-e PGDATABASE=woom \
		dbcliorg/pgcli

