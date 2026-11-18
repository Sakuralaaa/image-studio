package main

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---------- 用户 ----------

type User struct {
	ID            int64    `json:"id"`
	Username      string   `json:"username"`
	Nickname      string   `json:"nickname"`
	Role          string   `json:"role"` // admin / user
	Disabled      bool     `json:"disabled"`
	NSFW          bool     `json:"nsfw"`           // 允许查看 NSFW 提示词（管理员恒为 true）
	DailyQuota    int      `json:"daily_quota"`    // -1 跟随默认；0 不限；>0 每日张数
	Bonus         int      `json:"bonus"`          // 额外额度（每日额度用完后扣）
	AllowedModels []string `json:"allowed_models"` // 空 = 全部开放模型
	MaxConcurrent int      `json:"max_concurrent"` // 0 跟随默认
	TokenVer      int      `json:"-"`
	PassHash      string   `json:"-"`
	CreatedAt     int64    `json:"created_at"`
	LastLoginAt   int64    `json:"last_login_at"`
}

func (u *User) IsAdmin() bool { return u != nil && u.Role == "admin" }

const userSchema = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nickname TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  disabled INTEGER NOT NULL DEFAULT 0,
  nsfw INTEGER NOT NULL DEFAULT 0,
  daily_quota INTEGER NOT NULL DEFAULT -1,
  bonus INTEGER NOT NULL DEFAULT 0,
  allowed_models TEXT NOT NULL DEFAULT '[]',
  max_concurrent INTEGER NOT NULL DEFAULT 0,
  token_ver INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS usage_daily (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used INTEGER NOT NULL DEFAULT 0,
  daily_quota INTEGER NOT NULL DEFAULT -1,
  bonus INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS market_user_favs (
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
);
`

// migrateUsers 建表、给旧表补 user_id 列、把单用户时代的数据归到第一个管理员
func migrateUsers() error {
	if _, err := db.Exec(userSchema); err != nil {
		return fmt.Errorf("users schema: %w", err)
	}
	addCol := func(table, col, def string) {
		var n int
		_ = db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info(?) WHERE name=?`, table, col).Scan(&n)
		if n == 0 {
			if _, err := db.Exec(fmt.Sprintf(`ALTER TABLE %s ADD COLUMN %s %s`, table, col, def)); err != nil {
				log.Printf("迁移 %s.%s 失败：%v", table, col, err)
			}
		}
	}
	addCol("jobs", "user_id", "INTEGER NOT NULL DEFAULT 0")
	addCol("jobs", "quota_daily", "INTEGER NOT NULL DEFAULT 0")
	addCol("jobs", "quota_bonus", "INTEGER NOT NULL DEFAULT 0")
	addCol("jobs", "quota_day", "TEXT NOT NULL DEFAULT ''")
	addCol("images", "user_id", "INTEGER NOT NULL DEFAULT 0")
	addCol("refs", "user_id", "INTEGER NOT NULL DEFAULT 0")
	addCol("prompts", "user_id", "INTEGER NOT NULL DEFAULT 0")
	addCol("channels", "hidden", "INTEGER NOT NULL DEFAULT 0")
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS images_user ON images(user_id)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user_id)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS images_file ON images(file)`)
	_, _ = db.Exec(`CREATE INDEX IF NOT EXISTS refs_file ON refs(file)`)

	// 管理员账号：没有任何管理员时用 ADMIN_USERNAME / ADMIN_PASSWORD 创建
	var admins int
	_ = db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin'`).Scan(&admins)
	if admins == 0 {
		name := env("ADMIN_USERNAME", "admin")
		pw := adminPass
		if pw == "" {
			b := make([]byte, 9)
			_, _ = rand.Read(b)
			pw = hex.EncodeToString(b)
			log.Printf("未设置 ADMIN_PASSWORD，已生成管理员 %s 的临时密码：%s（登录后请修改）", name, pw)
		}
		if _, err := db.Exec(`INSERT INTO users(username,nickname,pass_hash,role,nsfw,daily_quota,created_at) VALUES(?,?,?,'admin',1,0,?)`, name, "管理员", hashPassword(pw), now()); err != nil {
			return fmt.Errorf("创建管理员：%w", err)
		}
	}
	var firstAdmin int64
	_ = db.QueryRow(`SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1`).Scan(&firstAdmin)
	for _, t := range []string{"jobs", "images", "refs", "prompts"} {
		_, _ = db.Exec(fmt.Sprintf(`UPDATE %s SET user_id=? WHERE user_id=0`, t), firstAdmin)
	}
	_, _ = db.Exec(`UPDATE images SET user_id=(SELECT j.user_id FROM jobs j WHERE j.id=images.job_id) WHERE EXISTS (SELECT 1 FROM jobs j WHERE j.id=images.job_id AND j.user_id<>images.user_id)`)
	// 旧的全局提示词收藏迁到第一个管理员
	var hasOld int
	_ = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='market_favs'`).Scan(&hasOld)
	if hasOld > 0 {
		_, _ = db.Exec(`INSERT OR IGNORE INTO market_user_favs(user_id,id,data,created_at) SELECT ?,id,data,created_at FROM market_favs`, firstAdmin)
		_, _ = db.Exec(`DROP TABLE market_favs`)
	}
	// 旧的保留天数 → 小时
	if v := getSetting("retention_days", ""); v != "" && getSetting("retention_hours", "") == "" {
		d, _ := strconv.Atoi(v)
		_ = setSetting("retention_hours", strconv.Itoa(d*24))
	}
	return nil
}

// ---------- 密码 ----------

func hashPassword(pw string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	key, _ := pbkdf2.Key(sha256.New, pw, salt, 120000, 32)
	return "pbkdf2$120000$" + hex.EncodeToString(salt) + "$" + hex.EncodeToString(key)
}

func checkPassword(hash, pw string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	iter, _ := strconv.Atoi(parts[1])
	salt, err1 := hex.DecodeString(parts[2])
	want, err2 := hex.DecodeString(parts[3])
	if err1 != nil || err2 != nil || iter <= 0 {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, pw, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// ---------- 读写 ----------

const userCols = `id,username,nickname,pass_hash,role,disabled,nsfw,daily_quota,bonus,allowed_models,max_concurrent,token_ver,created_at,last_login_at`

func scanUser(sc interface{ Scan(...any) error }) (*User, error) {
	var u User
	var dis, nsfw int
	var am string
	if err := sc.Scan(&u.ID, &u.Username, &u.Nickname, &u.PassHash, &u.Role, &dis, &nsfw, &u.DailyQuota, &u.Bonus, &am, &u.MaxConcurrent, &u.TokenVer, &u.CreatedAt, &u.LastLoginAt); err != nil {
		return nil, err
	}
	u.Disabled = dis == 1
	u.NSFW = false // 普通用户一律不能看 NSFW，只有管理员可以
	_ = json.Unmarshal([]byte(am), &u.AllowedModels)
	if u.AllowedModels == nil {
		u.AllowedModels = []string{}
	}
	if u.IsAdmin() {
		u.NSFW = true
	}
	return &u, nil
}

func getUser(id int64) (*User, error) {
	return scanUser(db.QueryRow(`SELECT `+userCols+` FROM users WHERE id=?`, id))
}

func getUserByName(name string) (*User, error) {
	return scanUser(db.QueryRow(`SELECT `+userCols+` FROM users WHERE username=?`, name))
}

func displayName(u *User) string {
	if u.Nickname != "" {
		return u.Nickname
	}
	return u.Username
}

// ---------- 会话 ----------

type ctxKey struct{}

func cur(r *http.Request) *User {
	u, _ := r.Context().Value(ctxKey{}).(*User)
	return u
}

func signToken(uid int64, ver int, exp int64) string {
	msg := fmt.Sprintf("%d.%d.%d", uid, ver, exp)
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(msg))
	return msg + "." + hex.EncodeToString(h.Sum(nil))
}

func sessionUser(r *http.Request) *User {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 4 {
		return nil
	}
	uid, _ := strconv.ParseInt(parts[0], 10, 64)
	ver, _ := strconv.Atoi(parts[1])
	exp, _ := strconv.ParseInt(parts[2], 10, 64)
	if exp < time.Now().Unix() || !hmac.Equal([]byte(signToken(uid, ver, exp)), []byte(c.Value)) {
		return nil
	}
	u, err := getUser(uid)
	if err != nil || u.Disabled || u.TokenVer != ver {
		return nil
	}
	return u
}

func setSession(w http.ResponseWriter, r *http.Request, u *User) {
	exp := time.Now().Add(30 * 24 * time.Hour).Unix()
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: signToken(u.ID, u.TokenVer, exp), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Unix(exp, 0), Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"})
}

func auth(h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := sessionUser(r)
		if u == nil {
			httpErr(w, 401, "请先登录")
			return
		}
		h(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func adminOnly(h http.HandlerFunc) http.Handler {
	return auth(func(w http.ResponseWriter, r *http.Request) {
		if !cur(r).IsAdmin() {
			httpErr(w, 403, "没有权限")
			return
		}
		h(w, r)
	})
}

// 简单的登录失败限速：同一 IP 15 分钟内失败 10 次后锁定
var (
	loginMu    sync.Mutex
	loginFails = map[string][]time.Time{}
)

func clientIP(r *http.Request) string {
	if v := r.Header.Get("X-Forwarded-For"); v != "" {
		return strings.TrimSpace(strings.Split(v, ",")[0])
	}
	if v := r.Header.Get("X-Real-IP"); v != "" {
		return v
	}
	h, _, _ := net.SplitHostPort(r.RemoteAddr)
	return h
}

func loginBlocked(ip string) bool {
	loginMu.Lock()
	defer loginMu.Unlock()
	cut := time.Now().Add(-15 * time.Minute)
	var keep []time.Time
	for _, t := range loginFails[ip] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	loginFails[ip] = keep
	return len(keep) >= 10
}

func loginFail(ip string) {
	loginMu.Lock()
	loginFails[ip] = append(loginFails[ip], time.Now())
	loginMu.Unlock()
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpErr(w, 400, "请求格式错误")
		return
	}
	ip := clientIP(r)
	if loginBlocked(ip) {
		httpErr(w, 429, "尝试次数过多，请 15 分钟后再试")
		return
	}
	name := strings.TrimSpace(body.Username)
	u, err := getUserByName(name)
	ok := err == nil && checkPassword(u.PassHash, body.Password)
	// 救援：管理员账号始终接受环境变量里的 ADMIN_PASSWORD
	if !ok && err == nil && u.IsAdmin() && adminPass != "" && subtle.ConstantTimeCompare([]byte(body.Password), []byte(adminPass)) == 1 {
		ok = true
	}
	if !ok {
		loginFail(ip)
		time.Sleep(500 * time.Millisecond)
		httpErr(w, 401, "用户名或密码不正确")
		return
	}
	if u.Disabled {
		httpErr(w, 403, "账号已停用")
		return
	}
	_, _ = db.Exec(`UPDATE users SET last_login_at=? WHERE id=?`, now(), u.ID)
	setSession(w, r, u)
	writeJSON(w, map[string]any{"ok": true})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, map[string]any{"ok": true})
}

var usernameRe = regexp.MustCompile(`^[\p{L}\p{N}_.-]{2,32}$`)

func validateNewUser(name, pw string) error {
	if !usernameRe.MatchString(name) {
		return errors.New("用户名 2–32 位，可用字母、数字、中文、下划线、点和短横线")
	}
	if len([]rune(pw)) < 6 {
		return errors.New("密码至少 6 位")
	}
	return nil
}

func createUser(name, nick, pw, role string, quota, bonus int) (int64, error) {
	if err := validateNewUser(name, pw); err != nil {
		return 0, err
	}
	if role != "admin" {
		role = "user"
	}
	res, err := db.Exec(`INSERT INTO users(username,nickname,pass_hash,role,nsfw,daily_quota,bonus,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		name, strings.TrimSpace(nick), hashPassword(pw), role, b2i(role == "admin"), quota, bonus, now())
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			return 0, errors.New("用户名已被占用")
		}
		return 0, err
	}
	return res.LastInsertId()
}

