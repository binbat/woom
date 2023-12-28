package v1

import (
	"context"
	"net/http"

	"woom/server/helper"
	"woom/server/model"

	"github.com/go-chi/chi/v5"
	"github.com/gofrs/uuid/v5"
)

func (h *Handler) helperCreateStreamId() (string, error) {
	id, err := uuid.NewV4()
	return id.String(), err
}

func (h *Handler) helperSetRoomStream(r *http.Request, roomId, streamId string, stream *model.Stream) error {
	gobStream, err := helper.GobEncode(stream)
	if err != nil {
		return err
	}

	return h.rdb.HSet(context.TODO(), roomId, streamId, gobStream).Err()
}

func (h *Handler) helperShowRoom(r *http.Request) (*model.Room, error) {
	roomId := chi.URLParam(r, "roomId")
	room := model.Room{
		RoomId:  roomId,
		Streams: map[string]model.Stream{},
	}
	result, err := h.rdb.HGetAll(context.TODO(), roomId).Result()
	if err != nil {
		return &room, err
	}

	for k, v := range result {
		if k == model.AdminUniqueKey {
			admin := model.RoomAdmin{}
			helper.GobDecode(&admin, []byte(v))
			room.RoomAdmin = admin
		} else {
			stream := model.Stream{}
			helper.GobDecode(&stream, []byte(v))
			room.Streams[k] = stream
		}
	}
	return &room, err
}
