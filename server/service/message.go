package service

import (
	"database/sql"
	"time"
	"woom/server/model"
)

type MessageService interface {
	AddMessage(roomId, userId int, t model.MessageType, content string) (*model.Message, error)
	GetMessages(roomId int, lastTime time.Time) ([]model.Message, error)
}

type MessageServiceImpl struct {
	db *sql.DB
}

func NewMessageService(db *sql.DB) MessageService {
	return &MessageServiceImpl{db: db}
}

func (s *MessageServiceImpl) AddMessage(roomId, userId int, t model.MessageType, content string) (*model.Message, error) {
	message := &model.Message{
		RoomId:  roomId,
		UserId:  userId,
		Type:    t,
		Content: content,
	}
	return message, s.db.QueryRow(
		`INSERT INTO messages (room_id, user_id, t_type, content, created_at) VALUES ($1, $2, $3, $4, now()) RETURNING id,created_at;`,
		roomId, userId, t, content,
	).Scan(&message.Id, &message.CreatedAt)
}

func (s *MessageServiceImpl) GetMessages(roomId int, lastTime time.Time) ([]model.Message, error) {
	message := make([]model.Message, 0)
	rows, err := s.db.Query("SELECT * FROM messages WHERE room_id = $1 AND created_at > $2", roomId, lastTime)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var m model.Message
		if err = rows.Scan(&m.Id, &m.RoomId, &m.UserId, &m.Type, &m.Content, &m.CreatedAt); err != nil {
			return nil, err
		}
		message = append(message, m)
	}
	return message, nil
}
