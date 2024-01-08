package v1

import (
	"context"
	"net/http"
	"woom/server/model"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

func (h *Handler) CreateRoomStream(w http.ResponseWriter, r *http.Request) {
	room, err := h.helperShowRoom(r)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	streamId, err := h.helperCreateStreamId()
	if err := h.helperSetRoomStream(r, room.RoomId, streamId, &model.Stream{}); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	room.StreamId = streamId
	render.JSON(w, r, room)
}

func (h *Handler) UpdateRoomStream(w http.ResponseWriter, r *http.Request) {
	streamId := chi.URLParam(r, "streamId")
	room, err := h.helperShowRoom(r)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	stream := &model.Stream{}
	if err := render.DecodeJSON(r.Body, stream); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(err.Error()))
		return
	}

	if err := h.helperSetRoomStream(r, room.RoomId, streamId, stream); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	room.StreamId = streamId
	render.JSON(w, r, room)
}

func (h *Handler) DestroyRoomStream(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")
	streamId := chi.URLParam(r, "streamId")

	if err := h.rdb.HDel(context.TODO(), roomId, streamId).Err(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
