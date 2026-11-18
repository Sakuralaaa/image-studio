package main

// 提示词市场：运行时从两个公开仓库拉取提示词，缓存进 SQLite；预览图经本服务代理并落盘缓存，不依赖外链。
// 数据源与解析方式参照 gpt-image 项目（glidea/banana-prompt-quicker 的 prompts.json，
// EvoLinkAI/awesome-gpt-image-2-prompts 的中英文 README）。

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gen2brain/webp"
	"golang.org/x/image/draw"
)

const (
	bananaSourceURL = "https://github.com/glidea/banana-prompt-quicker"
	bananaDataURL   = "https://raw.githubusercontent.com/glidea/banana-prompt-quicker/main/prompts.json"
	awesomeSource   = "https://github.com/EvoLinkAI/awesome-gpt-image-2-prompts"
	awesomeZhURL    = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-prompts/main/README_zh-CN.md"
	awesomeEnURL    = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-prompts/main/README.md"
	awesomeRawBase  = "https://raw.githubusercontent.com/EvoLinkAI/awesome-gpt-image-2-prompts/main/"
)

type MarketL10n struct {
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	Category    string `json:"category"`
	SubCategory string `json:"sub_category,omitempty"`
}

type MarketPrompt struct {
	ID          string                `json:"id"`
	Title       string                `json:"title"`
	Preview     string                `json:"preview"`
	RefURLs     []string              `json:"ref_urls"`
	Prompt      string                `json:"prompt"`
	Author      string                `json:"author"`
	Link        string                `json:"link,omitempty"`
	Mode        string                `json:"mode"`
	Category    string                `json:"category"`
	SubCategory string                `json:"sub_category,omitempty"`
	Created     string                `json:"created,omitempty"`
	Source      string                `json:"source"`
	NSFW        bool                  `json:"nsfw"`
	L10n        map[string]MarketL10n `json:"l10n,omitempty"`
}

var (
	marketMu      sync.RWMutex
	marketItems   []MarketPrompt
	marketAllowed map[string]bool
	marketLoaded  bool
	marketFetchMu sync.Mutex
)

const marketSchema = `
CREATE TABLE IF NOT EXISTS market_prompts (id TEXT PRIMARY KEY, seq INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS market_favs (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL);
`

func marketInit() error {
	if err := os.MkdirAll(filepath.Join(dataDir, "market"), 0o755); err != nil {
		return err
	}
	_, err := db.Exec(marketSchema)
	return err
}

func setMarket(items []MarketPrompt) {
	allowed := map[string]bool{}
	for _, it := range items {
		allowed[it.Preview] = true
		for _, u := range it.RefURLs {
			allowed[u] = true
		}
	}
	// 收藏里的条目即使已从源中移除，图片也允许读取
	rows, err := db.Query(`SELECT data FROM market_favs`)
	if err == nil {
		for rows.Next() {
			var s string
			var p MarketPrompt
			if rows.Scan(&s) == nil && json.Unmarshal([]byte(s), &p) == nil {
				allowed[p.Preview] = true
				for _, u := range p.RefURLs {
					allowed[u] = true
				}
			}
		}
		rows.Close()
	}
	marketMu.Lock()
	marketItems = items
	marketAllowed = allowed
	marketLoaded = true
	marketMu.Unlock()
}

func loadMarketFromDB() {
	rows, err := db.Query(`SELECT data FROM market_prompts ORDER BY seq`)
	if err != nil {
		return
	}
	defer rows.Close()
	var items []MarketPrompt
	for rows.Next() {
		var s string
		var p MarketPrompt
		if rows.Scan(&s) == nil && json.Unmarshal([]byte(s), &p) == nil {
			items = append(items, p)
		}
	}
	setMarket(items)
}

var marketHTTP = &http.Client{Timeout: 40 * time.Second}

func fetchBytes(ctx context.Context, u string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (image-studio)")
	res, err := marketHTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return io.ReadAll(io.LimitReader(res.Body, limit))
}

// ---------- banana-prompt-quicker ----------

