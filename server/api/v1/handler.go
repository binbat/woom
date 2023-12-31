package v1

import (
	"github.com/redis/go-redis/v9"
)

type Handler struct {
	rdb *redis.Client
	key string
}

func NewHandler(rdb *redis.Client, secret string) *Handler {
	return &Handler{
		rdb: rdb,
		key: secret,
	}
}
