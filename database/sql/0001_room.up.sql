CREATE EXTENSION hstore;

CREATE TABLE rooms (
	id serial primary key,
	stream hstore
);
