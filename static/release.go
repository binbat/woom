//go:build release

package static

import (
	"embed"
	"io/fs"
	"log"
)

//go:embed dist
var build embed.FS

var Dist fs.FS

func init() {
	var err error
	Dist, err = fs.Sub(build, "dist")
	if err != nil {
		log.Fatal(err)
	}
}
