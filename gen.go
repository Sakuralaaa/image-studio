package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Params struct {
	Size        string `json:"size,omitempty"`
	Aspect      string `json:"aspect,omitempty"`
	Resolution  string `json:"resolution,omitempty"`
	Quality     string `json:"quality,omitempty"`
	N           int    `json:"n,omitempty"`
	Format      string `json:"format,omitempty"`
	Compression int    `json:"compression,omitempty"`
	Background  string `json:"background,omitempty"`
	Moderation  string `json:"moderation,omitempty"`
}

type JobIn struct {
	ChannelID int64   `json:"channel_id"`
	Model     string  `json:"model"`
	Prompt    string  `json:"prompt"`
	Params    Params  `json:"params"`
	Refs      []int64 `json:"refs"`
}

var genSem = make(chan struct{}, 6)

func newGroupID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// jobWant 这个任务预计产出的张数（用于额度）
func jobWant(ch *Channel, p Params) int {
	n := p.N
	if n <= 0 || ch.Caps.N.Mode == "off" {
		n = 1
	}
	if ch.Caps.N.Max > 0 && n > ch.Caps.N.Max {
		n = ch.Caps.N.Max
	}
	return n
}

func createJob(u *User, in JobIn, kind, group string, slot int) (int64, error) {
	in.Prompt = strings.TrimSpace(in.Prompt)
	if in.Prompt == "" {
		return 0, errors.New("提示词不能为空")
	}
	ch, err := getChannel(in.ChannelID)
	if err != nil {
		return 0, errors.New("模型不可用")
	}
	if in.Model == "" {
		if len(ch.Models) == 0 {
			return 0, errors.New("请先为渠道选择模型")
		}
		in.Model = ch.Models[0]
	}
	if !canUseChannelModel(u, ch, in.Model) {
		return 0, errors.New("没有这个模型的使用权限")
	}
	if in.Refs == nil {
		in.Refs = []int64{}
	}
	// 参考图必须是自己上传的
	if !u.IsAdmin() {
		for _, rid := range in.Refs {
			var owner int64
			if db.QueryRow(`SELECT user_id FROM refs WHERE id=?`, rid).Scan(&owner) != nil || owner != u.ID {
				return 0, errors.New("参考图不存在，请重新上传")
			}
		}
	}
	if max := ch.Caps.Refs.Max; ch.Caps.Refs.Mode != "off" && max > 0 && len(in.Refs) > max {
		in.Refs = in.Refs[:max]
	}
	want := jobWant(ch, in.Params)
	resv, err := reserveQuota(u, want, slot == 0)
	if err != nil {
		return 0, err
	}
	res, err := db.Exec(`INSERT INTO jobs(kind,group_id,slot,channel_id,channel_name,api_type,model,prompt,params,refs,status,created_at,user_id,quota_daily,quota_bonus,quota_day) VALUES(?,?,?,?,?,?,?,?,?,?, 'queued', ?,?,?,?,?)`,
		kind, group, slot, ch.ID, ch.Name, ch.APIType, in.Model, in.Prompt, mustJSON(in.Params), mustJSON(in.Refs), now(), u.ID, resv.daily, resv.bonus, resv.day)
	if err != nil {
		return 0, err
	}
	id, _ := res.LastInsertId()
	go runJob(id, ch, in, want)
	return id, nil
}

func handleJobCreate(w http.ResponseWriter, r *http.Request) {
	var in JobIn
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	id, err := createJob(cur(r), in, "single", "", 0)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	j, _ := loadJob(id)
	sanitizeJob(cur(r), j)
	writeJSON(w, j)
}

// ---------- 执行 ----------

type genResult struct {
	images   [][]byte
	toolPath bool
}

