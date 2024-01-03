package api

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	woomMiddleware "woom/server/api/middleware"
	"woom/server/api/v1"
	"woom/server/helper"
	"woom/static"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/redis/go-redis/v9"
)

func handler(p http.Handler, address, token string) func(http.ResponseWriter, *http.Request) {
	u, _ := url.Parse(address)
	return func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			r.Header.Set("Authorization", "Bearer "+token)
		}

		// Reference: https://liqiang.io/post/implement-reverse-proxy-with-golang
		r.Host = u.Host
		p.ServeHTTP(w, r)
	}
}

func NewApi(rdb *redis.Client, secret string, live777Url string, live777Token string) http.Handler {
	remote, err := url.Parse(live777Url)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(remote)

	r := chi.NewRouter()
	r.Use(middleware.Logger)

	handle := v1.NewHandler(rdb, secret)

	r.Group(func(r chi.Router) {
		r.Use(woomMiddleware.JWTAuth(secret))

		r.Post("/room/", handle.CreateRoom)
		r.Get("/room/{roomId}", handle.ShowRoom)
		//r.Patch("/room/{roomId}", handle.UpdateRoom)
		r.Post("/room/{roomId}/stream", handle.CreateRoomStream)
		r.Patch("/room/{roomId}/stream/{streamId}", handle.UpdateRoomStream)
		r.Delete("/room/{roomId}/stream/{streamId}", handle.DestroyRoomStream)
	})

	r.Post("/user/", handle.CreateUser)

	//r.Post("/room/{roomId}/message", handle.CreateMessage)
	//r.Get("/room/{roomId}/message", handle.ShowMessage)

	r.HandleFunc("/whip/{uuid}", handler(proxy, live777Url, live777Token))
	r.HandleFunc("/whep/{uuid}", handler(proxy, live777Url, live777Token))

	r.Handle("/*", http.StripPrefix("/", http.FileServer(helper.NewSinglePageApp("index.html", http.FS(static.Dist)))))
	return r
}