// POST /api/register {username,password,invite}
func handleRegister(w http.ResponseWriter, r *http.Request) {
	var in struct{ Username, Password, Nickname, Invite string }
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	mode := getSetting("register_mode", "closed")
	if mode == "closed" {
		httpErr(w, 403, "暂未开放注册")
		return
	}
	ip := clientIP(r)
	if loginBlocked(ip) {
		httpErr(w, 429, "尝试次数过多，请稍后再试")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if err := validateNewUser(in.Username, in.Password); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	quota, bonus := -1, 0
	code := strings.ToUpper(strings.TrimSpace(in.Invite))
	if mode == "invite" {
		var maxUses, used int
		var exp int64
		err := db.QueryRow(`SELECT max_uses,used,daily_quota,bonus,expires_at FROM invites WHERE code=?`, code).Scan(&maxUses, &used, &quota, &bonus, &exp)
		if err != nil || (maxUses > 0 && used >= maxUses) || (exp > 0 && exp < now()) {
			loginFail(ip)
			httpErr(w, 400, "邀请码无效或已用完")
			return
		}
	}
	id, err := createUser(in.Username, in.Nickname, in.Password, "user", quota, bonus)
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if mode == "invite" {
		_, _ = db.Exec(`UPDATE invites SET used=used+1 WHERE code=?`, code)
	}
	u, _ := getUser(id)
	_, _ = db.Exec(`UPDATE users SET last_login_at=? WHERE id=?`, now(), id)
	setSession(w, r, u)
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 额度 ----------

// 额度按北京时间零点刷新，与服务器时区无关
var quotaLoc = func() *time.Location {
	if l, err := time.LoadLocation("Asia/Shanghai"); err == nil {
		return l
	}
	return time.FixedZone("CST", 8*3600)
}()

func today() string { return time.Now().In(quotaLoc).Format("2006-01-02") }

func defaultQuota() int {
	v, _ := strconv.Atoi(getSetting("default_quota", "20"))
	return v
}

func defaultConcurrent() int {
	v, _ := strconv.Atoi(getSetting("default_concurrent", "2"))
	if v <= 0 {
		v = 2
	}
	return v
}

// effectiveQuota 0 表示不限
func effectiveQuota(u *User) int {
	if u.IsAdmin() {
		return 0
	}
	if u.DailyQuota >= 0 {
		return u.DailyQuota
	}
	return defaultQuota()
}

func usedToday(uid int64) int {
	var n int
	_ = db.QueryRow(`SELECT used FROM usage_daily WHERE user_id=? AND day=?`, uid, today()).Scan(&n)
	return n
}

type QuotaInfo struct {
	Limit     int  `json:"limit"` // 0 不限
	Used      int  `json:"used"`
	Bonus     int  `json:"bonus"`
	Remaining int  `json:"remaining"` // 不限时为 -1
	Unlimited bool `json:"unlimited"`
}

func quotaInfo(u *User) QuotaInfo {
	q := QuotaInfo{Limit: effectiveQuota(u), Used: usedToday(u.ID), Bonus: u.Bonus}
	if q.Limit == 0 {
		q.Unlimited, q.Remaining = true, -1
		return q
	}
	left := q.Limit - q.Used
	if left < 0 {
		left = 0
	}
	q.Remaining = left + q.Bonus
	return q
}

var quotaMu sync.Mutex

type reservation struct {
	day          string
	daily, bonus int
}

// reserveQuota 在创建任务时预扣张数；失败的张数在任务结束时退回
func reserveQuota(u *User, n int, checkConc bool) (reservation, error) {
	quotaMu.Lock()
	defer quotaMu.Unlock()
	fresh, err := getUser(u.ID)
	if err != nil {
		return reservation{}, err
	}
	// 并发限制
	limit := fresh.MaxConcurrent
	if limit <= 0 {
		limit = defaultConcurrent()
	}
	if !fresh.IsAdmin() && checkConc {
		// 一次对比算一个任务
		var running int
		_ = db.QueryRow(`SELECT COUNT(DISTINCT CASE WHEN group_id<>'' THEN group_id ELSE 'j'||id END) FROM jobs WHERE user_id=? AND status IN ('queued','running')`, u.ID).Scan(&running)
		if running >= limit {
			return reservation{}, fmt.Errorf("同时最多进行 %d 个任务，请等当前任务完成", limit)
		}
	}
	day := today()
	res := reservation{day: day}
	q := effectiveQuota(fresh)
	used := usedToday(u.ID)
	if q > 0 {
		left := q - used
		if left < 0 {
			left = 0
		}
		if left+fresh.Bonus < n {
			if left+fresh.Bonus == 0 {
				return reservation{}, errors.New("今日额度已用完")
			}
			return reservation{}, fmt.Errorf("额度不足，今天还能生成 %d 张", left+fresh.Bonus)
		}
		res.daily = min(left, n)
		res.bonus = n - res.daily
	} else {
		res.daily = n
	}
	_, _ = db.Exec(`INSERT INTO usage_daily(user_id,day,used) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET used=used+excluded.used`, u.ID, day, res.daily)
	if res.bonus > 0 {
		_, _ = db.Exec(`UPDATE users SET bonus=bonus-? WHERE id=?`, res.bonus, u.ID)
	}
	return res, nil
}

// refundQuota 退回没有生成出来的张数（先退额外额度）
func refundQuota(jobID int64, failed int) {
	if failed <= 0 {
		return
	}
	quotaMu.Lock()
	defer quotaMu.Unlock()
	var uid int64
	var daily, bonus int
	var day string
	if db.QueryRow(`SELECT user_id,quota_daily,quota_bonus,quota_day FROM jobs WHERE id=?`, jobID).Scan(&uid, &daily, &bonus, &day) != nil {
		return
	}
	rb := min(bonus, failed)
	rd := min(daily, failed-rb)
	if rb > 0 {
		_, _ = db.Exec(`UPDATE users SET bonus=bonus+? WHERE id=?`, rb, uid)
	}
	if rd > 0 && day != "" {
		_, _ = db.Exec(`UPDATE usage_daily SET used=MAX(0,used-?) WHERE user_id=? AND day=?`, rd, uid, day)
	}
	_, _ = db.Exec(`UPDATE jobs SET quota_daily=quota_daily-?, quota_bonus=quota_bonus-? WHERE id=?`, rd, rb, jobID)
}

// ---------- /api/me 与账号 ----------

func handleMe(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{"version": version, "register_mode": getSetting("register_mode", "closed")}
	u := sessionUser(r)
	if u == nil {
		out["authed"] = false
		writeJSON(w, out)
		return
	}
	out["authed"] = true
	out["user"] = publicUser(u)
	out["quota"] = quotaInfo(u)
	out["retention_hours"] = retentionHours()
	writeJSON(w, out)
}

func publicUser(u *User) map[string]any {
	return map[string]any{"id": u.ID, "username": u.Username, "nickname": u.Nickname, "role": u.Role, "nsfw": u.NSFW, "display": displayName(u)}
}

// PUT /api/account {nickname?, old_password?, new_password?}
func handleAccountPut(w http.ResponseWriter, r *http.Request) {
	u := cur(r)
	var in struct {
		Nickname    *string `json:"nickname"`
		OldPassword string  `json:"old_password"`
		NewPassword string  `json:"new_password"`
	}
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if in.Nickname != nil {
		nick := strings.TrimSpace(*in.Nickname)
		if len([]rune(nick)) > 24 {
			httpErr(w, 400, "昵称最多 24 个字")
			return
		}
		_, _ = db.Exec(`UPDATE users SET nickname=? WHERE id=?`, nick, u.ID)
	}
	if in.NewPassword != "" {
		if !checkPassword(u.PassHash, in.OldPassword) {
			httpErr(w, 400, "原密码不正确")
			return
		}
		if len([]rune(in.NewPassword)) < 6 {
			httpErr(w, 400, "新密码至少 6 位")
			return
		}
		_, _ = db.Exec(`UPDATE users SET pass_hash=?, token_ver=token_ver+1 WHERE id=?`, hashPassword(in.NewPassword), u.ID)
		nu, _ := getUser(u.ID)
		setSession(w, r, nu) // 本设备保持登录，其他设备下线
	}
	nu, _ := getUser(u.ID)
	writeJSON(w, map[string]any{"user": publicUser(nu), "quota": quotaInfo(nu)})
}

// ---------- 管理：用户 ----------

type UserRow struct {
	*User
	Display    string `json:"display"`
	UsedToday  int    `json:"used_today"`
	Quota      int    `json:"quota"` // 实际生效的每日额度，0 不限
	Images     int    `json:"images"`
	Favorites  int    `json:"favorites"`
	Bytes      int64  `json:"bytes"`
	TotalGen   int    `json:"total_gen"`
	ActiveJobs int    `json:"active_jobs"`
}

func handleUserList(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT ` + userCols + ` FROM users ORDER BY role='admin' DESC, id`)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	var us []*User
	for rows.Next() {
		if u, err := scanUser(rows); err == nil {
			us = append(us, u)
		}
	}
	rows.Close()
	out := []UserRow{}
	for _, u := range us {
		row := UserRow{User: u, Display: displayName(u), UsedToday: usedToday(u.ID), Quota: effectiveQuota(u)}
		_ = db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(favorite),0), COALESCE(SUM(bytes),0) FROM images WHERE user_id=?`, u.ID).Scan(&row.Images, &row.Favorites, &row.Bytes)
		_ = db.QueryRow(`SELECT COALESCE(SUM(used),0) FROM usage_daily WHERE user_id=?`, u.ID).Scan(&row.TotalGen)
		_ = db.QueryRow(`SELECT COUNT(*) FROM jobs WHERE user_id=? AND status IN ('queued','running')`, u.ID).Scan(&row.ActiveJobs)
		out = append(out, row)
	}
	writeJSON(w, out)
}