func runJob(id int64, ch *Channel, in JobIn, want int) {
	genSem <- struct{}{}
	defer func() { <-genSem }()
	start := time.Now()
	saved := 0
	// 没生成出来的张数退回额度
	defer func() { refundQuota(id, want-saved) }()
	_, _ = db.Exec(`UPDATE jobs SET status='running', started_at=? WHERE id=?`, start.UnixMilli(), id)

	fail := func(msg string) {
		_, _ = db.Exec(`UPDATE jobs SET status='failed', error=?, finished_at=?, duration_ms=? WHERE id=?`, msg, now(), time.Since(start).Milliseconds(), id)
	}
	defer func() {
		if rec := recover(); rec != nil {
			log.Printf("job %d panic: %v", id, rec)
			fail(fmt.Sprint("内部错误：", rec))
		}
	}()

	refs, err := loadRefs(in.Refs)
	if err != nil {
		fail(err.Error())
		return
	}
	plan := buildPlan(ch, in, len(refs) > 0)
	_, _ = db.Exec(`UPDATE jobs SET sent_prompt=?, sent_body=?, endpoint=? WHERE id=?`, plan.Prompt, mustJSON(plan.Body), plan.Endpoint, id)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	var all [][]byte
	toolPath := false
	var lastErr error
	for i := 0; i < plan.Calls; i++ {
		res, err := doCall(ctx, ch, plan, refs)
		if err != nil && isRetryable(err) && ctx.Err() == nil {
			time.Sleep(2 * time.Second)
			res, err = doCall(ctx, ch, plan, refs)
		}
		if err != nil {
			lastErr = err
			if len(all) == 0 && i == 0 && plan.Calls > 1 {
				break // 第一张就失败，不必继续
			}
			continue
		}
		all = append(all, res.images...)
		toolPath = toolPath || res.toolPath
	}
	if toolPath {
		_, _ = db.Exec(`UPDATE channels SET tool_path_at=? WHERE id=?`, now(), ch.ID)
	} else if len(all) > 0 {
		_, _ = db.Exec(`UPDATE channels SET tool_path_at=0 WHERE id=?`, ch.ID) // 恢复正常后清除标记
	}
	if len(all) == 0 {
		msg := "没有返回图片"
		if lastErr != nil {
			msg = lastErr.Error()
		}
		_, _ = db.Exec(`UPDATE jobs SET tool_path=? WHERE id=?`, b2i(toolPath), id)
		fail(msg)
		return
	}
	for _, data := range all {
		if err := saveImage(id, data); err != nil {
			log.Printf("job %d 保存图片失败: %v", id, err)
			lastErr = err
			continue
		}
		saved++
	}
	if saved == 0 {
		fail("图片保存失败：" + lastErr.Error())
		return
	}
	errMsg := ""
	if lastErr != nil {
		errMsg = "部分失败：" + lastErr.Error()
	}
	_, _ = db.Exec(`UPDATE jobs SET status='done', error=?, tool_path=?, finished_at=?, duration_ms=? WHERE id=?`, errMsg, b2i(toolPath), now(), time.Since(start).Milliseconds(), id)
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

type refFile struct {
	Name string
	Mime string
	Data []byte
}

func loadRefs(ids []int64) ([]refFile, error) {
	out := []refFile{}
	for _, id := range ids {
		var file, mime string
		if err := db.QueryRow(`SELECT file,mime FROM refs WHERE id=?`, id).Scan(&file, &mime); err != nil {
			return nil, errors.New("参考图已失效，请重新上传")
		}
		data, err := os.ReadFile(filepath.Join(dataDir, "refs", file))
		if err != nil {
			return nil, errors.New("参考图读取失败")
		}
		out = append(out, refFile{Name: file, Mime: mime, Data: data})
	}
	return out, nil
}

// ---------- 请求规划：原生发送 / 写进提示词 ----------

type Plan struct {
	Endpoint string         `json:"endpoint"`
	Prompt   string         `json:"prompt"`
	Body     map[string]any `json:"body"`
	Calls    int            `json:"calls"`
	Edit     bool           `json:"edit"`
	RefMode  string         `json:"ref_mode"`
}

func ratioOf(w, h int) string {
	g := gcd(w, h)
	if g == 0 {
		return ""
	}
	return fmt.Sprintf("%d:%d", w/g, h/g)
}

func gcd(a, b int) int {
	for b != 0 {
		a, b = b, a%b
	}
	return a
}

func orientation(ratio string) string {
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return ""
	}
	a, _ := strconv.ParseFloat(parts[0], 64)
	b, _ := strconv.ParseFloat(parts[1], 64)
	switch {
	case a > b:
		return "横构图"
	case a < b:
		return "竖构图"
	default:
		return "方形构图"
	}
}

