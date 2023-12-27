package helper

import (
	"testing"
)

func TestSplitSymbol(t *testing.T) {
	sets := map[string]string{
		"":           "",
		"123":        "123",
		"123456789":  "123-456-789",
		"1234567899": "123-456-789-9",
	}

	for k, v := range sets {
		if r := AddSplitSymbol(k); r != v {
			t.Errorf("'%s' != '%s'", r, v)
		}
	}

	for k, v := range sets {
		if r := DelSplitSymbol(v); k != r {
			t.Errorf("'%s' != '%s'", k, r)
		}
	}
}