func parseBanana(data []byte) ([]MarketPrompt, error) {
	var raw []map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	str := func(m map[string]any, k string) string {
		if v, ok := m[k].(string); ok {
			return strings.TrimSpace(v)
		}
		return ""
	}
	var out []MarketPrompt
	for i, m := range raw {
		title, preview, prompt, author := str(m, "title"), str(m, "preview"), str(m, "prompt"), str(m, "author")
		if title == "" || preview == "" || prompt == "" || author == "" {
			continue
		}
		cat := str(m, "category")
		if cat == "" {
			cat = "未分类"
		}
		mode := "generate"
		if str(m, "mode") == "edit" {
			mode = "edit"
		}
		var refs []string
		if arr, ok := m["reference_image_urls"].([]any); ok {
			for _, x := range arr {
				if s, ok := x.(string); ok && strings.TrimSpace(s) != "" {
					refs = append(refs, strings.TrimSpace(s))
				}
			}
		}
		out = append(out, MarketPrompt{
			ID:    "banana:" + strings.Join([]string{title, author, fmt.Sprint(i)}, ":"),
			Title: title, Preview: preview, RefURLs: refs, Prompt: prompt, Author: author,
			Link: str(m, "link"), Mode: mode, Category: cat, SubCategory: str(m, "sub_category"),
			Created: str(m, "created"), Source: "banana-prompt-quicker", NSFW: cat == "NSFW",
		})
	}
	return out, nil
}

// ---------- awesome-gpt-image-2-prompts ----------

var (
	caseHeadRe = regexp.MustCompile(`^### Case\s+(\d+):\s+\[([^\]]+)]\(([^)]+)\)\s+\(by\s+\[([^\]]+)]\(([^)]+)\)\)`)
	mkImgRe    = regexp.MustCompile(`(?i)<img\s+[^>]*src=["']([^"']+)["'][^>]*>`)
	mdPromptRe = regexp.MustCompile("(?i)\\*{2,}\\s*(?:Prompt|提示词)\\s*[:：]\\s*\\*{2,}\\s*\\n\\s*```(?:\\w+)?\\n([\\s\\S]*?)\\n```")
	nsfwRe     = regexp.MustCompile(`(?i)\b(nsfw|nude|naked|lingerie|erotic|seductive|sexy|cleavage|underwear|panties|bra|bikini|ahegao|explicit|sensual|fetish|nipples?|genitals?|buttocks?|thong|topless)\b|裸|色情|情色|性感|诱惑|内衣|内裤|乳|胸|臀|私处|泳衣|比基尼|情趣|丁字裤|翻白眼|吐舌|妩媚|暧昧`)
	emojiLead  = regexp.MustCompile(`^[^\p{L}\p{N}]+`)
)

var awesomeCatZh = map[string]string{
	"E-commerce Cases": "电商主图", "Ad Creative Cases": "广告创意", "Portrait & Photography Cases": "人像摄影",
	"Poster & Illustration Cases": "海报插画", "Character Design Cases": "角色设计",
	"UI & Social Media Mockup Cases": "界面与社媒", "Comparison & Community Examples": "对比与社区",
}

var ignoredHeads = map[string]bool{"简介": true, "最新动态": true, "Menu": true, "致谢": true, "Star History": true}

type awesomeDraft struct {
	MarketPrompt
	lang string
	key  string
}

func parseAwesome(md, lang string) []awesomeDraft {
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	cat := "未分类"
	var out []awesomeDraft
	for i := 0; i < len(lines); i++ {
		ln := lines[i]
		if strings.HasPrefix(ln, "## ") {
			h := strings.TrimSpace(emojiLead.ReplaceAllString(strings.TrimPrefix(ln, "## "), ""))
			if h != "" && !ignoredHeads[h] && (strings.HasSuffix(h, "Cases") || strings.HasSuffix(h, "Examples")) {
				cat = h
				if lang == "zh-CN" {
					if zh, ok := awesomeCatZh[h]; ok {
						cat = zh
					}
				}
			}
			continue
		}
		if !strings.HasPrefix(ln, "### Case ") {
			continue
		}
		end := len(lines)
		for j := i + 1; j < len(lines); j++ {
			if strings.HasPrefix(lines[j], "### Case ") || strings.HasPrefix(lines[j], "## ") {
				end = j
				break
			}
		}
		sec := strings.Join(lines[i:end], "\n")
		i = end - 1
		h := caseHeadRe.FindStringSubmatch(sec)
		im := mkImgRe.FindStringSubmatch(sec)
		pr := mdPromptRe.FindStringSubmatch(sec)
		if h == nil || im == nil || pr == nil {
			continue
		}
		preview := strings.TrimSpace(im[1])
		if !strings.HasPrefix(preview, "http") {
			if u, err := url.Parse(awesomeRawBase); err == nil {
				if r, err := u.Parse(strings.TrimPrefix(preview, "./")); err == nil {
					preview = r.String()
				}
			}
		}
		title, link, author, prompt := strings.TrimSpace(h[2]), strings.TrimSpace(h[3]), strings.TrimSpace(h[4]), strings.TrimSpace(pr[1])
		if title == "" || preview == "" || prompt == "" {
			continue
		}
		sub := "Case " + h[1]
		key := link + "|" + preview
		out = append(out, awesomeDraft{
			MarketPrompt: MarketPrompt{
				ID: "awesome:" + key, Title: title, Preview: preview, RefURLs: []string{}, Prompt: prompt, Author: author,
				Link: link, Mode: "generate", Category: cat, SubCategory: sub, Source: "awesome-gpt-image-2-prompts",
				NSFW: nsfwRe.MatchString(cat + "\n" + title + "\n" + prompt),
				L10n: map[string]MarketL10n{lang: {Title: title, Prompt: prompt, Category: cat, SubCategory: sub}},
			},
			lang: lang, key: key,
		})
	}
	return out
}

