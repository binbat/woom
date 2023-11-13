package model

import (
	"fmt"
	"strconv"
	"time"
)

type Timestamp time.Time

func (t *Timestamp) MarshalJSON() ([]byte, error) {
	tTime := time.Time(*t)
	unix := tTime.UnixMilli()
	return []byte(fmt.Sprintf("%d", unix)), nil
}

func (t *Timestamp) UnmarshalJSON(data []byte) error {
	unix, err := strconv.ParseInt(string(data), 10, 64)
	if err != nil {
		return err
	}
	tm := time.UnixMilli(unix)
	*t = Timestamp(tm)
	return nil
}
