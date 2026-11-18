# 影室 · image-studio

一个人用的生图工作台：接入任意兼容 OpenAI 接口的生图渠道，调参数、管提示词、收藏资产、做质量对比。单个二进制，自带前端，SQLite 存储。

## 功能

- **生成**：大文本框写提示词，点选灵感片段，模板变量自动出表单，拖拽 / 粘贴参考图；右侧参数面板按渠道能力档案动态显示（比例、尺寸、分辨率、质量、张数、格式、压缩、背景、审核）。任务在后台执行，刷新页面不丢；结果和历史以瀑布流展示，无限滚动。
- **每张图**：收藏为资产、下载原图、复制配方、用这个配方再来、删除。
- **对比**：同一提示词，最多 4 个「渠道 + 模型 + 参数」组合并行出图，并排展示耗时、实际尺寸、文件大小、格式，可一键收藏。
- **提示词库**：10 类内置片段（风格、画面主体、光影、镜头、构图、色彩、材质、氛围、画质增强、负面），中英对照；10 个精选模板；我的提示词支持模板变量、标签、搜索、置顶、使用次数、JSON 导入导出。
- **资产**：收藏即永久保存原图，历史清理不会动它；相册、标签、按提示词 / 标签 / 渠道 / 模型搜索；灯箱里看完整配方（渠道、模型、全部参数、实际发送的提示词、尺寸、耗时、时间）；批量导出 zip（含 recipes.json）。
- **外观**：浅色 / 深色两套主题，可跟随系统；桌面与手机布局。

## 渠道与能力档案

一个渠道 = Base URL + API Key + 接口类型 + 模型列表 + 能力档案。

- **接口类型**：生图接口（`/v1/images/generations`，有参考图时走 `/v1/images/edits`）或对话出图（`/v1/chat/completions`）。
- **模型**：点「测试连接并拉取」从 `/v1/models` 获取后勾选，也可手动添加。
- **能力档案**：每项参数选择「原生发送 / 写进提示词 / 不用」。不支持原生参数的渠道，可以把比例、尺寸、分辨率、质量、背景等转成一句短语追加到提示词末尾，实际发送的提示词会记录在配方里。张数可选「逐张请求」；参考图可选表单上传（`image[]`）或内嵌数据（JSON data URL）。
- **返回方式**：链接或内嵌数据；链接返回的图片会立刻下载落盘，不依赖临时地址。
- 新建渠道时可用预设快速填充（OpenAI 官方 / 比例型 / 尺寸型 / 提示词比例型），之后所有选项都可以自己改。渠道类型不会根据 URL 自动推断。

API Key 只保存在服务端数据库，前端只显示后四位。

## 运行

```bash
docker run -d --name image-studio \
  -p 8080:8080 \
  -e ADMIN_PASSWORD='换成你的密码' \
  -e TZ=Asia/Shanghai \
  -v $(pwd)/data:/data \
  --restart unless-stopped \
  ghcr.io/sakuralaaa/image-studio:latest
```

然后打开 `http://服务器:8080`，用 `ADMIN_PASSWORD` 登录，在「设置 → 渠道」里新建渠道。

也可以用仓库里的 `docker-compose.yml`。

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | 空 | 管理员密码。留空则不需要登录（只建议在内网用） |
| `DATA_DIR` | `/data` | 数据目录：`studio.db`、`images/` 原图、`thumbs/` 缩略图、`refs/` 参考图 |
| `PORT` | `8080` | 监听端口 |
| `TZ` | `Asia/Shanghai` | 时区 |

### 数据

- 收藏的图片永久保留。
- 「设置 → 通用」可设置未收藏历史图片的保留天数（默认 0 = 不清理）。
- 备份只需要复制整个数据目录。

## 开发

```bash
# 前端
cd web && npm install && npm run dev      # Vite 开发服务器，代理到 :8080
# 后端
cd web && npm run build && cd ..
DATA_DIR=./data ADMIN_PASSWORD=dev go run .
```

技术栈：Go 1.26 + SQLite（modernc.org/sqlite，纯 Go，无 CGO）；Vite + React + TypeScript，手写 CSS，lucide 图标。前端构建产物嵌入二进制。

推送 `v*` 标签会通过 GitHub Actions 构建 amd64 + arm64 镜像并推送到 `ghcr.io/sakuralaaa/image-studio`（标签 `latest`、`x.y.z`、`x.y`、`sha-xxxxxxx`）。

## 许可

MIT