func buildPlan(ch *Channel, in JobIn, hasRefs bool) Plan {
	c := ch.Caps
	p := in.Params
	body := map[string]any{"model": in.Model}
	var phrases []string

	// 画幅：比例
	if p.Aspect != "" && p.Aspect != "auto" {
		switch c.Aspect.Mode {
		case "native":
			body["aspect_ratio"] = p.Aspect
		case "prompt":
			phrases = append(phrases, fmt.Sprintf("画面比例 %s，%s", p.Aspect, orientation(p.Aspect)))
		}
	}
	// 画幅：尺寸
	if p.Size != "" {
		switch c.Size.Mode {
		case "native":
			body["size"] = p.Size
		case "prompt":
			if p.Size != "auto" {
				var w, h int
				if _, err := fmt.Sscanf(p.Size, "%dx%d", &w, &h); err == nil && w > 0 && h > 0 {
					r := ratioOf(w, h)
					phrases = append(phrases, fmt.Sprintf("画面比例 %s，%s，约 %d×%d 像素", r, orientation(r), w, h))
				}
			}
		}
	}
	// 分辨率
	if p.Resolution != "" {
		switch c.Resolution.Mode {
		case "native":
			body["resolution"] = p.Resolution
		case "prompt":
			switch strings.ToLower(p.Resolution) {
			case "4k":
				phrases = append(phrases, "4K 超高分辨率，细节极其清晰")
			case "2k":
				phrases = append(phrases, "2K 高分辨率，细节清晰")
			case "1k":
				phrases = append(phrases, "1K 分辨率")
			default:
				phrases = append(phrases, p.Resolution+" 分辨率")
			}
		}
	}
	// 质量
	if p.Quality != "" {
		switch c.Quality.Mode {
		case "native":
			body["quality"] = p.Quality
		case "prompt":
			switch p.Quality {
			case "high", "xhigh", "max", "hd":
				phrases = append(phrases, "高画质，细节精致锐利，质感真实")
			case "medium", "standard":
				phrases = append(phrases, "画质精细，细节完整")
			case "low":
				phrases = append(phrases, "简洁画面")
			}
		}
	}
	// 背景
	if p.Background != "" && p.Background != "auto" {
		switch c.Background.Mode {
		case "native":
			body["background"] = p.Background
		case "prompt":
			if p.Background == "transparent" {
				phrases = append(phrases, "透明背景，主体独立无背景")
			} else if p.Background == "opaque" {
				phrases = append(phrases, "完整的不透明背景")
			}
		}
	} else if p.Background == "auto" && c.Background.Mode == "native" {
		body["background"] = "auto"
	}
	// 输出格式 / 压缩
	if p.Format != "" && c.Format.Mode == "native" {
		body["output_format"] = p.Format
		if c.Compression.Mode == "native" && p.Compression > 0 && p.Compression < 100 && (p.Format == "jpeg" || p.Format == "webp") {
			body["output_compression"] = p.Compression
		}
	}
	// 审核
	if p.Moderation != "" && c.Moderation.Mode == "native" {
		body["moderation"] = p.Moderation
	}
	// 返回方式
	if c.Response.Mode == "native" && len(c.Response.Values) > 0 && ch.APIType == "images" {
		body["response_format"] = c.Response.Values[0]
	}
	// 张数
	n := p.N
	if n < 1 {
		n = 1
	}
	if c.N.Max > 0 && n > c.N.Max {
		n = c.N.Max
	}
	calls := 1
	switch c.N.Mode {
	case "native":
		if n > 1 || ch.APIType == "images" {
			body["n"] = n
		}
	case "loop":
		calls = n
	}

	prompt := in.Prompt
	if len(phrases) > 0 {
		sep := "\n\n"
		prompt = strings.TrimRight(prompt, " \n。.，,") + "。" + sep + strings.Join(phrases, "，") + "。"
	}
	body["prompt"] = prompt

	plan := Plan{Prompt: prompt, Body: body, Calls: calls}
	refMode := c.Refs.Mode
	if refMode == "" {
		refMode = "multipart"
	}
	plan.RefMode = refMode
	if ch.APIType == "chat" {
		plan.Endpoint = "/chat/completions"
	} else if hasRefs && refMode != "off" {
		plan.Endpoint = "/images/edits"
		plan.Edit = true
	} else {
		plan.Endpoint = "/images/generations"
	}
	return plan
}