type userIn struct {
	Username      *string  `json:"username"`
	Nickname      *string  `json:"nickname"`
	Password      string   `json:"password"`
	Role          *string  `json:"role"`
	Disabled      *bool    `json:"disabled"`
	NSFW          *bool    `json:"nsfw"`
	DailyQuota    *int     `json:"daily_quota"`
	Bonus         *int     `json:"bonus"`     // 设为该值
	AddBonus      int      `json:"add_bonus"` // 在现有基础上发放
	AllowedModels []string `json:"allowed_models"`
	MaxConcurrent *int     `json:"max_concurrent"`
	ResetToday    bool     `json:"reset_today"` // 清零今日用量
}

func handleUserCreate(w http.ResponseWriter, r *http.Request) {
	var in userIn
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	name, nick, role := "", "", "user"
	if in.Username != nil {
		name = strings.TrimSpace(*in.Username)
	}
	if in.Nickname != nil {
		nick = *in.Nickname
	}
	if in.Role != nil {
		role = *in.Role
	}
	quota := -1
	if in.DailyQuota != nil {
		quota = *in.DailyQuota
	}
	id, err := createUser(name, nick, in.Password, role, quota, max(0, in.AddBonus))
	if err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	applyUserPatch(id, in, cur(r))
	u, _ := getUser(id)
	writeJSON(w, u)
}

