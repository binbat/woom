package main

import (
	"context"
	"woom/server/daemon"
)

func main() {
	daemon.Daemon(context.Background())
}
