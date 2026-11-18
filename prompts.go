package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type PromptItem struct {
	ID         int64    `json:"id"`
	Title      string   `json:"title"`
	Content    string   `json:"content"`
	IsTemplate bool     `json:"is_template"`
	Tags       []string `json:"tags"`
	Pinned     bool     `json:"pinned"`
	UseCount   int      `json:"use_count"`
	CreatedAt  int64    `json:"created_at"`
	UpdatedAt  int64    `json:"updated_at"`
	UserID     int64    `json:"user_id,omitempty"`
	Owner      string   `json:"owner,omitempty"` // 仅管理员查看他人提示词时返回
}

var varRe = regexp.MustCompile(`\{[^{}\s]{1,16}\}`)

func listPrompts(uid int64) ([]PromptItem, error) { return queryPrompts(`p.user_id=?`, uid) }

// queryPrompts where 为空时返回所有用户的提示词（仅管理员）
func queryPrompts(where string, args ...any) ([]PromptItem, error) {
	q := `SELECT p.id,p.title,p.content,p.is_template,p.tags,p.pinned,p.use_count,p.created_at,p.updated_at,p.user_id,COALESCE(NULLIF(u.nickname,''),u.username,'') FROM prompts p LEFT JOIN users u ON u.id=p.user_id`
	if where != "" {
		q += ` WHERE ` + where
	}
	rows, err := db.Query(q+` ORDER BY p.pinned DESC, p.use_count DESC, p.updated_at DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PromptItem{}
	for rows.Next() {
		var p PromptItem
		var it, pin int
		var tags string
		if err := rows.Scan(&p.ID, &p.Title, &p.Content, &it, &tags, &pin, &p.UseCount, &p.CreatedAt, &p.UpdatedAt, &p.UserID, &p.Owner); err != nil {
			return nil, err
		}
		p.IsTemplate, p.Pinned = it == 1, pin == 1
		_ = json.Unmarshal([]byte(tags), &p.Tags)
		if p.Tags == nil {
			p.Tags = []string{}
		}
		out = append(out, p)
	}
	return out, nil
}

func handlePromptList(w http.ResponseWriter, r *http.Request) {
	u := cur(r)
	var ps []PromptItem
	var err error
	scope := r.URL.Query().Get("user")
	switch id, _ := strconv.ParseInt(scope, 10, 64); {
	case !u.IsAdmin() || scope == "" || scope == "me":
		ps, err = listPrompts(u.ID)
		for i := range ps {
			ps[i].Owner = ""
		}
	case scope == "all":
		ps, err = queryPrompts("")
	default:
		ps, err = queryPrompts(`p.user_id=?`, id)
	}
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	writeJSON(w, ps)
}

func cleanTags(in []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, t := range in {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			out = append(out, t)
		}
	}
	return out
}

func savePrompt(uid, id int64, p PromptItem) (int64, error) {
	p.Title = strings.TrimSpace(p.Title)
	p.Content = strings.TrimSpace(p.Content)
	if p.Title == "" {
		r := []rune(p.Content)
		if len(r) > 18 {
			r = r[:18]
		}
		p.Title = string(r)
	}
	if !p.IsTemplate && varRe.MatchString(p.Content) {
		p.IsTemplate = true
	}
	t := now()
	if id == 0 {
		res, err := db.Exec(`INSERT INTO prompts(title,content,is_template,tags,pinned,use_count,created_at,updated_at,user_id) VALUES(?,?,?,?,?,?,?,?,?)`,
			p.Title, p.Content, b2i(p.IsTemplate), mustJSON(cleanTags(p.Tags)), b2i(p.Pinned), p.UseCount, t, t, uid)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	res, err := db.Exec(`UPDATE prompts SET title=?,content=?,is_template=?,tags=?,pinned=?,updated_at=? WHERE id=? AND user_id=?`,
		p.Title, p.Content, b2i(p.IsTemplate), mustJSON(cleanTags(p.Tags)), b2i(p.Pinned), t, id, uid)
	if err == nil {
		if n, _ := res.RowsAffected(); n == 0 {
			return 0, errors.New("提示词不存在")
		}
	}
	return id, err
}

func handlePromptSave(w http.ResponseWriter, r *http.Request) {
	var p PromptItem
	if err := readJSON(r, &p); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if strings.TrimSpace(p.Content) == "" {
		httpErr(w, 400, "内容不能为空")
		return
	}
	id, err := savePrompt(cur(r).ID, pathID(r), p)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"id": id})
}

func handlePromptDelete(w http.ResponseWriter, r *http.Request) {
	if u := cur(r); u.IsAdmin() {
		_, _ = db.Exec(`DELETE FROM prompts WHERE id=?`, pathID(r)) // 管理员可删除任何人的提示词
	} else {
		_, _ = db.Exec(`DELETE FROM prompts WHERE id=? AND user_id=?`, pathID(r), u.ID)
	}
	writeJSON(w, map[string]any{"ok": true})
}

func handlePromptUse(w http.ResponseWriter, r *http.Request) {
	_, _ = db.Exec(`UPDATE prompts SET use_count=use_count+1 WHERE id=? AND user_id=?`, pathID(r), cur(r).ID)
	writeJSON(w, map[string]any{"ok": true})
}

func handlePromptExport(w http.ResponseWriter, r *http.Request) {
	ps, err := listPrompts(cur(r).ID)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	for i := range ps {
		ps[i].UserID, ps[i].Owner = 0, ""
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="prompts-`+time.Now().Format("20060102")+`.json"`)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(map[string]any{"app": "image-studio", "version": 1, "prompts": ps})
}

func handlePromptImport(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Prompts []PromptItem `json:"prompts"`
	}
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	existing, _ := listPrompts(cur(r).ID)
	have := map[string]bool{}
	for _, p := range existing {
		have[p.Content] = true
	}
	added := 0
	for _, p := range in.Prompts {
		if strings.TrimSpace(p.Content) == "" || have[strings.TrimSpace(p.Content)] {
			continue
		}
		if _, err := savePrompt(cur(r).ID, 0, p); err == nil {
			added++
			have[strings.TrimSpace(p.Content)] = true
		}
	}
	writeJSON(w, map[string]any{"added": added, "skipped": len(in.Prompts) - added})
}
