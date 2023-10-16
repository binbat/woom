CTR=docker

cli-pg:
	$(CTR) run -it --rm --network=host \
		-e PGHOST=localhost \
		-e PGPORT=5432 \
		-e PGUSER=postgres \
		-e PGPASSWORD=password \
		-e PGDATABASE=woom \
		dbcliorg/pgcli

