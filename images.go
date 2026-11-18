package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gen2brain/webp"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "github.com/gen2brain/heic"
	_ "github.com/gen2brain/avif"
)

func sniffFormat(data []byte) (ext, mime string) {
	switch {
	case len(data) > 12 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return "webp", "image/webp"
	case len(data) > 8 && bytes.HasPrefix(data, []byte{0x89, 'P', 'N', 'G'}):
		return "png", "image/png"
	case len(data) > 3 && data[0] == 0xFF && data[1] == 0xD8:
		return "jpeg", "image/jpeg"
	case len(data) > 6 && (string(data[0:6]) == "GIF89a" || string(data[0:6]) == "GIF87a"):
		return "gif", "image/gif"
	}
	return "", ""
}

func convertRef(data []byte) ([]byte, string, string, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", "", err
	}
	var buf bytes.Buffer
	if hasAlpha(src) {
		if err := png.Encode(&buf, src); err != nil {
			return nil, "", "", err
		}
		return buf.Bytes(), "png", "image/png", nil
	}
	if err := jpeg.Encode(&buf, src, &jpeg.Options{Quality: 92}); err != nil {
		return nil, "", "", err
	}
	return buf.Bytes(), "jpeg", "image/jpeg", nil
}

func hasAlpha(img image.Image) bool {
	if o, ok := img.(interface{ Opaque() bool }); ok {
		return !o.Opaque()
	}
	return false
}

func randName() string { return newGroupID() + strconv.FormatInt(time.Now().UnixNano()%1e6, 36) }

func saveImage(jobID int64, data []byte) error {
	ext, _ := sniffFormat(data)
	if ext == "" {
		return fmt.Errorf("无法识别的图片格式")
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("图片解码失败：%w", err)
	}
	fileExt := ext
	if fileExt == "jpeg" {
		fileExt = "jpg"
	}
	name := randName()
	file := name + "." + fileExt
	if err := os.WriteFile(filepath.Join(dataDir, "images", file), data, 0o644); err != nil {
		return err
	}
	thumb := ""
	if t, err := makeThumb(data, name); err == nil {
		thumb = t
	} else {
		log.Printf("缩略图生成失败: %v", err)
	}
	_, err = db.Exec(`INSERT INTO images(job_id,file,thumb,width,height,bytes,format,created_at,user_id) VALUES(?,?,?,?,?,?,?,?,COALESCE((SELECT user_id FROM jobs WHERE id=?),0))`,
		jobID, file, thumb, cfg.Width, cfg.Height, len(data), ext, now(), jobID)
	return err
}

func makeThumb(data []byte, name string) (string, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	b := src.Bounds()
	const tw = 640
	w, h := b.Dx(), b.Dy()
	if w > tw {
		h = h * tw / w
		w = tw
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	var buf bytes.Buffer
	file := name + ".webp"
	if err := webp.Encode(&buf, dst, webp.Options{Quality: 80}); err != nil {
		// 兜底 jpeg
		buf.Reset()
		if err2 := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 84}); err2 != nil {
			return "", err
		}
		file = name + ".jpg"
	}
	if err := os.WriteFile(filepath.Join(dataDir, "thumbs", file), buf.Bytes(), 0o644); err != nil {
		return "", err
	}
	return file, nil
}

// ---------- 参考图 ----------

func handleRefUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 40<<20)
	f, _, err := r.FormFile("file")
	if err != nil {
		httpErr(w, 400, "请选择图片")
		return
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		httpErr(w, 400, "读取失败")
		return
	}
	ext, mime := sniffFormat(data)
	if ext == "" {
		// HEIC / AVIF / BMP / TIFF 等：解码后转成上游通用的 PNG（有透明）或 JPEG
		data, ext, mime, err = convertRef(data)
		if err != nil {
			httpErr(w, 400, "无法识别这张图片，支持 PNG、JPEG、WEBP、GIF、HEIC、AVIF、BMP、TIFF")
			return
		}
	}
	file := randName() + "." + ext
	if err := os.WriteFile(filepath.Join(dataDir, "refs", file), data, 0o644); err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	res, err := db.Exec(`INSERT INTO refs(file,mime,created_at,user_id) VALUES(?,?,?,?)`, file, mime, now(), cur(r).ID)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, map[string]any{"id": id, "url": "/files/refs/" + file})
}

