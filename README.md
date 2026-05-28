<p align="center">
  <img src="apps/web/public/agf-banner.png" alt="Agent Game Forge" width="640" />
</p>

<p align="center">
  <b>本地优先、可自选 AI Agent 的 2D 游戏 IDE。</b><br/>
  支持 Codex / Claude Code 驱动，当前默认输出 Web（JS + Canvas），Godot 与 Unity 在路线图中。
</p>

<p align="center">
  <a href="https://github.com/tangdan2204/agent-game-forge/stargazers"><img src="https://img.shields.io/github/stars/tangdan2204/agent-game-forge?style=flat" alt="stars"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="license"/></a>
  <img src="https://img.shields.io/badge/status-pre--launch-blue" alt="status"/>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-success" alt="node 20+"/>
</p>

<p align="center">
  精灵管线由 <a href="https://github.com/0x0funky/agent-sprite-forge"><b>agent-sprite-forge</b></a> 提供能力支持
</p>

---

## 项目简介
Agent Game Forge（AGF）是一个开源桌面 IDE，用来让 AI 编程 Agent 帮你搭建完整的 2D 游戏：角色精灵、分层背景、物理碰撞、危险区域、可拾取物、场景布局等。

它的核心目标是：

- 你选择 Agent（Codex CLI 或 Claude Code）
- 你选择图像生成能力（可配置 API Key 或使用内置工具）
- 你保留最终控制权（可视化场景编辑器可直接拖拽修正）

当前默认生成目标是原生 Web 技术栈（`HTML + JS + Canvas`），无需绑定框架，产物可直接部署到静态托管。

---

## 核心能力
- 自选 Agent：Codex CLI / Claude Code，支持在设置中实时切换
- 生产可用的 2D 资产管线：sprite-sheet、抠图、动画动作组织、分层背景
- 自选图像生成：按提供方与模型配置调用，密钥仅保存在本机
- 可视化场景编辑器：拖拽物件、碰撞体、区域、路径，所见即所得
- 本地优先：Daemon 与 Web UI 在本机运行，项目文件保留在本地磁盘
- 成本可见：设置页展示图像生成调用统计与费用估算

---

## 界面预览
主界面：

<p align="center">
  <img src="apps/web/public/hero-shot.png" alt="AGF 主界面" width="900" />
</p>

设置面板：

<p align="center">
  <img src="apps/web/public/setting.png" alt="AGF 设置面板" width="900" />
</p>

场景编辑器：

<p align="center">
  <img src="apps/web/public/scene-editor.png" alt="AGF 场景编辑器" width="900" />
</p>

---

## 快速开始
环境要求：

- `Node.js >= 20`
- `npm >= 10`
- 至少安装一个 Agent CLI：
- Codex CLI：`npm i -g @openai/codex`
- Claude Code：`npm i -g @anthropic-ai/claude-code`

安装与启动：

```bash
git clone https://github.com/tangdan2204/agent-game-forge.git
cd agent-game-forge
npm install
npm run dev
```

启动后默认地址：

- Daemon：<http://localhost:7621>
- Web UI：<http://localhost:7620>

Windows 一键启动（可选）：

```bat
launch-agf.bat
```

首次使用建议：

1. 打开右上角设置
2. 选择 Agent CLI（Codex 或 Claude Code）
3. 配置图像生成提供方与模型（按需填写 API Key）
4. 打开项目目录并输入需求开始生成

---

## 工作原理
1. 你在聊天面板输入需求，UI 通过流式方式显示 Agent 输出和工具调用
2. Daemon 负责调度 Agent CLI、统一 API、写入会话与项目状态
3. 图像生成请求通过 Daemon 的统一接口转发到对应提供方
4. 场景编辑器直接读写同一份项目数据文件，修改可立即反映到运行视图
5. 产物是项目本身（`index.html`、`src/*.js`、`data/*.json`、`assets/*`）

---

## 仓库结构
```text
agent-game-forge/
├─ packages/
│  └─ contracts/                 # 共享 TS 类型定义
├─ apps/
│  ├─ daemon/                    # Node + Express 后端守护进程（7621）
│  │  └─ src/
│  │     ├─ server.ts
│  │     ├─ agents.ts
│  │     ├─ codex.ts
│  │     ├─ claude-code.ts
│  │     ├─ gen-image.ts
│  │     ├─ scenes.ts
│  │     └─ templates/
│  └─ web/                       # Vite + React 前端（7620）
│     └─ src/
│        ├─ App.tsx
│        ├─ components/
│        └─ lib/
├─ docs/
├─ launch-agf.bat
└─ README.md
```

---

## 构建命令
```bash
npm install
npm run build
npm run dev
```

常用子命令：

- `npm -w @ogf/daemon run dev`：仅启动 daemon
- `npm -w @ogf/web run dev`：仅启动前端
- `npm -w @ogf/contracts run build`：仅构建共享类型包

---

## 项目状态
类型支持（摘要）：

| 类型 | 状态 | 说明 |
|---|---|---|
| 横版平台动作 | 可用 | 当前主打方向 |
| 俯视角 RPG | 部分可用 | 规则与配方持续完善中 |
| 塔防 / Arena | 部分可用 | 需要更多模板打磨 |
| Roguelike / 银河城 | 规划中 | 后续迭代目标 |

引擎目标：

| 引擎 | 状态 | 说明 |
|---|---|---|
| Web（JS + Canvas） | 默认可用 | 当前主路径 |
| Godot 4 | 规划增强 | 兼容能力持续补齐 |
| Unity | 规划中 | 后续版本目标 |

---

## 文档入口
- [架构说明](docs/architecture.md)
- [路线图](docs/roadmap.md)
- [类型支持矩阵](docs/genre-support.md)
- [Daemon 模板资源](apps/daemon/src/templates)

---

## 贡献方式
欢迎提交 Issue 与 PR。为提升协作效率，建议先在 Issue 中说明目标与范围，再提交实现。

优先欢迎：

- Bug 复现与日志
- 不同平台（Windows / macOS / Linux）兼容性反馈
- 真实项目样例与体验反馈

---

## 安全与数据
- 本地优先：服务默认运行在 `127.0.0.1`
- 会话与配置默认写入用户目录下的 `.ogf` 数据目录
- 密钥不进入仓库，不会随源码提交

---

## 许可证
本项目采用 [Apache License 2.0](LICENSE)。

---

## 致谢
- Daemon 与 Agent 编排思路参考：`nexu-io/open-design`
- 精灵生成管线参考：`0x0funky/agent-sprite-forge`

<p align="center">
  如果你在使用 AGF 过程中遇到问题，欢迎提 Issue。<br/>
  <a href="https://github.com/tangdan2204/agent-game-forge/issues">问题反馈</a> ·
  <a href="https://github.com/tangdan2204/agent-game-forge/discussions">社区讨论</a>
</p>
