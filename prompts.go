package main

import (
	"encoding/json"
	"net/http"
	"regexp"
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
}

var varRe = regexp.MustCompile(`\{[^{}\s]{1,16}\}`)

func listPrompts() ([]PromptItem, error) {
	rows, err := db.Query(`SELECT id,title,content,is_template,tags,pinned,use_count,created_at,updated_at FROM prompts ORDER BY pinned DESC, use_count DESC, updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PromptItem{}
	for rows.Next() {
		var p PromptItem
		var it, pin int
		var tags string
		if err := rows.Scan(&p.ID, &p.Title, &p.Content, &it, &tags, &pin, &p.UseCount, &p.CreatedAt, &p.UpdatedAt); err != nil {
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
	ps, err := listPrompts()
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

func savePrompt(id int64, p PromptItem) (int64, error) {
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
		res, err := db.Exec(`INSERT INTO prompts(title,content,is_template,tags,pinned,use_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`,
			p.Title, p.Content, b2i(p.IsTemplate), mustJSON(cleanTags(p.Tags)), b2i(p.Pinned), p.UseCount, t, t)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := db.Exec(`UPDATE prompts SET title=?,content=?,is_template=?,tags=?,pinned=?,updated_at=? WHERE id=?`,
		p.Title, p.Content, b2i(p.IsTemplate), mustJSON(cleanTags(p.Tags)), b2i(p.Pinned), t, id)
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
	id, err := savePrompt(pathID(r), p)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	writeJSON(w, map[string]any{"id": id})
}

func handlePromptDelete(w http.ResponseWriter, r *http.Request) {
	_, _ = db.Exec(`DELETE FROM prompts WHERE id=?`, pathID(r))
	writeJSON(w, map[string]any{"ok": true})
}

func handlePromptUse(w http.ResponseWriter, r *http.Request) {
	_, _ = db.Exec(`UPDATE prompts SET use_count=use_count+1 WHERE id=?`, pathID(r))
	writeJSON(w, map[string]any{"ok": true})
}

func handlePromptExport(w http.ResponseWriter, r *http.Request) {
	ps, err := listPrompts()
	if err != nil {
		httpErr(w, 500, err.Error())
		return
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
	existing, _ := listPrompts()
	have := map[string]bool{}
	for _, p := range existing {
		have[p.Content] = true
	}
	added := 0
	for _, p := range in.Prompts {
		if strings.TrimSpace(p.Content) == "" || have[strings.TrimSpace(p.Content)] {
			continue
		}
		if _, err := savePrompt(0, p); err == nil {
			added++
			have[strings.TrimSpace(p.Content)] = true
		}
	}
	writeJSON(w, map[string]any{"added": added, "skipped": len(in.Prompts) - added})
}
