package database

import (
	"database/sql"
	"embed"
	"path"
	"strconv"
	"strings"
)

//go:embed sql
var sqlEmbed embed.FS

type Migrater struct{}

func splitFileName(fileName string) (int, string, string) {
	arr := strings.SplitN(fileName, "_", 2)
	id, err := strconv.Atoi(arr[0])
	if err != nil {
		panic(err)
	}
	arr2 := strings.SplitN(arr[1], ".", 2)
	name := arr2[0]
	suffix := arr2[1]
	return id, name, suffix
}

func Parse(suffix string) []string {
	files, err := sqlEmbed.ReadDir("sql")
	if err != nil {
		panic(err)
	}

	result := make([]string, len(files)/2)

	for _, file := range files {
		id, _, su := splitFileName(file.Name())
		if suffix == su {
			data, err := sqlEmbed.ReadFile(path.Join("sql", file.Name()))
			if err != nil {
				panic(err)
			}
			result[id] = string(data)
		}
	}

	return result
}

func currentVersion(db *sql.DB) int {
	id := -1
	db.QueryRow("SELECT version FROM schema_version").Scan(&id)
	return id
}

func updateVersion(db *sql.DB, id int) error {
	return db.QueryRow(`UPDATE schema_version SET version = $1`, id).Err()
}

func Migrations(db *sql.DB) {
	id := currentVersion(db)
	execSqls := Parse("up.sql")
	for _, sqlScript := range execSqls[id+1:] {
		if _, err := db.Exec(sqlScript); err != nil {
			panic(err)
		}
	}
	updateVersion(db, len(execSqls)-1)
}

func MigrationsRollback(db *sql.DB) {
	execSqls := Parse("dn.sql")
	for _, sqlScript := range execSqls {
		if _, err := db.Exec(sqlScript); err != nil {
			panic(err)
		}
	}
}
