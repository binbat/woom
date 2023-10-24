package main

import (
	"database/sql"
	"embed"
	"flag"
	"io"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"woom/database"

	_ "github.com/lib/pq"
	"github.com/lib/pq/hstore"
	"golang.org/x/exp/slices"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
)

//go:embed dist
var dist embed.FS

func FileServer(r chi.Router, path string, root http.FileSystem) {
	if strings.ContainsAny(path, "{}*") {
		panic("FileServer does not permit any URL parameters.")
	}

	if path != "/" && path[len(path)-1] != '/' {
		r.Get(path, http.RedirectHandler(path+"/", 301).ServeHTTP)
		path += "/"
	}
	path += "*"

	r.Get(path, func(w http.ResponseWriter, r *http.Request) {
		rctx := chi.RouteContext(r.Context())
		pathPrefix := strings.TrimSuffix(rctx.RoutePattern(), "/*")
		fs := http.StripPrefix(pathPrefix, http.FileServer(root))
		fs.ServeHTTP(w, r)
	})
}

func main() {
	migrate := flag.Bool("migrate", false, "Database Migrations")
	flag.Parse()

	connStr := "user=postgres password=password dbname=woom sslmode=disable"
	db, err := sql.Open("postgres", connStr)
	if err != nil {
		log.Fatal(err)
	}

	if *migrate {
		database.Migrations(db)
	}

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	//r.Get("/", func(w http.ResponseWriter, r *http.Request) {
	//	w.Write([]byte("welcome"))
	//})

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
		// fmt.Println(room)
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
		//room := Room{
		//	Id:     0,
		//	Stream: make(map[string]sql.NullString),
		//}
		var room Room
		db.QueryRow(`SELECT id, stream FROM rooms WHERE id = $1;`, roomId).Scan(&room.Id, &room.Stream)
		// db.QueryRow(`SELECT id, stream FROM rooms WHERE id = $1;`, roomId).Scan(&room.Id, stream)
		// db.QueryRow(`SELECT stream FROM rooms WHERE id = $1;`, roomId).Scan(&stream)
		log.Println(room)

		var rooms []string
		for k := range room.Stream.Map {
			rooms = append(rooms, k)
		}
		slices.Sort(rooms)
		render.JSON(w, r, rooms)
	})

	// Proxy whip
	r.HandleFunc("/whip/{uuid}", func(w http.ResponseWriter, r *http.Request) {
		client := http.Client{}

		req, _ := http.NewRequest(r.Method, "http://localhost:3000/whip/"+chi.URLParam(r, "uuid"), r.Body)
		// req.Header.Set("Context-Type", r.Header.Get("Context-Type"))
		req.Header = r.Header
		res, _ := client.Do(req)

		w.Header().Add("E-Tag", res.Header.Get("E-Tag"))
		w.Header().Add("Location", res.Header.Get("Location"))
		io.Copy(w, res.Body)
		w.WriteHeader(res.StatusCode)
	})

	// Proxy whep
	r.HandleFunc("/whep/{uuid}", func(w http.ResponseWriter, r *http.Request) {
		client := http.Client{}

		req, _ := http.NewRequest(r.Method, "http://localhost:3000/whip/"+chi.URLParam(r, "uuid"), r.Body)
		// req.Header.Set("Context-Type", r.Header.Get("Context-Type"))
		req.Header = r.Header
		res, _ := client.Do(req)

		w.Header().Add("E-Tag", res.Header.Get("E-Tag"))
		w.Header().Add("Location", res.Header.Get("Location"))
		io.Copy(w, res.Body)
		w.WriteHeader(res.StatusCode)
	})

	fsys, err := fs.Sub(dist, "dist")
	if err != nil {
		log.Fatal(err)
	}

	// FileServer(r, "/", http.FS(fsys))
	FileServer(r, "/", NewSPA("index.html", http.FS(fsys)))

	log.Println("=== started ===")
	log.Panicln(http.ListenAndServe(":4000", r))
}
