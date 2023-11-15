package api

import (
	"math/rand"
)

var lettersNumber = []rune("0123456789")

func GenNumberSecret(n int) string {
	return genSecret(lettersNumber, n)
}

func genSecret(letters []rune, n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return string(b)
}
