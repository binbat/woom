package api

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	"woom/server/api/v1"
	"woom/server/helper"
	"woom/static"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"
)

func handler(p http.Handler, token string) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}
		p.ServeHTTP(w, r)
	}
}

func NewApi(rdb *redis.Client, live777Url string, live777Token string) http.Handler {
	remote, err := url.Parse(live777Url)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(remote)

	r := chi.NewRouter()
	r.Use(middleware.Logger)

	handle := v1.NewHandler(rdb)

	r.Post("/room/", handle.CreateRoom)
	r.Get("/room/{roomId}", handle.ShowRoom)
	//r.Patch("/room/{roomId}", handle.UpdateRoom)
	r.Post("/room/{roomId}/stream", handle.CreateRoomStream)
	r.Patch("/room/{roomId}/stream/{streamId}", handle.UpdateRoomStream)

	//r.Post("/room/{roomId}/message", handle.CreateMessage)
	//r.Get("/room/{roomId}/message", handle.ShowMessage)

	r.HandleFunc("/whip/{uuid}", handler(proxy, live777Token))
	r.HandleFunc("/whep/{uuid}", handler(proxy, live777Token))

	r.Handle("/*", http.StripPrefix("/", http.FileServer(helper.NewSinglePageApp("index.html", http.FS(static.Dist)))))
	return r
}
