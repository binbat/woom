package main

type config struct {
	Port        string `env:"PORT" envDefault:"4000"`
	DatabaseUrl string `env:"DATABASEI_URL" envDefault:"user=postgres password=password dbname=woom sslmode=disable"`
	Live777Url  string `env:"LIVE777_URL" envDefault:"http://localhost:3000"`
}
