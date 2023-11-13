package model

import (
	"github.com/lib/pq/hstore"
)

type MessageType = uint16

const (
	MESSAGE_TYPE_TEXT MessageType = iota
	MESSAGE_TYPE_ROOM
)

type Room struct {
	Id     int
	Stream hstore.Hstore
}

type Message struct {
	Id        int         `json:"id"`
	RoomId    int         `json:"roomId"`
	UserId    int         `json:"userId"` // TODO user model
	Type      MessageType `json:"type"`
	Content   string      `json:"content"`
	CreatedAt Timestamp   `json:"createdAt"`
}
