package v1

import (
	"context"
	"net/http"

	"woom/server/helper"
	"woom/server/model"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
	"github.com/gofrs/uuid/v5"
)

const idLength = 9

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	roomId := helper.AddSplitSymbol(helper.GenNumberSecret(idLength))
	id, err := uuid.NewV4()
	streamId := id.String()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	admin := model.RoomAdmin{
		Owner:     streamId,
		Presenter: "",
		Locked:    false,
	}

	stream := model.Stream{
		// TODO:
		Name: "",
		// TODO:
		Token:  "",
		Audio:  false,
		Video:  false,
		Screen: false,
	}

	gobAdmin, err := helper.GobEncode(&admin)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	gobStream, err := helper.GobEncode(&stream)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	if err := h.rdb.HSet(context.TODO(), roomId, model.AdminUniqueKey, gobAdmin).Err(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	if err := h.rdb.HSet(context.TODO(), roomId, streamId, gobStream).Err(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	room := model.Room{
		RoomId:    roomId,
		RoomAdmin: admin,
		StreamId:  streamId,
	}
	render.JSON(w, r, room)
}

func (h *Handler) ShowRoom(w http.ResponseWriter, r *http.Request) {
	roomId := chi.URLParam(r, "roomId")
	result, err := h.rdb.HGetAll(context.TODO(), roomId).Result()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}

	room := model.Room{
		RoomId:  roomId,
		Streams: map[string]model.Stream{},
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
	render.JSON(w, r, room)
}
