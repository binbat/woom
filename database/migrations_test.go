package database

import "testing"

func TestParse(t *testing.T) {
	arr := Parse("up.sql")
	t.Error(arr)
}