// ---------- 图片列表 ----------

type ImageOut struct {
	ID        int64    `json:"id"`
	JobID     int64    `json:"job_id"`
	URL       string   `json:"url"`
	Thumb     string   `json:"thumb"`
	Width     int      `json:"width"`
	Height    int      `json:"height"`
	Bytes     int64    `json:"bytes"`
	Format    string   `json:"format"`
	Favorite  bool     `json:"favorite"`
	FavAt     int64    `json:"fav_at"`
	Album     string   `json:"album"`
	Tags      []string `json:"tags"`
	CreatedAt int64    `json:"created_at"`
	ExpiresAt int64    `json:"expires_at"` // 未收藏图片的清理时间，0 = 不清理
	UserID    int64    `json:"user_id"`
	Owner     string   `json:"owner"`
	Recipe    Recipe   `json:"recipe"`
}

type Recipe struct {
	ChannelID   int64           `json:"channel_id"`
	ChannelName string          `json:"channel_name"`
	APIType     string          `json:"api_type"`
	Model       string          `json:"model"`
	Prompt      string          `json:"prompt"`
	SentPrompt  string          `json:"sent_prompt"`
	Params      json.RawMessage `json:"params"`
	Endpoint    string          `json:"endpoint"`
	DurationMS  int64           `json:"duration_ms"`
	ToolPath    bool            `json:"tool_path"`
	Kind        string          `json:"kind"`
	GroupID     string          `json:"group_id"`
	RefCount    int             `json:"ref_count"`
}

const imgSelect = `SELECT i.id,i.job_id,i.file,i.thumb,i.width,i.height,i.bytes,i.format,i.favorite,i.fav_at,i.album,i.tags,i.created_at,
 COALESCE(j.channel_id,0),COALESCE(j.channel_name,''),COALESCE(j.api_type,''),COALESCE(j.model,''),COALESCE(j.prompt,''),COALESCE(j.sent_prompt,''),COALESCE(j.params,'{}'),COALESCE(j.endpoint,''),COALESCE(j.duration_ms,0),COALESCE(j.tool_path,0),COALESCE(j.kind,''),COALESCE(j.group_id,''),COALESCE(j.refs,'[]'),
 i.user_id,COALESCE(NULLIF(u.nickname,''),u.username,'')
 FROM images i LEFT JOIN jobs j ON j.id=i.job_id LEFT JOIN users u ON u.id=i.user_id `

