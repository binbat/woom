package v1

import (
	"net/http"

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
	if _, err := h.helperCreateRoomStream(r, room.RoomId, streamId); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	room.StreamId = streamId
	render.JSON(w, r, room)
}
