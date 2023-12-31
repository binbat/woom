package daemon

import (
	"context"
	"log"
	"net/http"
	"woom/server"
	"woom/server/api"

	"github.com/caarlos0/env/v9"
	"github.com/redis/go-redis/v9"
)

func newRdbClient(url string) *redis.Client {
	opts, err := redis.ParseURL(url)
	if err != nil {
		panic(err)
	}

	return redis.NewClient(opts)
}

func Daemon(ctx context.Context) {
	cfg := server.Config{}
	if err := env.Parse(&cfg); err != nil {
		log.Printf("%+v\n", err)
	}

	log.Printf("%+v\n", cfg)
	rdb := newRdbClient(cfg.RedisUrl)
	log.Println(rdb)

	handler := api.NewApi(rdb, cfg.Secret, cfg.Live777Url, cfg.Live777Token)

	log.Println("=== started ===")
	log.Panicln(http.ListenAndServe(":"+cfg.Port, handler))
}
