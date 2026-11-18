package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

var db *sql.DB

const schema = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  api_type TEXT NOT NULL DEFAULT 'images',
  models TEXT NOT NULL DEFAULT '[]',
  caps TEXT NOT NULL DEFAULT '{}',
  sort INTEGER NOT NULL DEFAULT 0,
  tool_path_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file TEXT NOT NULL,
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'single',
  group_id TEXT NOT NULL DEFAULT '',
  slot INTEGER NOT NULL DEFAULT 0,
  channel_id INTEGER NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  api_type TEXT NOT NULL DEFAULT 'images',
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  params TEXT NOT NULL DEFAULT '{}',
  refs TEXT NOT NULL DEFAULT '[]',
  sent_prompt TEXT NOT NULL DEFAULT '',
  sent_body TEXT NOT NULL DEFAULT '',
  endpoint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  tool_path INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL DEFAULT 0,
  finished_at INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_group ON jobs(group_id);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  file TEXT NOT NULL,
  thumb TEXT NOT NULL DEFAULT '',
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  fav_at INTEGER NOT NULL DEFAULT 0,
  album TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS images_job ON images(job_id);
CREATE INDEX IF NOT EXISTS images_fav ON images(favorite);
CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  is_template INTEGER NOT NULL DEFAULT 0,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  use_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
`

func openDB(dir string) error {
	var err error
	dsn := "file:" + filepath.Join(dir, "studio.db") + "?_pragma=busy_timeout(8000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)"
	db, err = sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(8)
	if _, err = db.Exec(schema); err != nil {
		return fmt.Errorf("schema: %w", err)
	}
	// 重启时把未完成的任务标记为中断
	_, _ = db.Exec(`UPDATE jobs SET status='failed', error='服务重启，任务中断', finished_at=? WHERE status IN ('queued','running')`, now())
	return nil
}

func now() int64 { return time.Now().UnixMilli() }

func getSetting(key, def string) string {
	var v string
	if err := db.QueryRow(`SELECT value FROM settings WHERE key=?`, key).Scan(&v); err != nil {
		return def
	}
	return v
}

func setSetting(key, value string) error {
	_, err := db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

func mustJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
