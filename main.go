package main

import (
	"database/sql"
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"woom/database"
	"woom/server"
	"woom/server/api"
	"woom/server/service"
	"woom/static"

	_ "github.com/lib/pq"

	"github.com/caarlos0/env/v9"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func handler(p http.Handler, token string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		p.ServeHTTP(w, r)
	}
}

func main() {
	migrate := flag.Bool("migrate", false, "Database Migrations")
	flag.Parse()

	cfg := server.Config{}
	if err := env.Parse(&cfg); err != nil {
		log.Printf("%+v\n", err)
	}

	log.Printf("%+v\n", cfg)

	db, err := sql.Open("postgres", cfg.DatabaseUrl)
	if err != nil {
		log.Fatal(err)
	}

	if *migrate {
		database.Migrations(db)
	}

	messageService := service.NewMessageService(db)

	remote, err := url.Parse(cfg.Live777Url)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(remote)

	r := chi.NewRouter()
	r.Use(middleware.Logger)

	handle := api.NewHandler(db, messageService)

	r.Post("/room/", handle.CreateRoom)
	r.Patch("/room/{roomId}", handle.UpdateRoom)
	r.Get("/room/{roomId}", handle.ShowRoom)
	r.Post("/room/{roomId}/stream", handle.CreateRoomStream)
	r.Patch("/room/{roomId}/stream/{streamId}", handle.UpdateRoomStream)

	r.Post("/room/{roomId}/message", handle.CreateMessage)
	r.Get("/room/{roomId}/message", handle.ShowMessage)

	r.HandleFunc("/whip/{uuid}", handler(proxy, cfg.Live777Token))
	r.HandleFunc("/whep/{uuid}", handler(proxy, cfg.Live777Token))

	r.Handle("/*", http.StripPrefix("/", http.FileServer(server.NewSinglePageApp("index.html", http.FS(static.Dist)))))

	log.Println("=== started ===")
	log.Panicln(http.ListenAndServe(":"+cfg.Port, r))
}
