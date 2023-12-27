package helper

import (
	"strings"
)

const defaultSymbolLength = 3
const defaultSymbolSeparator = '-'

func AddSplitSymbol(str string) string {
	var result []byte
	for i := 0; i < len(str); i++ {
		result = append(result, str[i])
		if (i+1)%defaultSymbolLength == 0 && i != len(str)-1 {
			result = append(result, defaultSymbolSeparator)
		}
	}
	return string(result)
}

func DelSplitSymbol(str string) string {
	return strings.ReplaceAll(str, string(defaultSymbolSeparator), "")
}