func applyUserPatch(id int64, in userIn, actor *User) error {
	if in.Nickname != nil {
		_, _ = db.Exec(`UPDATE users SET nickname=? WHERE id=?`, strings.TrimSpace(*in.Nickname), id)
	}

	if in.DailyQuota != nil {
		q := *in.DailyQuota
		if q < -1 {
			q = -1
		}
		_, _ = db.Exec(`UPDATE users SET daily_quota=? WHERE id=?`, q, id)
	}
	if in.Bonus != nil {
		_, _ = db.Exec(`UPDATE users SET bonus=? WHERE id=?`, max(0, *in.Bonus), id)
	}
	if in.AllowedModels != nil {
		_, _ = db.Exec(`UPDATE users SET allowed_models=? WHERE id=?`, mustJSON(cleanTags(in.AllowedModels)), id)
	}
	if in.MaxConcurrent != nil {
		_, _ = db.Exec(`UPDATE users SET max_concurrent=? WHERE id=?`, max(0, *in.MaxConcurrent), id)
	}
	if in.ResetToday {
		_, _ = db.Exec(`DELETE FROM usage_daily WHERE user_id=? AND day=?`, id, today())
	}
	return nil
}

func adminCount() int {
	var n int
	_ = db.QueryRow(`SELECT COUNT(*) FROM users WHERE role='admin' AND disabled=0`).Scan(&n)
	return n
}

