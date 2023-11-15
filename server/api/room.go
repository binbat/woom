package api

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/gofrs/uuid/v5"
	"github.com/lib/pq/hstore"
)

const idLength = 9

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	hs := hstore.Hstore{}
	var roomId string

	id, err := strconv.Atoi(GenNumberSecret(idLength))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	if err := h.db.QueryRow(`INSERT INTO rooms (id, stream) VALUES ($1, $2) RETURNING id;`, id, hs).Scan(&roomId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	if n := idLength - len(roomId); n > 0 {
		roomId = strings.Repeat("0", n) + roomId
	}

	w.Write([]byte(roomId))
}

func (h *Handler) UpdateRoom(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")
	uuid := r.URL.Query().Get("uuid")
	h.db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, uuid, "")
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
	roomStream := make(map[string]json.RawMessage)

	for k, v := range room.Stream.Map {
		if k == "" {
			continue
		}
		if v.String == "" {
			continue
		}
		roomStream[k] = json.RawMessage(v.String)
	}
	render.JSON(w, r, roomStream)
}

func (h *Handler) CreateRoomStream(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.NewV4()
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}

	roomId := chi.URLParam(r, "roomId")
	if _, err := h.db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, id.String(), ""); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}
	w.Write([]byte(id.String()))
}

func (h *Handler) UpdateRoomStream(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")
	streamId := chi.URLParam(r, "streamId")
	data, err := io.ReadAll(r.Body)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}

	if _, err := h.db.Exec(`UPDATE rooms SET stream[$2] = $3 WHERE id = $1;`, roomId, streamId, data); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}
}