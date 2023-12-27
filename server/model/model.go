package model

type MessageType = uint16

const (
	MESSAGE_TYPE_TEXT MessageType = iota
	MESSAGE_TYPE_ROOM
)

type Message struct {
	Id        int         `json:"id"`
	RoomId    int         `json:"roomId"`
	UserId    int         `json:"userId"` // TODO user model
	Type      MessageType `json:"type"`
	Content   string      `json:"content"`
	CreatedAt Timestamp   `json:"createdAt"`
}
