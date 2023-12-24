package server

type Config struct {
	Port         string `env:"PORT" envDefault:"4000"`
	DatabaseUrl  string `env:"DATABASE_URL" envDefault:"user=postgres password=password dbname=woom sslmode=disable"`
	Live777Url   string `env:"LIVE777_URL" envDefault:"http://localhost:7777"`
	Live777Token string `env:"LIVE777_TOKEN" envDefault:""`
}