// ---------- 调用上游 ----------

var httpClient = &http.Client{Timeout: 7 * time.Minute}

func doCall(ctx context.Context, ch *Channel, plan Plan, refs []refFile) (*genResult, error) {
	endpoint := apiURL(ch.BaseURL, plan.Endpoint)
	var req *http.Request
	var err error
	switch {
	case ch.APIType == "chat":
		content := []any{map[string]any{"type": "text", "text": plan.Prompt}}
		for _, rf := range refs {
			content = append(content, map[string]any{"type": "image_url", "image_url": map[string]any{"url": dataURL(rf)}})
		}
		body := map[string]any{}
		for k, v := range plan.Body {
			if k != "prompt" {
				body[k] = v
			}
		}
		if len(refs) == 0 {
			body["messages"] = []any{map[string]any{"role": "user", "content": plan.Prompt}}
		} else {
			body["messages"] = []any{map[string]any{"role": "user", "content": content}}
		}
		body["stream"] = false
		b, _ := json.Marshal(body)
		req, err = http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
	case plan.Edit && plan.RefMode == "json":
		body := map[string]any{}
		for k, v := range plan.Body {
			body[k] = v
		}
		imgs := []any{}
		for _, rf := range refs {
			imgs = append(imgs, map[string]any{"image_url": dataURL(rf)})
		}
		body["images"] = imgs
		b, _ := json.Marshal(body)
		req, err = http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
	case plan.Edit:
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		for k, v := range plan.Body {
			_ = mw.WriteField(k, fmt.Sprint(v))
		}
		field := "image[]"
		if len(refs) == 1 {
			field = "image"
		}
		for _, rf := range refs {
			h := make(textproto.MIMEHeader)
			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, field, rf.Name))
			h.Set("Content-Type", rf.Mime)
			pw, _ := mw.CreatePart(h)
			_, _ = pw.Write(rf.Data)
		}
		_ = mw.Close()
		req, err = http.NewRequestWithContext(ctx, "POST", endpoint, &buf)
		if err == nil {
			req.Header.Set("Content-Type", mw.FormDataContentType())
		}
	default:
		b, _ := json.Marshal(plan.Body)
		req, err = http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(b))
		if err == nil {
			req.Header.Set("Content-Type", "application/json")
		}
	}
	if err != nil {
		return nil, err
	}
	if ch.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+ch.APIKey)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return nil, errors.New("请求超时")
		}
		return nil, errors.New("请求失败：" + shortErr(err))
	}
	defer resp.Body.Close()
	res := &genResult{toolPath: detectToolPath(resp.Header)}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 512<<20))
	if err != nil {
		return nil, errors.New("读取响应失败：" + shortErr(err))
	}
	if resp.StatusCode >= 300 {
		return res, fmt.Errorf("上游返回 %d：%s", resp.StatusCode, upstreamMsg(raw))
	}
	var refsOut []string
	if ch.APIType == "chat" {
		refsOut = parseChatImages(raw)
	} else {
		refsOut = parseImagesResponse(raw)
	}
	if len(refsOut) == 0 {
		return res, errors.New("响应里没有图片：" + upstreamMsg(raw))
	}
	for _, ref := range refsOut {
		data, err := fetchImage(ctx, ch, ref)
		if err != nil {
			log.Printf("下载图片失败: %v (%s)", err, logURL(ref))
			continue
		}
		res.images = append(res.images, data)
	}
	if len(res.images) == 0 {
		return res, errors.New("图片下载失败")
	}
	return res, nil
}

// detectToolPath 识别中转降级到「对话工具链路」的响应头
func detectToolPath(h http.Header) bool {
	for k, vs := range h {
		lk := strings.ToLower(k)
		if strings.HasSuffix(lk, "-image-path") {
			for _, v := range vs {
				if strings.Contains(strings.ToLower(v), "tool") {
					return true
				}
			}
		}
	}
	return false
}

