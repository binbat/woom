package main

import (
	"database/sql"
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"time"
	"woom/database"
	"woom/server"
	"woom/static"

	_ "github.com/lib/pq"
	"github.com/lib/pq/hstore"
	"golang.org/x/exp/slices"

	"github.com/caarlos0/env/v9"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/gofrs/uuid/v5"
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

	messageService := server.NewMessageService(db)

	remote, err := url.Parse(cfg.Live777Url)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(remote)

	r := chi.NewRouter()
	r.Use(middleware.Logger)

	r.Post("/room/", func(w http.ResponseWriter, r *http.Request) {
		uuid := r.URL.Query().Get("uuid")
		h := hstore.Hstore{
			Map: map[string]sql.NullString{
				uuid: {
					"user",
					true,
				},
			},
		}

		var roomId int
		db.QueryRow(`INSERT INTO rooms (stream) VALUES ($1) RETURNING id;`, h).Scan(&roomId)
		w.Write([]byte(strconv.Itoa(roomId)))
	})

	r.Patch("/room/{roomId}", func(w http.ResponseWriter, r *http.Request) {
		roomId := chi.URLParam(r, "roomId")
		uuid := r.URL.Query().Get("uuid")
		db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, uuid, "user")
		w.Write([]byte(roomId))
	})

	r.Get("/room/{roomId}", func(w http.ResponseWriter, r *http.Request) {
		roomId := chi.URLParam(r, "roomId")

		type Room struct {
			Id     int
			Stream hstore.Hstore
		}
		var room Room
		db.QueryRow(`SELECT id, stream FROM rooms WHERE id = $1;`, roomId).Scan(&room.Id, &room.Stream)
		log.Println(room)

		var rooms []string
		for k := range room.Stream.Map {
			rooms = append(rooms, k)
		}
		slices.Sort(rooms)
		render.JSON(w, r, rooms)
	})

	r.Post("/room/{roomId}/stream", func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.NewV4()
		if err != nil {
			panic(err)
		}

		roomId := chi.URLParam(r, "roomId")
		if _, err := db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, id.String(), "user"); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(err.Error()))
		}
		w.Write([]byte(id.String()))
	})

	r.Get("/room/{roomId}/message", func(w http.ResponseWriter, r *http.Request) {
		roomId, err := strconv.Atoi(chi.URLParam(r, "roomId"))
		if err != nil {
			badRequest(w, err)
			return
		}
		lastTime, err := strconv.Atoi(r.URL.Query().Get("lastTime"))
		if err != nil {
			badRequest(w, err)
			return
		}
		messages, err := messageService.GetMessages(roomId, time.UnixMilli(int64(lastTime)))
		if err != nil {
			badRequest(w, err)
			return
		}
		render.JSON(w, r, messages)
	})

	r.Post("/room/{roomId}/message", func(w http.ResponseWriter, r *http.Request) {
		roomId, err := strconv.Atoi(chi.URLParam(r, "roomId"))
		if err != nil {
			badRequest(w, err)
			return
		}
		// currently only text messages can be sent
		var data struct {
			Content string `json:"content"`
		}
		if err := render.DefaultDecoder(r, &data); err != nil {
			badRequest(w, err)
			return
		}
		message, err := messageService.AddMessage(roomId, GetUserId(r), server.MESSAGE_TYPE_TEXT, data.Content)
		if err != nil {
			badRequest(w, err)
			return
		}
		render.JSON(w, r, &message)
	})

	r.HandleFunc("/whip/{uuid}", handler(proxy, cfg.Live777Token))
	r.HandleFunc("/whep/{uuid}", handler(proxy, cfg.Live777Token))

	r.Handle("/*", http.StripPrefix("/", http.FileServer(server.NewSinglePageApp("index.html", http.FS(static.Dist)))))

	log.Println("=== started ===")
	log.Panicln(http.ListenAndServe(":"+cfg.Port, r))
}

func badRequest(w http.ResponseWriter, err error) {
	throwError(w, http.StatusBadRequest, err)
}

func throwError(w http.ResponseWriter, statusCode int, err error) {
	w.WriteHeader(statusCode)
	w.Write([]byte(err.Error()))
}

// TODO
func GetUserId(r *http.Request) int {
	userId, _ := strconv.Atoi(r.Header.Get("X-USER-ID"))
	return userId
}