func queryImages(where string, args ...any) ([]*ImageOut, error) {
	rows, err := db.Query(imgSelect+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*ImageOut{}
	keep := int64(retentionHours()) * 3600 * 1000
	for rows.Next() {
		var im ImageOut
		var fav, tp int
		var tags, params, refs string
		if err := rows.Scan(&im.ID, &im.JobID, &im.URL, &im.Thumb, &im.Width, &im.Height, &im.Bytes, &im.Format, &fav, &im.FavAt, &im.Album, &tags, &im.CreatedAt,
			&im.Recipe.ChannelID, &im.Recipe.ChannelName, &im.Recipe.APIType, &im.Recipe.Model, &im.Recipe.Prompt, &im.Recipe.SentPrompt, &params, &im.Recipe.Endpoint, &im.Recipe.DurationMS, &tp, &im.Recipe.Kind, &im.Recipe.GroupID, &refs, &im.UserID, &im.Owner); err != nil {
			return nil, err
		}
		im.Favorite = fav == 1
		if !im.Favorite && keep > 0 {
			im.ExpiresAt = im.CreatedAt + keep
		}
		im.Recipe.ToolPath = tp == 1
		im.Recipe.Params = json.RawMessage(params)
		var rl []int64
		_ = json.Unmarshal([]byte(refs), &rl)
		im.Recipe.RefCount = len(rl)
		_ = json.Unmarshal([]byte(tags), &im.Tags)
		if im.Tags == nil {
			im.Tags = []string{}
		}
		im.URL = "/files/images/" + im.URL
		if im.Thumb != "" {
			im.Thumb = "/files/thumbs/" + im.Thumb
		} else {
			im.Thumb = im.URL
		}
		out = append(out, &im)
	}
	return out, nil
}

// GET /api/images?fav=1&q=&album=&tag=&channel=&model=&cursor=&limit=
func handleImageList(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	conds, args := imageScope(cur(r), q.Get("user"))
	switch q.Get("fav") {
	case "1":
		conds = append(conds, "i.favorite=1")
	case "0":
		conds = append(conds, "i.favorite=0")
	}
	if c, _ := strconv.ParseInt(q.Get("cursor"), 10, 64); c > 0 {
		conds = append(conds, "i.id<?")
		args = append(args, c)
	}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		like := "%" + s + "%"
		if cur(r).IsAdmin() {
			conds = append(conds, "(j.prompt LIKE ? OR i.tags LIKE ? OR i.album LIKE ? OR j.channel_name LIKE ? OR j.model LIKE ?)")
			args = append(args, like, like, like, like, like)
		} else {
			conds = append(conds, "(j.prompt LIKE ? OR i.tags LIKE ? OR i.album LIKE ? OR j.model LIKE ?)")
			args = append(args, like, like, like, like)
		}
	}
	if a := q.Get("album"); a != "" {
		conds = append(conds, "i.album=?")
		args = append(args, a)
	}
	if t := q.Get("tag"); t != "" {
		conds = append(conds, "i.tags LIKE ?")
		args = append(args, "%"+mustJSON(t)+"%")
	}
	if c := q.Get("channel"); c != "" && cur(r).IsAdmin() {
		conds = append(conds, "j.channel_name=?")
		args = append(args, c)
	}
	if m := q.Get("model"); m != "" {
		conds = append(conds, "j.model=?")
		args = append(args, m)
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 40
	}
	imgs, err := queryImages(where+" ORDER BY i.id DESC LIMIT ?", append(args, limit+1)...)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	sanitizeImages(cur(r), imgs)
	var next int64
	if len(imgs) > limit {
		imgs = imgs[:limit]
		next = imgs[len(imgs)-1].ID
	}
	writeJSON(w, map[string]any{"images": imgs, "next": next})
}

func getImage(id int64) (*ImageOut, error) {
	imgs, err := queryImages(`WHERE i.id=?`, id)
	if err != nil {
		return nil, err
	}
	if len(imgs) == 0 {
		return nil, fmt.Errorf("图片不存在")
	}
	return imgs[0], nil
}

// imageScope 普通用户只看自己的；管理员默认看全部，可按 user 过滤（me = 自己）
func imageScope(u *User, filter string) ([]string, []any) {
	if !u.IsAdmin() {
		return []string{"i.user_id=?"}, []any{u.ID}
	}
	if filter == "me" {
		return []string{"i.user_id=?"}, []any{u.ID}
	}
	if id, _ := strconv.ParseInt(filter, 10, 64); id > 0 {
		return []string{"i.user_id=?"}, []any{id}
	}
	return nil, nil
}

func sanitizeImages(u *User, imgs []*ImageOut) {
	if u.IsAdmin() {
		return
	}
	for _, im := range imgs {
		im.Recipe.ChannelName = ""
		im.Recipe.Endpoint = ""
		im.Owner = ""
	}
}

// ownedImage 取图片并检查归属
func ownedImage(r *http.Request) (*ImageOut, bool) {
	im, err := getImage(pathID(r))
	if err != nil {
		return nil, false
	}
	u := cur(r)
	if !u.IsAdmin() && im.UserID != u.ID {
		return nil, false
	}
	sanitizeImages(u, []*ImageOut{im})
	return im, true
}

func handleImageGet(w http.ResponseWriter, r *http.Request) {
	im, ok := ownedImage(r)
	if !ok {
		httpErr(w, 404, "图片不存在")
		return
	}
	writeJSON(w, im)
}

func handleImagePatch(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	if _, ok := ownedImage(r); !ok {
		httpErr(w, 404, "图片不存在")
		return
	}
	var in struct {
		Favorite *bool    `json:"favorite"`
		Album    *string  `json:"album"`
		Tags     []string `json:"tags"`
	}
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if in.Favorite != nil {
		fa := int64(0)
		if *in.Favorite {
			fa = now()
		}
		_, _ = db.Exec(`UPDATE images SET favorite=?, fav_at=? WHERE id=?`, b2i(*in.Favorite), fa, id)
	}
	if in.Album != nil {
		_, _ = db.Exec(`UPDATE images SET album=? WHERE id=?`, strings.TrimSpace(*in.Album), id)
	}
	if in.Tags != nil {
		clean := []string{}
		seen := map[string]bool{}
		for _, t := range in.Tags {
			t = strings.TrimSpace(t)
			if t != "" && !seen[t] {
				seen[t] = true
				clean = append(clean, t)
			}
		}
		_, _ = db.Exec(`UPDATE images SET tags=? WHERE id=?`, mustJSON(clean), id)
	}
	im, ok := ownedImage(r)
	if !ok {
		httpErr(w, 404, "图片不存在")
		return
	}
	writeJSON(w, im)
}