func handleUserUpdate(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	target, err := getUser(id)
	if err != nil {
		httpErr(w, 404, "用户不存在")
		return
	}
	var in userIn
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	me := cur(r)
	if in.Role != nil && *in.Role != target.Role {
		role := *in.Role
		if role != "admin" {
			role = "user"
		}
		if target.IsAdmin() && role != "admin" && (id == me.ID || adminCount() <= 1) {
			httpErr(w, 400, "不能取消自己或最后一个管理员的管理员身份")
			return
		}
		_, _ = db.Exec(`UPDATE users SET role=?, token_ver=token_ver+1 WHERE id=?`, role, id)
	}
	if in.Disabled != nil && *in.Disabled != target.Disabled {
		if *in.Disabled && (id == me.ID || (target.IsAdmin() && adminCount() <= 1)) {
			httpErr(w, 400, "不能停用自己或最后一个管理员")
			return
		}
		_, _ = db.Exec(`UPDATE users SET disabled=?, token_ver=token_ver+1 WHERE id=?`, b2i(*in.Disabled), id)
	}
	if in.Username != nil && strings.TrimSpace(*in.Username) != target.Username {
		name := strings.TrimSpace(*in.Username)
		if !usernameRe.MatchString(name) {
			httpErr(w, 400, "用户名格式不对")
			return
		}
		if _, err := db.Exec(`UPDATE users SET username=? WHERE id=?`, name, id); err != nil {
			httpErr(w, 400, "用户名已被占用")
			return
		}
	}
	if in.Password != "" {
		if len([]rune(in.Password)) < 6 {
			httpErr(w, 400, "密码至少 6 位")
			return
		}
		_, _ = db.Exec(`UPDATE users SET pass_hash=?, token_ver=token_ver+1 WHERE id=?`, hashPassword(in.Password), id)
	}
	if in.AddBonus != 0 {
		_, _ = db.Exec(`UPDATE users SET bonus=MAX(0,bonus+?) WHERE id=?`, in.AddBonus, id)
	}
	applyUserPatch(id, in, me)
	if id == me.ID && in.Password != "" {
		nu, _ := getUser(id)
		setSession(w, r, nu)
	}
	u, _ := getUser(id)
	writeJSON(w, u)
}

