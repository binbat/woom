package api

import (
	"database/sql"
	"net/http"
	"slices"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/gofrs/uuid/v5"
	"github.com/lib/pq/hstore"
)

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	uuid := r.URL.Query().Get("uuid")
	hs := hstore.Hstore{
		Map: map[string]sql.NullString{
			uuid: {
				"user",
				true,
			},
		},
	}

	var roomId int
	h.db.QueryRow(`INSERT INTO rooms (stream) VALUES ($1) RETURNING id;`, hs).Scan(&roomId)
	w.Write([]byte(strconv.Itoa(roomId)))
}

func (h *Handler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")
	uuid := r.URL.Query().Get("uuid")
	h.db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, uuid, "user")
	w.Write([]byte(roomId))
}

func (h *Handler) ShowRoom(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")

	type Room struct {
		Id     int
		Stream hstore.Hstore
	}
	var room Room
	h.db.QueryRow(`SELECT id, stream FROM rooms WHERE id = $1;`, roomId).Scan(&room.Id, &room.Stream)

	var rooms []string
	for k := range room.Stream.Map {
		rooms = append(rooms, k)
	}
	slices.Sort(rooms)
	render.JSON(w, r, rooms)
}

func (h *Handler) UpdateRoomStream(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.NewV4()
	if err != nil {
		panic(err)
	}

	roomId := chi.URLParam(r, "roomId")
	if _, err := h.db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, id.String(), "user"); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
	}
	w.Write([]byte(id.String()))
}
