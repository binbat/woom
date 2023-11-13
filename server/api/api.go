package api

import (
	"database/sql"
	"woom/server/service"
)

type Handler struct {
	db  *sql.DB
	srv service.MessageService
}

func NewHandler(db *sql.DB, srv service.MessageService) *Handler {
	return &Handler{
		db:  db,
		srv: srv,
	}
}
