package helper

import (
	"net/http"
)

func NewSinglePageApp(path string, fs http.FileSystem) *SinglePageApp {
	return &SinglePageApp{
		path: path,
		fs:   fs,
	}
}

type SinglePageApp struct {
	path string
	fs   http.FileSystem
}

func (s *SinglePageApp) Open(name string) (http.File, error) {
	if file, err := s.fs.Open(name); err != nil {
		return s.fs.Open(s.path)
	} else {
		return file, err
	}
}
