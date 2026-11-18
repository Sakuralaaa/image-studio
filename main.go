package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"
)

//go:embed all:web/dist
var webFS embed.FS

var (
	version   = "0.4.1"
	dataDir   string
	adminPass string
	secret    []byte
)

func main() {
	dataDir = env("DATA_DIR", "/data")
	adminPass = os.Getenv("ADMIN_PASSWORD")
	addr := env("LISTEN", ":"+env("PORT", "8080"))
	for _, d := range []string{"", "images", "thumbs", "refs"} {
		if err := os.MkdirAll(filepath.Join(dataDir, d), 0o755); err != nil {
			log.Fatal(err)
		}
	}
	if err := openDB(dataDir); err != nil {
		log.Fatal(err)
	}
	if err := marketInit(); err != nil {
		log.Fatal(err)
	}
	if err := migrateUsers(); err != nil {
		log.Fatal(err)
	}
	s := getSetting("session_secret", "")
	if s == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		s = hex.EncodeToString(b)
		_ = setSetting("session_secret", s)
	}
	secret = []byte(s)
	go cleanupLoop()

	mux := http.NewServeMux()
	routes(mux)
	log.Printf("image-studio %s 监听 %s，数据目录 %s", version, addr, dataDir)
	srv := &http.Server{Addr: addr, Handler: logMW(mux), ReadHeaderTimeout: 20 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func env(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func routes(m *http.ServeMux) {
	m.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "version": version})
	})
	m.HandleFunc("POST /api/login", handleLogin)
	m.HandleFunc("POST /api/logout", handleLogout)
	m.HandleFunc("GET /api/me", handleMe)

	m.HandleFunc("POST /api/register", handleRegister)

	a := func(p string, h http.HandlerFunc) { m.Handle(p, auth(h)) }
	ad := func(p string, h http.HandlerFunc) { m.Handle(p, adminOnly(h)) }
	a("PUT /api/account", handleAccountPut)

	// 渠道：管理员可增删改；普通用户只拿到去掉名称和地址的模型列表
	ad("GET /api/presets", handlePresets)
	a("GET /api/channels", handleChannelList)
	ad("POST /api/channels", handleChannelSave)
	ad("PUT /api/channels/{id}", handleChannelSave)
	ad("DELETE /api/channels/{id}", handleChannelDelete)
	ad("POST /api/channels/probe", handleChannelProbe)
	ad("POST /api/channels/order", handleChannelOrder)

	a("POST /api/refs", handleRefUpload)
	a("POST /api/refs/url", handleRefFromURL)

	a("GET /api/market", handleMarketList)
	ad("POST /api/market/refresh", handleMarketRefresh)
	a("GET /api/market/img", handleMarketImg)
	a("GET /api/market/hero", handleHero)
	a("GET /api/market/favs", handleMarketFavList)
	a("POST /api/market/favs", handleMarketFavAdd)
	a("POST /api/market/favs/delete", handleMarketFavDel)
	a("GET /files/refs/{name}", serveOwned("refs"))
	a("GET /files/images/{name}", serveOwned("images"))
	a("GET /files/thumbs/{name}", serveOwned("thumbs"))

	a("POST /api/jobs", handleJobCreate)
	a("GET /api/jobs", handleJobList)
	a("GET /api/jobs/{id}", handleJobGet)
	a("DELETE /api/jobs/{id}", handleJobDelete)

	a("POST /api/compare", handleCompareCreate)
	a("GET /api/compare", handleCompareList)
	a("GET /api/compare/{gid}", handleCompareGet)

	a("GET /api/images", handleImageList)
	a("GET /api/images/{id}", handleImageGet)
	a("PATCH /api/images/{id}", handleImagePatch)
	a("DELETE /api/images/{id}", handleImageDelete)
	a("POST /api/images/export", handleImageExport)
	a("GET /api/images/{id}/download", handleImageDownload)
	a("GET /api/facets", handleFacets)

	a("GET /api/prompts", handlePromptList)
	a("POST /api/prompts", handlePromptSave)
	a("PUT /api/prompts/{id}", handlePromptSave)
	a("DELETE /api/prompts/{id}", handlePromptDelete)
	a("POST /api/prompts/{id}/use", handlePromptUse)
	a("GET /api/prompts/export", handlePromptExport)
	a("POST /api/prompts/import", handlePromptImport)

	ad("GET /api/settings", handleSystemGet)
	ad("PUT /api/settings", handleSystemPut)
	ad("GET /api/users", handleUserList)
	ad("POST /api/users", handleUserCreate)
	ad("PUT /api/users/{id}", handleUserUpdate)
	ad("DELETE /api/users/{id}", handleUserDelete)
	ad("GET /api/invites", handleInviteList)
	ad("POST /api/invites", handleInviteCreate)
	ad("DELETE /api/invites/{code}", handleInviteDelete)

	sub, _ := fs.Sub(webFS, "web/dist")
	fileServer := http.FileServer(http.FS(sub))
	m.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p != "" {
			if st, err := fs.Stat(sub, p); err == nil && !st.IsDir() {
				if strings.HasPrefix(p, "static/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				fileServer.ServeHTTP(w, r)
				return
			}
		}
		if strings.HasPrefix(p, "api/") {
			httpErr(w, 404, "接口不存在")
			return
		}
		b, err := fs.ReadFile(sub, "index.html")
		if err != nil {
			http.Error(w, "前端未构建", 500)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		_, _ = w.Write(b)
	})
}

const cookieName = "studio_session"

// ---------- 工具 ----------

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": msg})
}

func readJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 64<<20))
	if err := dec.Decode(v); err != nil {
		return errors.New("请求格式错误")
	}
	return nil
}

func pathID(r *http.Request) int64 {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	return id
}

// serveOwned 只允许读取自己的文件；管理员可以读全部
func serveOwned(sub string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.PathValue("name"))
		if name == "." || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
		}
		u := cur(r)
		if !u.IsAdmin() {
			var owner int64 = -1
			switch sub {
			case "images":
				_ = db.QueryRow(`SELECT user_id FROM images WHERE file=?`, name).Scan(&owner)
			case "thumbs":
				_ = db.QueryRow(`SELECT user_id FROM images WHERE thumb=?`, name).Scan(&owner)
			case "refs":
				_ = db.QueryRow(`SELECT user_id FROM refs WHERE file=?`, name).Scan(&owner)
			}
			if owner != u.ID {
				http.NotFound(w, r)
				return
			}
		}
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		http.ServeFile(w, r, filepath.Join(dataDir, sub, name))
	}
}

type statusRecorder struct {
	http.ResponseWriter
	code int
}

func (s *statusRecorder) WriteHeader(c int) { s.code = c; s.ResponseWriter.WriteHeader(c) }

func logMW(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, code: 200}
		h.ServeHTTP(rec, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !(r.Method == "GET" && rec.code < 400) {
			log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.code, time.Since(start).Round(time.Millisecond))
		}
	})
}
