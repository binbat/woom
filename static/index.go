//go:build !release

package static

import "embed"

//go:embed index.html
var Dist embed.FS
