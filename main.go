package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
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
)

//go:embed all:web/dist
var webFS embed.FS

var (
	version   = "0.2.0"
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
	s := getSetting("session_secret", "")
	if s == "" {
		b := make([]byte, 32)
		_, _ = rand.Read(b)
		s = hex.EncodeToString(b)
		_ = setSetting("session_secret", s)
	}
	secret = []byte(s + "|" + adminPass)
	if adminPass == "" {
		log.Println("警告：未设置 ADMIN_PASSWORD，任何人都可以访问")
	}
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

	a := func(p string, h http.HandlerFunc) { m.Handle(p, auth(h)) }
	a("GET /api/presets", handlePresets)
	a("GET /api/channels", handleChannelList)
	a("POST /api/channels", handleChannelSave)
	a("PUT /api/channels/{id}", handleChannelSave)
	a("DELETE /api/channels/{id}", handleChannelDelete)
	a("POST /api/channels/probe", handleChannelProbe)
	a("POST /api/channels/order", handleChannelOrder)

	a("POST /api/refs", handleRefUpload)
	a("POST /api/refs/url", handleRefFromURL)

	a("GET /api/market", handleMarketList)
	a("POST /api/market/refresh", handleMarketRefresh)
	a("GET /api/market/img", handleMarketImg)
	a("GET /api/market/hero", handleHero)
	a("GET /api/market/favs", handleMarketFavList)
	a("POST /api/market/favs", handleMarketFavAdd)
	a("POST /api/market/favs/delete", handleMarketFavDel)
	a("GET /files/refs/{name}", serveDir("refs"))
	a("GET /files/images/{name}", serveDir("images"))
	a("GET /files/thumbs/{name}", serveDir("thumbs"))

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

	a("GET /api/settings", handleSettingsGet)
	a("PUT /api/settings", handleSettingsPut)

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

// ---------- 会话 ----------

const cookieName = "studio_session"

func sign(exp int64) string {
	msg := strconv.FormatInt(exp, 10)
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(msg))
	return msg + "." + hex.EncodeToString(h.Sum(nil))
}

func validSession(r *http.Request) bool {
	if adminPass == "" {
		return true
	}
	c, err := r.Cookie(cookieName)
	if err != nil {
		return false
	}
	parts := strings.SplitN(c.Value, ".", 2)
	if len(parts) != 2 {
		return false
	}
	exp, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || exp < time.Now().Unix() {
		return false
	}
	return hmac.Equal([]byte(sign(exp)), []byte(c.Value))
}

func auth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !validSession(r) {
			httpErr(w, 401, "请先登录")
			return
		}
		h(w, r)
	})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct{ Password string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpErr(w, 400, "请求格式错误")
		return
	}
	if adminPass != "" && subtle.ConstantTimeCompare([]byte(body.Password), []byte(adminPass)) != 1 {
		time.Sleep(600 * time.Millisecond)
		httpErr(w, 401, "密码不正确")
		return
	}
	exp := time.Now().Add(30 * 24 * time.Hour).Unix()
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: sign(exp), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Unix(exp, 0), Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"})
	writeJSON(w, map[string]any{"ok": true})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]any{"ok": true})
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"authed": validSession(r), "needPassword": adminPass != "", "version": version})
}

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

func serveDir(sub string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		name := filepath.Base(r.PathValue("name"))
		if name == "." || strings.Contains(name, "..") {
			http.NotFound(w, r)
			return
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
