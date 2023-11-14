package api

import (
	"net/http"
	"strconv"
	"time"
	"woom/server/model"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

func badRequest(w http.ResponseWriter, err error) {
	throwError(w, http.StatusBadRequest, err)
}

func throwError(w http.ResponseWriter, statusCode int, err error) {
	w.WriteHeader(statusCode)
	w.Write([]byte(err.Error()))
}

func (h *Handler) ShowMessage(w http.ResponseWriter, r *http.Request) {
	roomId, err := strconv.Atoi(chi.URLParam(r, "roomId"))
	if err != nil {
		badRequest(w, err)
		return
	}
	lastTime, err := strconv.Atoi(r.URL.Query().Get("lastTime"))
	if err != nil {
		badRequest(w, err)
		return
	}
	messages, err := h.srv.GetMessages(roomId, time.UnixMilli(int64(lastTime)))
	if err != nil {
		badRequest(w, err)
		return
	}
	render.JSON(w, r, messages)
}

func (h *Handler) CreateMessage(w http.ResponseWriter, r *http.Request) {
	roomId, err := strconv.Atoi(chi.URLParam(r, "roomId"))
	if err != nil {
		badRequest(w, err)
		return
	}
	// currently only text messages can be sent
	var data struct {
		Content string `json:"content"`
	}
	if err := render.DefaultDecoder(r, &data); err != nil {
		badRequest(w, err)
		return
	}
	message, err := h.srv.AddMessage(roomId, GetUserId(r), model.MESSAGE_TYPE_TEXT, data.Content)
	if err != nil {
		badRequest(w, err)
		return
	}
	render.JSON(w, r, &message)
}

// TODO
func GetUserId(r *http.Request) int {
	userId, _ := strconv.Atoi(r.Header.Get("X-USER-ID"))
	return userId
}