func mergeAwesome(groups ...[]awesomeDraft) []MarketPrompt {
	byKey := map[string]*awesomeDraft{}
	var order []string
	for _, g := range groups {
		for i := range g {
			d := g[i]
			cur, ok := byKey[d.key]
			if !ok {
				c := d
				byKey[d.key] = &c
				order = append(order, d.key)
				continue
			}
			for k, v := range d.L10n {
				cur.L10n[k] = v
			}
			cur.NSFW = cur.NSFW || d.NSFW
			if cur.lang != "zh-CN" && d.lang == "zh-CN" {
				cur.Title, cur.Prompt, cur.Category, cur.SubCategory, cur.lang = d.Title, d.Prompt, d.Category, d.SubCategory, d.lang
			}
		}
	}
	out := make([]MarketPrompt, 0, len(order))
	for _, k := range order {
		p := byKey[k].MarketPrompt
		if zh, ok := awesomeCatZh[p.Category]; ok {
			p.Category = zh
		}
		out = append(out, p)
	}
	return out
}

func refreshMarket(ctx context.Context) (int, error) {
	marketFetchMu.Lock()
	defer marketFetchMu.Unlock()
	type res struct {
		data []byte
		err  error
	}
	urls := []string{bananaDataURL, awesomeZhURL, awesomeEnURL}
	results := make([]res, len(urls))
	var wg sync.WaitGroup
	for i, u := range urls {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			d, err := fetchBytes(ctx, u, 30<<20)
			results[i] = res{d, err}
		}(i, u)
	}
	wg.Wait()
	var items []MarketPrompt
	var errs []string
	if results[0].err == nil {
		b, err := parseBanana(results[0].data)
		if err != nil {
			errs = append(errs, "banana-prompt-quicker："+err.Error())
		}
		items = append(items, b...)
	} else {
		errs = append(errs, "banana-prompt-quicker："+results[0].err.Error())
	}
	if results[1].err == nil && results[2].err == nil {
		items = append(items, mergeAwesome(parseAwesome(string(results[1].data), "zh-CN"), parseAwesome(string(results[2].data), "en"))...)
	} else {
		errs = append(errs, "awesome-gpt-image-2-prompts：读取失败")
	}
	if len(items) == 0 {
		return 0, errors.New("提示词市场读取失败：" + strings.Join(errs, "；"))
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	_, _ = tx.Exec(`DELETE FROM market_prompts`)
	seen := map[string]bool{}
	for i, it := range items {
		if seen[it.ID] {
			continue
		}
		seen[it.ID] = true
		if _, err := tx.Exec(`INSERT INTO market_prompts(id,seq,data) VALUES(?,?,?)`, it.ID, i, mustJSON(it)); err != nil {
			tx.Rollback()
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	_ = setSetting("market_fetched_at", fmt.Sprint(now()))
	if len(errs) > 0 {
		_ = setSetting("market_error", strings.Join(errs, "；"))
	} else {
		_ = setSetting("market_error", "")
	}
	loadMarketFromDB()
	return len(items), nil
}

func ensureMarket(ctx context.Context) error {
	marketMu.RLock()
	loaded := marketLoaded
	marketMu.RUnlock()
	if !loaded {
		loadMarketFromDB()
	}
	marketMu.RLock()
	n := len(marketItems)
	marketMu.RUnlock()
	if n == 0 {
		_, err := refreshMarket(ctx)
		return err
	}
	return nil
}

func marketState() map[string]any {
	marketMu.RLock()
	items := marketItems
	marketMu.RUnlock()
	var at int64
	fmt.Sscan(getSetting("market_fetched_at", "0"), &at)
	return map[string]any{
		"items":      items,
		"fetched_at": at,
		"error":      getSetting("market_error", ""),
		"sources": []map[string]string{
			{"id": "banana-prompt-quicker", "label": "glidea/banana-prompt-quicker", "url": bananaSourceURL},
			{"id": "awesome-gpt-image-2-prompts", "label": "EvoLinkAI/awesome-gpt-image-2-prompts", "url": awesomeSource},
		},
	}
}

func handleMarketList(w http.ResponseWriter, r *http.Request) {
	if err := ensureMarket(r.Context()); err != nil {
		httpErr(w, 502, err.Error())
		return
	}
	writeJSON(w, marketState())
}

func handleMarketRefresh(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	if _, err := refreshMarket(ctx); err != nil {
		httpErr(w, 502, err.Error())
		return
	}
	writeJSON(w, marketState())
}

// ---------- 收藏 ----------

func handleMarketFavList(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT data FROM market_favs ORDER BY created_at DESC`)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []MarketPrompt{}
	for rows.Next() {
		var s string
		var p MarketPrompt
		if rows.Scan(&s) == nil && json.Unmarshal([]byte(s), &p) == nil {
			out = append(out, p)
		}
	}
	writeJSON(w, out)
}

func handleMarketFavAdd(w http.ResponseWriter, r *http.Request) {
	var p MarketPrompt
	if err := readJSON(r, &p); err != nil || p.ID == "" {
		httpErr(w, 400, "参数错误")
		return
	}
	// 以缓存中的条目为准，防止写入任意图片地址
	marketMu.RLock()
	var found *MarketPrompt
	for i := range marketItems {
		if marketItems[i].ID == p.ID {
			x := marketItems[i]
			found = &x
			break
		}
	}
	marketMu.RUnlock()
	if found == nil {
		httpErr(w, 404, "条目不存在")
		return
	}
	_, err := db.Exec(`INSERT INTO market_favs(id,data,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, found.ID, mustJSON(found), now())
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func handleMarketFavDel(w http.ResponseWriter, r *http.Request) {
	var p struct {
		ID string `json:"id"`
	}
	if err := readJSON(r, &p); err != nil {
		httpErr(w, 400, "参数错误")
		return
	}
	_, _ = db.Exec(`DELETE FROM market_favs WHERE id=?`, p.ID)
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 图片代理与缓存 ----------

func marketURLAllowed(u string) bool {
	marketMu.RLock()
	ok := marketAllowed[u]
	marketMu.RUnlock()
	if ok {
		return true
	}
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM market_favs WHERE data LIKE ?`, "%"+u+"%").Scan(&n)
	return n > 0
}

func cacheName(u string) string {
	h := sha1.Sum([]byte(u))
	return hex.EncodeToString(h[:])[:20]
}

func scaleEncode(data []byte, maxW int) ([]byte, string, error) {
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w > maxW {
		h = h * maxW / w
		w = maxW
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Src, nil)
	var buf bytes.Buffer
	if err := webp.Encode(&buf, dst, webp.Options{Quality: 82}); err == nil {
		return buf.Bytes(), "webp", nil
	}
	buf.Reset()
	if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 86}); err != nil {
		return nil, "", err
	}
	return buf.Bytes(), "jpg", nil
}

var imgLocks sync.Map

// cachedMarketImage 返回本地缓存文件路径（宽度不超过 720 的 webp）
func cachedMarketImage(ctx context.Context, u string) (string, error) {
	base := filepath.Join(dataDir, "market", cacheName(u))
	for _, ext := range []string{".webp", ".jpg"} {
		if _, err := os.Stat(base + ext); err == nil {
			return base + ext, nil
		}
	}
	if _, err := os.Stat(base + ".fail"); err == nil {
		return "", errors.New("图片不可用")
	}
	l, _ := imgLocks.LoadOrStore(u, &sync.Mutex{})
	mu := l.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()
	for _, ext := range []string{".webp", ".jpg"} {
		if _, err := os.Stat(base + ext); err == nil {
			return base + ext, nil
		}
	}
	data, err := fetchBytes(ctx, u, 25<<20)
	if err != nil {
		return "", err
	}
	out, ext, err := scaleEncode(data, 720)
	if err != nil {
		_ = os.WriteFile(base+".fail", nil, 0o644)
		return "", err
	}
	if err := os.WriteFile(base+"."+ext, out, 0o644); err != nil {
		return "", err
	}
	return base + "." + ext, nil
}

func handleMarketImg(w http.ResponseWriter, r *http.Request) {
	u := r.URL.Query().Get("u")
	_ = ensureMarket(r.Context())
	if u == "" || !marketURLAllowed(u) {
		httpErr(w, 404, "图片不存在")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	p, err := cachedMarketImage(ctx, u)
	if err != nil {
		httpErr(w, 502, "图片读取失败")
		return
	}
	w.Header().Set("Cache-Control", "private, max-age=604800")
	http.ServeFile(w, r, p)
}

// 把市场条目里的参考图拉下来存成参考图
func handleRefFromURL(w http.ResponseWriter, r *http.Request) {
	var p struct {
		URL string `json:"url"`
	}
	if err := readJSON(r, &p); err != nil || p.URL == "" {
		httpErr(w, 400, "参数错误")
		return
	}
	_ = ensureMarket(r.Context())
	if !marketURLAllowed(p.URL) {
		httpErr(w, 400, "只能导入提示词市场里的参考图")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	data, err := fetchBytes(ctx, p.URL, 30<<20)
	if err != nil {
		httpErr(w, 502, "参考图下载失败")
		return
	}
	ext, mime := sniffFormat(data)
	if ext == "" {
		httpErr(w, 400, "参考图格式不支持")
		return
	}
	file := randName() + "." + ext
	if err := os.WriteFile(filepath.Join(dataDir, "refs", file), data, 0o644); err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	res, err := db.Exec(`INSERT INTO refs(file,mime,created_at) VALUES(?,?,?)`, file, mime, now())
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, map[string]any{"id": id, "url": "/files/refs/" + file})
}

// ---------- 首页示例 ----------

// 首页扇形示例：从市场里挑 5 条非 NSFW 的文生图条目（优先下面这些标题关键词），图片预先缓存到本地
// 精选的 5 张（按预览图路径匹配，顺序即扇形从左到右）
var heroDefault = []string{
	"ad-creative_case199/output.jpg", "poster_case338/output.jpg", "portrait_case323/output.jpg",
	"poster_case264/output.jpg", "ad-creative_case191/output.jpg",
}

var heroPrefer = []string{"Miniature Diorama", "微缩", "电影", "Cinematic", "Portrait", "人像", "Poster", "海报", "Character", "角色"}

func pickHero() []MarketPrompt {
	marketMu.RLock()
	items := append([]MarketPrompt(nil), marketItems...)
	marketMu.RUnlock()
	var out0 []MarketPrompt
	for _, key := range heroDefault {
		for _, it := range items {
			if strings.HasSuffix(it.Preview, key) && !it.NSFW {
				out0 = append(out0, it)
				break
			}
		}
	}
	if len(out0) == 5 {
		return out0
	}
	type sc struct {
		p MarketPrompt
		s int
	}
	var c []sc
	for i, it := range items {
		if it.NSFW || it.Mode != "generate" {
			continue
		}
		s := 0
		for k, kw := range heroPrefer {
			if strings.Contains(it.Title, kw) || strings.Contains(it.Category, kw) {
				s += 100 - k
			}
		}
		s -= i / 50
		c = append(c, sc{it, s})
	}
	sort.SliceStable(c, func(a, b int) bool { return c[a].s > c[b].s })
	var out []MarketPrompt
	for _, x := range c {
		out = append(out, x.p)
		if len(out) == 5 {
			break
		}
	}
	return out
}

func handleHero(w http.ResponseWriter, r *http.Request) {
	if err := ensureMarket(r.Context()); err != nil {
		writeJSON(w, []MarketPrompt{})
		return
	}
	list := pickHero()
	// 预热缓存（并行，最多等 30 秒）
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	var wg sync.WaitGroup
	ok := make([]bool, len(list))
	for i, it := range list {
		wg.Add(1)
		go func(i int, u string) {
			defer wg.Done()
			if _, err := cachedMarketImage(ctx, u); err == nil {
				ok[i] = true
			} else {
				log.Printf("示例图缓存失败 %s: %v", u, err)
			}
		}(i, it.Preview)
	}
	wg.Wait()
	out := []MarketPrompt{}
	for i, it := range list {
		if ok[i] {
			out = append(out, it)
		}
	}
	writeJSON(w, out)
}
