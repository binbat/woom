package server

type Config struct {
	Port         string `env:"PORT" envDefault:"4000"`
	RedisUrl     string `env:"REDIS_URL" envDefault:"redis://localhost:6379/0"`
	Live777Url   string `env:"LIVE777_URL" envDefault:"http://localhost:7777"`
	Live777Token string `env:"LIVE777_TOKEN" envDefault:""`
}
