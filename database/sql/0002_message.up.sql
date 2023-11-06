CREATE TABLE messages (
	id serial primary key,
	room_id int not NULL,
    user_id int not NULL,
    t_type smallint not NULL,
    content text not NULL,
    created_at timestamp not NULL
);
CREATE INDEX messages_room_id_created_at_idx ON messages (room_id, created_at);