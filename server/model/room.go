package model

const AdminUniqueKey = "admin"

type RoomAdmin struct {
	Owner     string `json:"owner"`
	Presenter string `json:"presenter,omitempty"`
	Locked    bool   `json:"locked"`
}

type Room struct {
	RoomId string `json:"roomId"`
	RoomAdmin
	StreamId string            `json:"streamId,omitempty"`
	Streams  map[string]Stream `json:"streams,omitempty"`
}

type Stream struct {
	Name   string `json:"name"`
	Token  string `json:"-"`
	State  string `json:"state"`
	Audio  bool   `json:"audio"`
	Video  bool   `json:"video"`
	Screen bool   `json:"screen"`
}