// DELETE /api/users/{id}?purge=1  purge=1 连同全部图片（含收藏）一起删除；否则图片转给操作的管理员
func handleUserDelete(w http.ResponseWriter, r *http.Request) {
	id := pathID(r)
	me := cur(r)
	target, err := getUser(id)
	if err != nil {
		httpErr(w, 404, "用户不存在")
		return
	}
	if id == me.ID || (target.IsAdmin() && adminCount() <= 1) {
		httpErr(w, 400, "不能删除自己或最后一个管理员")
		return
	}
	if r.URL.Query().Get("purge") == "1" {
		rows, _ := db.Query(`SELECT id FROM images WHERE user_id=?`, id)
		var ids []int64
		for rows != nil && rows.Next() {
			var x int64
			if rows.Scan(&x) == nil {
				ids = append(ids, x)
			}
		}
		if rows != nil {
			rows.Close()
		}
		for _, x := range ids {
			deleteImage(x)
		}
		_, _ = db.Exec(`DELETE FROM jobs WHERE user_id=?`, id)
		_, _ = db.Exec(`DELETE FROM prompts WHERE user_id=?`, id)
	} else {
		for _, t := range []string{"jobs", "images", "prompts"} {
			_, _ = db.Exec(fmt.Sprintf(`UPDATE %s SET user_id=? WHERE user_id=?`, t), me.ID, id)
		}
	}
	_, _ = db.Exec(`DELETE FROM market_user_favs WHERE user_id=?`, id)
	_, _ = db.Exec(`DELETE FROM usage_daily WHERE user_id=?`, id)
	_, _ = db.Exec(`DELETE FROM users WHERE id=?`, id)
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 管理：邀请码 ----------

type Invite struct {
	Code       string `json:"code"`
	MaxUses    int    `json:"max_uses"`
	Used       int    `json:"used"`
	DailyQuota int    `json:"daily_quota"`
	Bonus      int    `json:"bonus"`
	Note       string `json:"note"`
	ExpiresAt  int64  `json:"expires_at"`
	CreatedAt  int64  `json:"created_at"`
}

func handleInviteList(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT code,max_uses,used,daily_quota,bonus,note,expires_at,created_at FROM invites ORDER BY created_at DESC`)
	if err != nil {
		httpErr(w, 500, err.Error())
		return
	}
	defer rows.Close()
	out := []Invite{}
	for rows.Next() {
		var x Invite
		if rows.Scan(&x.Code, &x.MaxUses, &x.Used, &x.DailyQuota, &x.Bonus, &x.Note, &x.ExpiresAt, &x.CreatedAt) == nil {
			out = append(out, x)
		}
	}
	writeJSON(w, out)
}

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func newInviteCode() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	out := make([]byte, 8)
	for i := range b {
		out[i] = inviteAlphabet[int(b[i])%len(inviteAlphabet)]
	}
	return string(out)
}

func handleInviteCreate(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Count      int    `json:"count"`
		MaxUses    int    `json:"max_uses"`
		DailyQuota int    `json:"daily_quota"`
		Bonus      int    `json:"bonus"`
		Note       string `json:"note"`
		Days       int    `json:"days"` // 有效天数，0 不过期
	}
	in.DailyQuota = -1
	in.MaxUses = 1 // 默认一次性；0 为不限次数
	in.Days = 7
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if in.Count <= 0 {
		in.Count = 1
	}
	if in.Count > 50 {
		in.Count = 50
	}
	var exp int64
	if in.Days > 0 {
		exp = time.Now().Add(time.Duration(in.Days) * 24 * time.Hour).UnixMilli()
	}
	codes := []string{}
	for i := 0; i < in.Count; i++ {
		c := newInviteCode()
		if _, err := db.Exec(`INSERT INTO invites(code,max_uses,daily_quota,bonus,note,expires_at,created_at) VALUES(?,?,?,?,?,?,?)`, c, max(0, in.MaxUses), in.DailyQuota, max(0, in.Bonus), strings.TrimSpace(in.Note), exp, now()); err == nil {
			codes = append(codes, c)
		}
	}
	writeJSON(w, map[string]any{"codes": codes})
}

func handleInviteDelete(w http.ResponseWriter, r *http.Request) {
	_, _ = db.Exec(`DELETE FROM invites WHERE code=?`, r.PathValue("code"))
	writeJSON(w, map[string]any{"ok": true})
}

// ---------- 用户可见的模型列表 ----------

func modelAllowed(u *User, model string) bool {
	if u.IsAdmin() || len(u.AllowedModels) == 0 {
		return true
	}
	for _, m := range u.AllowedModels {
		if m == model {
			return true
		}
	}
	return false
}

// userChannels 非管理员看到的「渠道」：不含名称、地址、密钥；同名模型只保留排在前面的渠道
func userChannels(u *User) []*Channel {
	cs, _ := listChannels()
	seen := map[string]bool{}
	out := []*Channel{}
	for _, c := range cs {
		if c.Hidden {
			continue
		}
		var ms []string
		for _, m := range c.Models {
			if !seen[m] && modelAllowed(u, m) {
				seen[m] = true
				ms = append(ms, m)
			}
		}
		if len(ms) == 0 {
			continue
		}
		out = append(out, &Channel{ID: c.ID, APIType: c.APIType, Models: ms, Caps: c.Caps, Sort: c.Sort, ToolPathAt: c.ToolPathAt})
	}
	return out
}

// canUseChannelModel 检查用户能否用这个渠道的这个模型
func canUseChannelModel(u *User, ch *Channel, model string) bool {
	if u.IsAdmin() {
		return true
	}
	for _, c := range userChannels(u) {
		if c.ID == ch.ID {
			for _, m := range c.Models {
				if m == model {
					return true
				}
			}
		}
	}
	return false
}

var anyURLRe = regexp.MustCompile(`https?://[^\s"'<>]+`)

// scrubForUser 去掉错误信息里的上游地址，避免泄露渠道
func scrubForUser(s string) string {
	return anyURLRe.ReplaceAllString(s, "…")
}

// ---------- 系统设置 ----------

func retentionHours() int {
	v, _ := strconv.Atoi(getSetting("retention_hours", "0"))
	return v
}

func handleSystemGet(w http.ResponseWriter, r *http.Request) {
	var total, fav int
	var bytesAll, favBytes int64
	_ = db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(favorite),0), COALESCE(SUM(bytes),0), COALESCE(SUM(CASE WHEN favorite=1 THEN bytes ELSE 0 END),0) FROM images`).Scan(&total, &fav, &bytesAll, &favBytes)
	var users int
	_ = db.QueryRow(`SELECT COUNT(*) FROM users`).Scan(&users)
	var todayAll int
	_ = db.QueryRow(`SELECT COALESCE(SUM(used),0) FROM usage_daily WHERE day=?`, today()).Scan(&todayAll)
	writeJSON(w, map[string]any{
		"retention_hours":    retentionHours(),
		"register_mode":      getSetting("register_mode", "closed"),
		"default_quota":      defaultQuota(),
		"default_concurrent": defaultConcurrent(),
		"images":             total, "favorites": fav, "bytes": bytesAll, "fav_bytes": favBytes,
		"users": users, "today_images": todayAll, "version": version,
	})
}

func handleSystemPut(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RetentionHours    *int    `json:"retention_hours"`
		RegisterMode      *string `json:"register_mode"`
		DefaultQuota      *int    `json:"default_quota"`
		DefaultConcurrent *int    `json:"default_concurrent"`
		CleanNow          bool    `json:"clean_now"`
	}
	if err := readJSON(r, &in); err != nil {
		httpErr(w, 400, err.Error())
		return
	}
	if in.RetentionHours != nil {
		_ = setSetting("retention_hours", strconv.Itoa(max(0, *in.RetentionHours)))
	}
	if in.RegisterMode != nil {
		m := *in.RegisterMode
		if m != "open" && m != "invite" {
			m = "closed"
		}
		_ = setSetting("register_mode", m)
	}
	if in.DefaultQuota != nil {
		_ = setSetting("default_quota", strconv.Itoa(max(0, *in.DefaultQuota)))
	}
	if in.DefaultConcurrent != nil {
		_ = setSetting("default_concurrent", strconv.Itoa(min(20, max(1, *in.DefaultConcurrent))))
	}
	removed := 0
	if in.CleanNow {
		removed = cleanupOnce()
	}
	_ = sql.ErrNoRows
	writeJSONWith(w, removed)
}

func writeJSONWith(w http.ResponseWriter, removed int) {
	writeJSON(w, map[string]any{"ok": true, "removed": removed, "retention_hours": retentionHours()})
}