func dataURL(rf refFile) string {
	return "data:" + rf.Mime + ";base64," + base64.StdEncoding.EncodeToString(rf.Data)
}

func parseImagesResponse(raw []byte) []string {
	var r struct {
		Data []struct {
			B64 string `json:"b64_json"`
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil
	}
	out := []string{}
	for _, d := range r.Data {
		if d.B64 != "" {
			out = append(out, "b64:"+d.B64)
		} else if d.URL != "" {
			out = append(out, d.URL)
		}
	}
	return out
}

var (
	mdImgRe   = regexp.MustCompile(`!\[[^\]]*\]\(([^)\s]+)\)`)
	dataURLRe = regexp.MustCompile(`data:image/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+`)
	urlRe     = regexp.MustCompile(`https?://[^\s)"'<>\]]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s)"'<>\]]*)?`)
)

func parseChatImages(raw []byte) []string {
	var r struct {
		Data    []json.RawMessage `json:"data"`
		Choices []struct {
			Message struct {
				Content any `json:"content"`
				Images  []struct {
					ImageURL struct {
						URL string `json:"url"`
					} `json:"image_url"`
				} `json:"images"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(raw, &r); err != nil {
		return nil
	}
	out := []string{}
	seen := map[string]bool{}
	add := func(s string) {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	for _, c := range r.Choices {
		for _, im := range c.Message.Images {
			add(im.ImageURL.URL)
		}
		text := ""
		switch v := c.Message.Content.(type) {
		case string:
			text = v
		case []any:
			for _, part := range v {
				if m, ok := part.(map[string]any); ok {
					if t, ok := m["text"].(string); ok {
						text += "\n" + t
					}
					if iu, ok := m["image_url"].(map[string]any); ok {
						if u, ok := iu["url"].(string); ok {
							add(u)
						}
					}
				}
			}
		}
		for _, m := range mdImgRe.FindAllStringSubmatch(text, -1) {
			add(m[1])
		}
		for _, m := range dataURLRe.FindAllString(text, -1) {
			add(m)
		}
		if len(out) == 0 {
			for _, m := range urlRe.FindAllString(text, -1) {
				add(m)
			}
		}
	}
	if len(out) == 0 && len(r.Data) > 0 {
		out = parseImagesResponse(raw)
	}
	return out
}

func fetchImage(ctx context.Context, ch *Channel, ref string) ([]byte, error) {
	if strings.HasPrefix(ref, "b64:") {
		return decodeB64(strings.TrimPrefix(ref, "b64:"))
	}
	if strings.HasPrefix(ref, "data:") {
		if i := strings.Index(ref, ","); i > 0 {
			return decodeB64(ref[i+1:])
		}
		return nil, errors.New("无效的 data URL")
	}
	u := ref
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		base, err := url.Parse(normBase(ch.BaseURL))
		if err != nil {
			return nil, err
		}
		rel, err := url.Parse(u)
		if err != nil {
			return nil, err
		}
		u = base.ResolveReference(rel).String()
	}
	var lastErr error
	withAuth := false
	for attempt := 0; attempt < 4; attempt++ {
		req, _ := http.NewRequestWithContext(ctx, "GET", u, nil)
		if withAuth && ch.APIKey != "" {
			req.Header.Set("Authorization", "Bearer "+ch.APIKey)
		}
		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = err
			time.Sleep(time.Second)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 200<<20))
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			lastErr = fmt.Errorf("下载图片 HTTP %d", resp.StatusCode)
			if !withAuth && sameHost(u, ch.BaseURL) {
				withAuth = true
				continue
			}
			break
		}
		if resp.StatusCode >= 300 {
			lastErr = fmt.Errorf("下载图片 HTTP %d", resp.StatusCode)
			time.Sleep(time.Second)
			continue
		}
		return data, nil
	}
	return nil, lastErr
}

func sameHost(a, b string) bool {
	ua, e1 := url.Parse(a)
	ub, e2 := url.Parse(b)
	return e1 == nil && e2 == nil && ua.Host == ub.Host
}

func decodeB64(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	if d, err := base64.StdEncoding.DecodeString(s); err == nil {
		return d, nil
	}
	return base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
}

// ---------- 查询 ----------

type JobOut struct {
	ID          int64           `json:"id"`
	Kind        string          `json:"kind"`
	GroupID     string          `json:"group_id"`
	Slot        int             `json:"slot"`
	ChannelID   int64           `json:"channel_id"`
	ChannelName string          `json:"channel_name"`
	APIType     string          `json:"api_type"`
	Model       string          `json:"model"`
	Prompt      string          `json:"prompt"`
	Params      json.RawMessage `json:"params"`
	Refs        json.RawMessage `json:"refs"`
	SentPrompt  string          `json:"sent_prompt"`
	Endpoint    string          `json:"endpoint"`
	Status      string          `json:"status"`
	Error       string          `json:"error"`
	ToolPath    bool            `json:"tool_path"`
	StartedAt   int64           `json:"started_at"`
	FinishedAt  int64           `json:"finished_at"`
	DurationMS  int64           `json:"duration_ms"`
	CreatedAt   int64           `json:"created_at"`
	Images      []*ImageOut     `json:"images"`
	UserID      int64           `json:"user_id"`
}

const jobCols = `id,kind,group_id,slot,channel_id,channel_name,api_type,model,prompt,params,refs,sent_prompt,endpoint,status,error,tool_path,started_at,finished_at,duration_ms,created_at,user_id`

func scanJob(sc interface{ Scan(...any) error }) (*JobOut, error) {
	var j JobOut
	var params, refs string
	var tp int
	if err := sc.Scan(&j.ID, &j.Kind, &j.GroupID, &j.Slot, &j.ChannelID, &j.ChannelName, &j.APIType, &j.Model, &j.Prompt, &params, &refs, &j.SentPrompt, &j.Endpoint, &j.Status, &j.Error, &tp, &j.StartedAt, &j.FinishedAt, &j.DurationMS, &j.CreatedAt, &j.UserID); err != nil {
		return nil, err
	}
	j.Params = json.RawMessage(params)
	j.Refs = json.RawMessage(refs)
	j.ToolPath = tp == 1
	j.Images = []*ImageOut{}
	return &j, nil
}

func loadJob(id int64) (*JobOut, error) {
	j, err := scanJob(db.QueryRow(`SELECT `+jobCols+` FROM jobs WHERE id=?`, id))
	if err != nil {
		return nil, err
	}
	imgs, _ := queryImages(`WHERE i.job_id=? ORDER BY i.id`, id)
	j.Images = imgs
	return j, nil
}

func queryJobs(where string, args ...any) ([]*JobOut, error) {
	rows, err := db.Query(`SELECT `+jobCols+` FROM jobs `+where, args...)
	if err != nil {
		return nil, err
	}
	var out []*JobOut
	for rows.Next() {
		j, err := scanJob(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, j)
	}
	rows.Close()
	if out == nil {
		out = []*JobOut{}
	}
	for _, j := range out {
		imgs, _ := queryImages(`WHERE i.job_id=? ORDER BY i.id`, j.ID)
		j.Images = imgs
	}
	return out, nil
}

// sanitizeJob 普通用户看不到渠道名称、接口地址；错误里的上游地址去掉
func sanitizeJob(u *User, j *JobOut) {
	if j == nil || u.IsAdmin() {
		return
	}
	j.ChannelName = ""
	j.Endpoint = ""
	j.Error = scrubForUser(j.Error)
	sanitizeImages(u, j.Images)
}

// GET /api/jobs?limit=8  自己最近的单图任务（含进行中），用于「本次」区域，刷新不丢
func handleJobList(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 50 {
		limit = 8
	}
	u := cur(r)
	jobs, err := queryJobs(`WHERE kind='single' AND user_id=? ORDER BY id DESC LIMIT ?`, u.ID, limit)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	for _, j := range jobs {
		sanitizeJob(u, j)
	}
	writeJSON(w, map[string]any{"jobs": jobs, "server_now": now(), "quota": quotaInfo(u)})
}

func ownedJob(r *http.Request) (*JobOut, bool) {
	j, err := loadJob(pathID(r))
	if err != nil {
		return nil, false
	}
	u := cur(r)
	if !u.IsAdmin() && j.UserID != u.ID {
		return nil, false
	}
	sanitizeJob(u, j)
	return j, true
}

func handleJobGet(w http.ResponseWriter, r *http.Request) {
	j, ok := ownedJob(r)
	if !ok {
		httpErr(w, 404, "任务不存在")
		return
	}
	writeJSON(w, j)
}

// 删除任务记录（不删已收藏的图）
func handleJobDelete(w http.ResponseWriter, r *http.Request) {
	if _, ok := ownedJob(r); !ok {
		httpErr(w, 404, "任务不存在")
		return
	}
	id := pathID(r)
	imgs, _ := queryImages(`WHERE i.job_id=? AND i.favorite=0`, id)
	for _, im := range imgs {
		deleteImage(im.ID)
	}
	var left int
	_ = db.QueryRow(`SELECT COUNT(*) FROM images WHERE job_id=?`, id).Scan(&left)
	if left == 0 {
		_, _ = db.Exec(`DELETE FROM jobs WHERE id=?`, id)
	} else {
		_, _ = db.Exec(`UPDATE jobs SET kind='archived' WHERE id=?`, id)
	}
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 对比 ----------

type compareIn struct {
	Prompt string  `json:"prompt"`
	Refs   []int64 `json:"refs"`
	Combos []struct {
		ChannelID int64  `json:"channel_id"`
		Model     string `json:"model"`
		Params    Params `json:"params"`
	} `json:"combos"`
}

var compareMu sync.Mutex

func handleCompareCreate(w http.ResponseWriter, r *http.Request) {
	var in compareIn
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if len(in.Combos) == 0 || len(in.Combos) > 4 {
		httpErr(w, 400, "请选择 1–4 个组合")
		return
	}
	if strings.TrimSpace(in.Prompt) == "" {
		httpErr(w, 400, "提示词不能为空")
		return
	}
	if q := quotaInfo(cur(r)); !q.Unlimited && q.Remaining < len(in.Combos) {
		httpErr(w, 400, fmt.Sprintf("额度不足，今天还能生成 %d 张", q.Remaining))
		return
	}
	compareMu.Lock()
	defer compareMu.Unlock()
	gid := newGroupID()
	for i, c := range in.Combos {
		p := c.Params
		p.N = 1
		if _, err := createJob(cur(r), JobIn{ChannelID: c.ChannelID, Model: c.Model, Prompt: in.Prompt, Params: p, Refs: in.Refs}, "compare", gid, i); err != nil {
			httpErr(w, 400, fmt.Sprintf("组合 %d：%s", i+1, err.Error()))
			return
		}
	}
	writeJSON(w, map[string]any{"group_id": gid})
}

func handleCompareGet(w http.ResponseWriter, r *http.Request) {
	u := cur(r)
	q := `WHERE group_id=? AND user_id=? ORDER BY slot`
	args := []any{r.PathValue("gid"), u.ID}
	if u.IsAdmin() {
		q, args = `WHERE group_id=? ORDER BY slot`, args[:1]
	}
	jobs, err := queryJobs(q, args...)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	for _, j := range jobs {
		sanitizeJob(u, j)
	}
	writeJSON(w, map[string]any{"group_id": r.PathValue("gid"), "jobs": jobs, "server_now": now()})
}

func handleCompareList(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT group_id, MIN(prompt), COUNT(*), MIN(created_at) FROM jobs WHERE kind='compare' AND group_id<>'' AND user_id=? GROUP BY group_id ORDER BY MIN(id) DESC LIMIT 20`, cur(r).ID)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	type g struct {
		GroupID   string `json:"group_id"`
		Prompt    string `json:"prompt"`
		Count     int    `json:"count"`
		CreatedAt int64  `json:"created_at"`
	}
	out := []g{}
	for rows.Next() {
		var x g
		if rows.Scan(&x.GroupID, &x.Prompt, &x.Count, &x.CreatedAt) == nil {
			out = append(out, x)
		}
	}
	writeJSON(w, out)
}

func logURL(ref string) string {
	if len(ref) > 120 {
		return ref[:120]
	}
	return ref
}

// isRetryable 上游 5xx 偶发错误自动重试一次
func isRetryable(err error) bool {
	m := err.Error()
	return strings.HasPrefix(m, "上游返回 5") || strings.HasPrefix(m, "请求失败")
}