func deleteImage(id int64) {
	var file, thumb string
	if db.QueryRow(`SELECT file,thumb FROM images WHERE id=?`, id).Scan(&file, &thumb) != nil {
		return
	}
	_ = os.Remove(filepath.Join(dataDir, "images", file))
	if thumb != "" {
		_ = os.Remove(filepath.Join(dataDir, "thumbs", thumb))
	}
	_, _ = db.Exec(`DELETE FROM images WHERE id=?`, id)
}

func handleImageDelete(w http.ResponseWriter, r *http.Request) {
	im, ok := ownedImage(r)
	if !ok {
		httpErr(w, 404, "图片不存在")
		return
	}
	deleteImage(im.ID)
	writeJSON(w, map[string]any{"ok": true})
}

func downloadName(im *ImageOut) string {
	ext := filepath.Ext(im.URL)
	t := time.UnixMilli(im.CreatedAt).Format("20060102-150405")
	return fmt.Sprintf("studio-%s-%d%s", t, im.ID, ext)
}

func handleImageDownload(w http.ResponseWriter, r *http.Request) {
	im, ok := ownedImage(r)
	if !ok {
		httpErr(w, 404, "图片不存在")
		return
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+downloadName(im)+`"`)
	http.ServeFile(w, r, filepath.Join(dataDir, "images", filepath.Base(im.URL)))
}

