package v1

import (
	"context"
	"net/http"

	"woom/server/helper"
	"woom/server/model"

	"github.com/go-chi/render"
)

const idLength = 9

func (h *Handler) CreateRoom(w http.ResponseWriter, r *http.Request) {
	roomId := helper.AddSplitSymbol(helper.GenNumberSecret(idLength))
	streamId, err := h.helperCreateStreamId()
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
	gobAdmin, err := helper.GobEncode(&admin)
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

	//if _, err := h.helperCreateRoomStream(r, roomId, streamId); err != nil {
	//	w.WriteHeader(http.StatusInternalServerError)
	//	w.Write([]byte(err.Error()))
	//	return
	//}

	room := model.Room{
		RoomId:    roomId,
		RoomAdmin: admin,
		StreamId:  streamId,
	}
	render.JSON(w, r, room)
}

func (h *Handler) ShowRoom(w http.ResponseWriter, r *http.Request) {
	room, err := h.helperShowRoom(r)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(err.Error()))
		return
	}
	render.JSON(w, r, room)
}
