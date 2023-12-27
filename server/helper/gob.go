package helper

import (
	"bytes"
	"encoding/gob"
)

func GobEncode(e any) ([]byte, error) {
	var buf bytes.Buffer
	err, r := gob.NewEncoder(&buf).Encode(e), buf.Bytes()
	return r, err
}

func GobDecode(e any, data []byte) error {
	buf := bytes.NewBuffer(data)
	return gob.NewDecoder(buf).Decode(e)
}