// POST /api/images/export {ids:[...]} → zip（原图 + recipes.json）
func handleImageExport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []int64 `json:"ids"`
		Fav bool    `json:"fav"`
	}
	if r.Header.Get("Content-Type") == "application/x-www-form-urlencoded" {
		_ = r.ParseForm()
		_ = json.Unmarshal([]byte(r.FormValue("payload")), &in)
	} else if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	var imgs []*ImageOut
	u := cur(r)
	if len(in.IDs) == 0 && in.Fav {
		imgs, _ = queryImages(`WHERE i.favorite=1 AND i.user_id=? ORDER BY i.id DESC`, u.ID)
	} else {
		for _, id := range in.IDs {
			if im, err := getImage(id); err == nil && (u.IsAdmin() || im.UserID == u.ID) {
				imgs = append(imgs, im)
			}
		}
	}
	sanitizeImages(u, imgs)
	if len(imgs) == 0 {
		httpErr(w, 400, "没有可导出的图片")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="studio-assets-`+time.Now().Format("20060102-1504")+`.zip"`)
	zw := zip.NewWriter(w)
	recipes := []map[string]any{}
	for _, im := range imgs {
		name := downloadName(im)
		f, err := os.Open(filepath.Join(dataDir, "images", filepath.Base(im.URL)))
		if err != nil {
			continue
		}
		hdr := &zip.FileHeader{Name: name, Method: zip.Store, Modified: time.UnixMilli(im.CreatedAt)}
		zf, err := zw.CreateHeader(hdr)
		if err == nil {
			_, _ = io.Copy(zf, f)
		}
		f.Close()
		recipes = append(recipes, map[string]any{"file": name, "width": im.Width, "height": im.Height, "album": im.Album, "tags": im.Tags, "recipe": im.Recipe})
	}
	if zf, err := zw.Create("recipes.json"); err == nil {
		b, _ := json.MarshalIndent(recipes, "", "  ")
		_, _ = zf.Write(b)
	}
	_ = zw.Close()
}

// GET /api/facets 资产库筛选项
func handleFacets(w http.ResponseWriter, r *http.Request) {
	u := cur(r)
	conds, args := imageScope(u, r.URL.Query().Get("user"))
	scope := "1=1"
	if len(conds) > 0 {
		scope = strings.Join(conds, " AND ")
	}
	out := map[string]any{}
	collect := func(q string) []map[string]any {
		res := []map[string]any{}
		rows, err := db.Query(q, args...)
		if err != nil {
			return res
		}
		defer rows.Close()
		for rows.Next() {
			var k string
			var n int
			if rows.Scan(&k, &n) == nil && k != "" {
				res = append(res, map[string]any{"name": k, "count": n})
			}
		}
		return res
	}
	out["albums"] = collect(`SELECT i.album, COUNT(*) FROM images i WHERE ` + scope + ` AND i.favorite=1 AND i.album<>'' GROUP BY i.album ORDER BY COUNT(*) DESC`)
	if u.IsAdmin() {
		out["channels"] = collect(`SELECT j.channel_name, COUNT(*) FROM images i JOIN jobs j ON j.id=i.job_id WHERE ` + scope + ` AND i.favorite=1 GROUP BY j.channel_name ORDER BY COUNT(*) DESC`)
		out["users"] = collect(`SELECT CAST(i.user_id AS TEXT) || '|' || COALESCE(NULLIF(us.nickname,''),us.username,''), COUNT(*) FROM images i LEFT JOIN users us ON us.id=i.user_id WHERE ` + scope + ` GROUP BY i.user_id ORDER BY COUNT(*) DESC`)
	} else {
		out["channels"] = []map[string]any{}
	}
	out["models"] = collect(`SELECT j.model, COUNT(*) FROM images i JOIN jobs j ON j.id=i.job_id WHERE ` + scope + ` AND i.favorite=1 GROUP BY j.model ORDER BY COUNT(*) DESC`)
	tagCount := map[string]int{}
	rows, err := db.Query(`SELECT i.tags FROM images i WHERE `+scope+` AND i.favorite=1 AND i.tags<>'[]'`, args...)
	if err == nil {
		for rows.Next() {
			var s string
			var tags []string
			if rows.Scan(&s) == nil && json.Unmarshal([]byte(s), &tags) == nil {
				for _, t := range tags {
					tagCount[t]++
				}
			}
		}
		rows.Close()
	}
	tags := []map[string]any{}
	for k, v := range tagCount {
		tags = append(tags, map[string]any{"name": k, "count": v})
	}
	out["tags"] = tags
	var total, fav int
	var bytesAll int64
	_ = db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(i.favorite),0), COALESCE(SUM(i.bytes),0) FROM images i WHERE `+scope, args...).Scan(&total, &fav, &bytesAll)
	out["total"] = total
	out["favorites"] = fav
	out["bytes"] = bytesAll
	writeJSON(w, out)
}

// ---------- 设置 & 清理 ----------

// cleanupOnce 清理超过保留天数且未收藏的历史图片；收藏的资产永远不动
func cleanupOnce() int {
	hours := retentionHours()
	if hours <= 0 {
		return 0
	}
	cut := time.Now().Add(-time.Duration(hours) * time.Hour).UnixMilli()
	rows, err := db.Query(`SELECT id FROM images WHERE favorite=0 AND created_at<?`, cut)
	if err != nil {
		return 0
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		deleteImage(id)
	}
	_, _ = db.Exec(`DELETE FROM jobs WHERE status<>'running' AND status<>'queued' AND created_at<? AND id NOT IN (SELECT job_id FROM images)`, cut)
	// 过期参考图
	// 参考图至少保留一天，免得输入框里刚上传的图被清掉
	refCut := min(cut, time.Now().Add(-24*time.Hour).UnixMilli())
	rrows, err := db.Query(`SELECT id,file FROM refs WHERE created_at<?`, refCut)
	if err == nil {
		type rf struct {
			id   int64
			file string
		}
		var list []rf
		for rrows.Next() {
			var x rf
			if rrows.Scan(&x.id, &x.file) == nil {
				list = append(list, x)
			}
		}
		rrows.Close()
		for _, x := range list {
			_ = os.Remove(filepath.Join(dataDir, "refs", x.file))
			_, _ = db.Exec(`DELETE FROM refs WHERE id=?`, x.id)
		}
	}
	if len(ids) > 0 {
		log.Printf("清理了 %d 张历史图片", len(ids))
	}
	return len(ids)
}

func cleanupLoop() {
	time.Sleep(time.Minute)
	for {
		cleanupOnce()
		time.Sleep(15 * time.Minute)
	}
}
