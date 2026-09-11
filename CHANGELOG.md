# 更新记录

> 本文件记录本仓库（DeepSeek Harness Studio 桌面端）每一次实际落地的改动。
> 每条记录都包含：改了什么、为什么改、怎么验证、以及踩过的坑，便于交接与复现。

---

## 2026-09-12 · Windows 桌面端构建打通 + FF–LLM Wiki 应用修复

### 一、本轮目标

在 **Windows** 环境下，把 Studio 桌面端从源码一路构建到可安装的 NSIS 安装包，并让内置应用
**FF–LLM Wiki** 一并打进产物。

最终结果：**已产出可安装的 Windows 安装包，启动验证通过**（见文末「产物」）。

---

### 二、代码改动明细

#### 1. `packages/examples/ff-llm-wiki-plugin/scripts/build-application.mjs`

该脚本原先只在 macOS / Linux 上验证过，在 Windows 上有三处硬伤，逐条修复：

| # | 现象 / 根因 | 修复 |
|---|---|---|
| 1 | `execFileSync('pnpm', …)`：Windows 下 `pnpm` 不是可执行文件（真实入口是 `pnpm.cmd`），`spawnSync` 直接抛 `ENOENT`。 | 新增 `pnpmExec()` 帮助函数：Windows 走 `pnpm.cmd` **并启用 shell**，其余平台保持原样；三处调用（`install` / `contracts build` / `next build`）全部改走它。 |
| 2 | `cp()` 的过滤函数写作 `!source.endsWith('/node_modules')`，**用的是正斜杠**；Windows 路径是反斜杠，条件恒为真 → `node_modules` 被整个复制进临时构建目录，随后链接步骤报 `EEXIST`。 | 过滤条件改为**分隔符无关**（`/[\\/]node_modules$/` 等），`.next` 与 `node_modules` 在任何平台都被排除。 |
| 3 | 用 `fs.symlink(..., 'junction')` 链接临时 Web 目录的依赖：**junction 会重写路径**，而 pnpm 在 `node_modules` 内部使用**相对符号链接**，经 junction 访问时相对目标被解析到错误位置 → `Cannot find module '…\.application-build\web\node_modules\next\dist\bin\next'`。 | 改为**真正的目录符号链接**（`'dir'`），链接语义与 POSIX 一致，内部相对链接不再错位。前置 `rm()` 清理残留目标，保证幂等。 |

**验证**：`pnpm run build:applications` 产出 `runtime/{api,seed,web}` 三个目录，且该包随
`runtime-host` 部署进安装产物（`resources/host/node_modules/@fufan/dsh-plugin-llm-wiki/runtime/`）。

#### 2. 构建脚本说明（未改代码，但必须知道）

- `apps/desktop/package.json` 的 `build:applications` 会在打安装包前调用上述脚本；
  `dist:win` 的完整链路是 **build:applications → workspace build → stage-runtime → release-win**。
- `apps/desktop/src/main.ts` 里 `BUILT_IN_APPLICATION_BUNDLES = ['@fufan/dsh-plugin-llm-wiki']`：
  该内置应用是从 **runtime-host 的依赖闭包**加载的，因此它的 `runtime/` 载荷**必须先构建**，
  否则应用中心会出现一个打不开的入口。
- 该 wiki 子应用的 `engines.node` 要求 **≥ 24**，构建设一步时需使用 Node 24（见下文环境要求）。

---

### 三、构建环境要求（Windows）

| 项 | 值 / 说明 |
|---|---|
| Node（仓库构建） | `v22.22.2`（仓库 `engines`：`^22.19.0 \|\| >=24.0.0`） |
| Node（wiki 子应用） | `v24.16.0`（其 `engines.node >= 24`） |
| 包管理器 | `pnpm@11.7.0`（与 `packageManager` 字段一致） |
| 注册表 | 建议 `https://registry.npmmirror.com`（原方案有 GitHub 拉取不稳问题） |
| Electron 二进制 | `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` |
| electron-builder 工具链 | `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/` |
| 供应链策略 | pnpm 11 默认 `minimumReleaseAge = 1 天`；本仓库 lockfile 固定了 3 个较新的传递依赖，需在 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 中豁免：`compression@1.8.2`、`fastify@5.12.4`、`open@11.0.3` |

---

### 四、可复现的完整构建步骤

> ⚠️ **务必在全新克隆的目录里执行**（原因见第五节「坑 1 / 坑 2」）。

```bash
# 0. 环境
export PATH="<node22>/:<node24>:/path/to/pnpm11:$PATH"
export npm_config_registry=https://registry.npmmirror.com
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/

# 1. 依赖（跳过 postinstall，避免 electron 大包卡住；后面单独补）
pnpm install --ignore-scripts --config.minimumReleaseAge=0

# 2. Electron 二进制
(cd apps/desktop/node_modules/electron && node install.js)

# 3. 仓库构建（host + client + web）
pnpm run build:official

# 4. 桌面端构建
pnpm run build:desktop

# 5. 内置应用 FF–LLM Wiki 载荷（用 Node 24）
(cd apps/desktop && pnpm run build:applications)

# 6. 生成打包用的 runtime-host 依赖闭包
(cd apps/desktop && node --import tsx scripts/stage-runtime.ts)

# 7. 打 Windows NSIS 安装包
(cd apps/desktop && pnpm exec electron-builder --win nsis)
```

产物：`apps/desktop/dist/DeepSeek-Harness-Desktop-Windows-x64-<version>-Setup.exe`

---

### 五、踩坑记录（重要，后续务必注意）

#### 坑 1：切换 git 分支会留下「被 gitignore 的目录」，污染 workspace

从其它分支（例如官方上游分支）切回来时，**被 `.gitignore` 忽略的整个目录不会被清理**。
例如上游存在、而本仓库不存在的 `apps/desktop-host/` 会留在磁盘上；而
`pnpm-workspace.yaml` 里写着 `apps/*`，于是这个「残骸」被当成合法 workspace 包，
最终报出与真实原因完全无关的错误：

```
ERROR [@deepseek-ai/dsh-root] Cannot find entry: ["lib/types/{index,invariant,startup}.js"]
```

**对策**：构建前确认 `apps/` 下没有多余目录；或直接用全新克隆。

#### 坑 2：`tsc -b` 是增量编译，残留缓存会导致「跳过产物生成」

`.tsbuildinfo` 分散在各包内，**嵌套较深的容易被漏删**（本项目最多有 200+ 个）。
残留的增量状态会让 `tsc` 认为「已编译过」而**不产出 `lib/types/*.js`**，
tsdown 随即报找不到入口。

**对策**：构建前无深度限制地清理：

```bash
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" -delete
find packages apps vendor -type d -name lib -not -path "*/node_modules/*" -prune -exec rm -rf {} +
```

#### 坑 3：Windows 上 `pnpm` 不能被 `spawnSync` 直接执行

必须用 `pnpm.cmd` 且启用 `shell: true`；跨平台写法见上文 `pnpmExec()`。

#### 坑 4：Windows junction ≠ 符号链接

- junction 会**重写路径**，破坏 pnpm 内部的**相对**符号链接；
- junction 不能用 `unlink` 删除（需 `rmdir`）；
- 本机**可以**创建真正的目录符号链接，优先用 `'dir'`。

#### 坑 5：pnpm 供应链策略

`pnpm run` 会先做 lockfile 供应链校验。若 lockfile 固定了「发布不足 1 天」的包，会直接失败：

```
[ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION]
```

**对策**：按仓库既有做法加入 `minimumReleaseAgeExclude`，而不是全局关掉策略。

---

### 六、产物与校验（本次交付）

| 产物 | 说明 |
|---|---|
| `DeepSeek-Harness-Desktop-Windows-x64-0.1.0-rc.19-Setup.exe` | NSIS 安装包，**未签名**（Windows SmartScreen 会提示，属正常） |
| 大小 | 173,941,795 字节（约 166 MB） |
| SHA256 | `ee221cdeb5e53cdd2fac7b43da6993dd…`（完整值见交付目录同名 `.blockmap` 旁的记录） |
| 免安装版 | `apps/desktop/dist/win-unpacked/DeepSeek Harness.exe` |

**验证记录**

- 构建：`build:official`（214 个 client artifact）→ `build:desktop`（`lib/main.js` 318,590 B）→
  `stage-runtime`（runtime-host 326 个包）→ `electron-builder` 全部退出码 0。
- 运行：启动打包后的应用 → 进程存活 → 监听本机端口（web UI）→ 正常退出。
- 内置应用：`runtime-host` 与安装产物中均存在
  `@fufan/dsh-plugin-llm-wiki/runtime/{api,seed,web}`。

---

### 七、本轮未包含 / 后续计划

1. **上游核心对齐（dsh 0.1.2 ~ 0.1.5）未包含**。当前核心基线仍为 `0.1.1-rc.2`。
   上游 0.1.5 对以下内容做了重构，属于独立工作：
   - 删除 `packages/host/apiproxy`（上游归档笔记：`unary-apiproxy-remote-migration`）
   - 拆分 `packages/client/runtime` → `client/store` + `ui-chat` + `ui-renderer`
   - 新增 `apps/desktop` / `apps/desktop-host`（与 Studio 桌面层冲突）
   - `native/landlock-run` 更名 `native/system`
   > 相关调研与移植分支保留在开发目录，未被合并进本仓库。
2. **代码签名证书**未配置，安装包为未签名状态。
3. 品牌替换（名称 / Logo / appId）可按需进行，改动位置：
   - `apps/web/public/dsh-desktop/beyondata-logo.png`（主 Logo）
   - `apps/desktop/build/icon.png`（应用与安装包图标）
   - `apps/desktop/package.json` → `build.productName` / `build.appId` / `build.nsis.shortcutName`
   - `packages/client/ui-brand-official/`（品牌插槽，最干净）

---

*记录人：ZCode（Pier）· 2026-09-12*

---

## 2026-09-12 · 品牌重塑为「天幕 / TM Agent」+ 插件市场接入

### 一、本轮目标

把整包（含内置应用）的对外品牌从「赋范空间 / DeepSeek Harness Studio」替换为 **天幕 / TM Agent**，
并把 **https://deepseek.stream（DeepSeek Harness Hub 插件市场）** 接入为受信任的插件来源。

### 二、产品身份

| 项 | 新值 | 位置 |
|---|---|---|
| 产品名 | `TM Agent` | `apps/desktop/package.json` → `build.productName` |
| 应用 ID | `com.tianmu.tmagent` | 同上 → `build.appId` |
| 快捷方式名 | `TM Agent` | 同上 → `build.nsis.shortcutName` |
| 安装包文件名 | `TM-Agent-Windows-x64-<ver>-Setup.exe` | 同上 → `build.win.artifactName` |
| 可执行文件名 | `TM Agent.exe` | 由 `productName` 派生 |
| 窗口/文档标题 | `TM Agent` | `apps/desktop/src/main.ts`（`APP_NAME`）、`scripts/client-build-environment.ts`（`DSH_CLIENT_TITLE`）、`apps/web/vite.config.ts` 与 `ui-renderer/DocumentTitle.tsx` 的 `DEFAULT_CLIENT_TITLE` |
| 侧栏出品署名 | 「天幕出品」，链接指向 `https://deepseek.stream` | `ui-desktop-customization/BrandBadge.tsx` |

### 三、Logo 设计（天幕）

概念：**穹顶光弧（天幕）+ 核心光点（Agent）+ 星域深空**，配色走青→天蓝→紫的深空渐变。

- 设计源文件（SVG）保留在开发目录；产物：
  - `apps/desktop/build/icon.png`（1024×1024，应用与安装包图标）
  - `apps/web/public/dsh-desktop/tm-logo.png` / `tm-logo@2x.png`（界面 Logo）
  - `apps/desktop/resources/trayTemplate.png` / `@2x`（托盘，单色模板图）
  - `apps/web/public/tm-favicon.svg`（站点图标）
- 原 `beyondata-logo.png` 已删除。

**关键取舍**：品牌字形改为天幕造型，但 **`FishLogo` 的 viewBox 仍保持 `0 0 23.16 17.04`、
`BrandWordmark` 仍保持 `0 0 182 24` / `26 0 156 24`** —— 这样所有品牌插槽的尺寸计算与
几何断言测试都无需改动，把改动面压到最小。

- `ui-primitives/FishLogo.tsx`：鲸鱼路径 → 天幕穹顶字形（`currentColor`）
- `ui-primitives/BrandWordmark.tsx`：矢量"deepseek + HARNESS"字标 → 字形 + `TM AGENT` 文本字标

### 四、内置应用

内置的 FF–LLM Wiki 一并换牌：

- 界面标题与字标：`FF - LLM Wiki 企业知识库` → **天幕知识库**
- 品牌 Logo：`brand/ff-logo.png` → `brand/tm-logo.png`（天幕）
- 应用图标：`src/app/icon.svg` → 天幕图标
- 页脚版权：`@2026 赋范空间 独家自研` → `@2026 天幕 独家自研`

### 五、插件市场接入（deepseek.stream）

该站点是 DeepSeek Harness 的社区插件市场（`/api/plugins` 提供分页插件目录：名称、版本、作者、
图标、下载量、评分、`downloadUrl` 等）。接入方式：

1. **受信任来源**：把 `https://deepseek.stream` 加入插件中心契约的两份白名单
   （`packages/plugin-center/contracts/src/index.ts`）：
   - `MEDIA_ORIGINS` —— 允许展示该市场提供的图标/封面
   - `ARTIFACT_ORIGINS` —— 允许从该市场下载插件产物
2. **发现页入口**：插件发现页头部新增「天幕插件市场」入口（新窗口打开该站点），
   并补齐中英文文案与样式（`PluginDiscoveryPage.tsx` / `.module.css` / `locales.ts`）。

> 说明：应用的"插件发现"是 **npm 包中心**（搜索 → 拉取 tarball → 校验 integrity）实现，
> 而该市场的插件同样以 npm 包形式分发（如 `@dsh-external/*`），因此发现链路天然覆盖；
> 本轮把该市场确认为**受信来源 + 显式入口**。若要把市场目录**直接内联进应用内的搜索结果**，
> 需要市场提供带 integrity 的 npm 兼容产物或新增一个目录适配器，属后续增强。

### 六、文案与测试同步

- 中英文界面文案：`赋范官方/赋范桌面端/Fufan Official/Fufan Desktop` → `天幕官方/天幕桌面端/Tianmu Official/Tianmu Desktop`；
  产品名相关表述 `DeepSeek Harness` → `TM Agent`（保留对上游 DeepSeek 的客观表述）
- Preset 广场内置七套工作流的署名与描述同步换为「天幕官方」
- 同步修改的断言/夹具（避免验证关卡失败）：
  - `apps/desktop/tests/packaging-config.spec.ts`（artifactName / shortcutName）
  - `packages/client/ui-desktop-customization/tests/brand-badge.client.spec.tsx`（署名与链接）
  - `packages/client/ui-plugin-center/tests/preset-square.client.spec.tsx`、`apps/desktop/tests/preset-square-*.spec.ts`
  - `apps/desktop/scripts/verify-packaged-runtime.ts` 与其 spec（logo 文件名）

### 七、构建与产物（本轮）

构建与打包全链路退出码 0，产物经启动冒烟验证。

| 项 | 值 |
|---|---|
| 安装包 | `TM-Agent-Windows-x64-0.1.0-rc.19-Setup.exe` |
| 大小 | 174111851 字节（约 166 MB） |
| SHA256 | `6c91dac0ff5887e75a40ad1218fac6317e0e036cee06dd54841380ec5642d7c8` |
| 可执行文件 | `TM Agent.exe` |
| host 依赖闭包 | 326 个包 |
| 构建产物 | 216 个 client artifact |

**验证**：启动打包后的应用 → 进程存活 → 监听本机端口（web UI）→ 正常退出；
天幕 logo 与内置应用 `runtime/{api,seed,web}` 均在安装产物内。

### 八、未改动 / 注意事项

1. **包名与 scope 未改**（`@deepseek-ai/*`、`@fufan/dsh-plugin-llm-wiki`）：属于代码标识符，
   改动会牵动全仓依赖与契约，本次不动。
2. **自动更新源仍是赋范的 OSS 地址**（`apps/desktop/package.json` → `build.publish`）。
   若要启用自动更新，需替换为天幕自己的更新源（并提供 `latest.yml` 与安装包）。
3. 安装包**未做代码签名**，Windows SmartScreen 会提示，属正常现象。
4. 上游核心仍为 `0.1.1-rc.2`，官方新版核心对齐未包含在本轮。

*记录人：ZCode（Pier）· 2026-09-12*

---

## 2026-09-12 · 接入插件市场「一键安装」协议（dsh://）

### 一、背景

插件市场 **deepseek.stream** 的开发指南（`/guide` 第二节）定义了官方的一键安装联动协议：
网页端通过自定义 URI Scheme **`dsh://plugin/install`** 唤起桌面客户端完成插件导入。
市场侧已按该协议发起调用，但**客户端此前从未实现接收端**，因此点击"一键安装"没有任何反应。

本轮把客户端这一半补齐。

### 二、协议契约（按指南实现）

| 项 | 值 |
|---|---|
| 协议头 | `dsh://` |
| 路由 | `/plugin/install` |
| 必填参数 | `id`、`name`、`version`、`repo` |
| 可选参数 | `permissions`（逗号分隔）、`downloadUrl`（https 备用直链） |
| 网页端发起 | 隐藏 iframe 或 `<a href="dsh://...">`（市场侧已实现） |

### 三、客户端实现

**1. 协议注册**

- `apps/desktop/package.json` → `build.protocols`：安装器写入 Windows 注册表关联
- `apps/desktop/src/main.ts` → `registerPluginLinkProtocol()`：运行时调用
  `app.setAsDefaultProtocolClient('dsh')`（开发态附带入口脚本参数）

**2. 深链捕获**

- Windows / Linux：`second-instance` 的 `commandLine` + 首启 `process.argv`
- macOS：`app.on('open-url')`
- 捕获到的链接进入队列，由单一线程按到达顺序处理，避免并发弹窗

**3. 参数解析与严格校验**（新增 `apps/desktop/src/plugin-link.ts`）

- 校验 scheme / host / path 三段路由
- 必填参数缺失即拒绝；`id` 必须为小写分隔标识；`version` 必须为语义化版本或 `latest`
- `repo` 必须为 npm 包名或 `owner/repo`；`downloadUrl` 必须为 https
- 全长度上限 + 控制字符拒绝（`MAX_LINK_LENGTH` / `MAX_PARAMETER_LENGTH`）

**4. 授权弹窗**（对应用户指南步骤 2）

展示**插件名称、标识、版本、来源、申请权限**，用户确认后才继续；取消则完全不动。

**5. 安装执行（复用现有受信链路，不新增后门）**

安装请求契约刻意只接受 `{pluginId, version, idempotencyKey}`（不接受 URL 或路径权威），
因此深链安装走的是与插件中心完全相同的受信路径：

1. `repo` 为 npm 包名时，从 npm 解析精确版本（`latest` → `dist-tags.latest`）
2. 以包名检索受信目录，使该包进入目录快照
3. 调用 `PluginOperationController.start()` → 兼容性预检 → 下载 → **完整性校验** → 安装 → 热重载

若链接指向的是源码仓库（非 npm 包）、包未发布、或未通过目录预检，
客户端给出明确原因并提示到插件中心/市场查看——**不降级校验、不静默安装**。

### 四、测试

新增 `apps/desktop/tests/plugin-link.spec.ts`（10 个用例）：

- 路由识别（合法路由 / 错误 scheme、host、path、非 URL）
- 参数解码（中文名称、权限列表、`latest` 哨兵、https 备用链）
- 拒绝用例（缺必填、非法 id、非法版本、非 https 直链、非法 repo）
- `pluginIdForNpmPackage` 与发现仓库派生规则一致（含 scoped 包）
- 最新版本解析（正常 / 非版本号 / 请求失败）

### 五、验证记录

| 验证项 | 结果 |
|---|---|
| 单元测试 | 10/10 通过 |
| 类型检查（桌面端） | 退出码 0 |
| 注册表关联 | 启动打包版后 `HKCU\Software\Classes\dsh\shell\open\command` = `"...\TM Agent.exe" "%1"`，与指南规范一致 |
| 端到端 | 向运行中的客户端发送 `dsh://plugin/install?...` → 单实例接住 → **授权弹窗正确显示**名称/标识/版本/来源/权限 |

### 六、本轮产物

| 项 | 值 |
|---|---|
| 安装包 | `TM-Agent-Windows-x64-0.1.0-rc.19-Setup.exe` |
| 大小 | 174117869 字节 |
| SHA256 | `6b8eecd2295aa7a9732c94472056ecf3d6345c9378572f8f56a8718924bea39b` |

### 七、已知边界

1. **仅支持 npm 分发的插件**。市场里以 zip 直链分发、未发布到 npm 的插件，
   当前会被明确拒绝并提示到市场查看（因为受信链路要求完整性校验）。
   若需支持，需要市场提供 `sha256` 字段或新增一条受控的外部来源安装通道。
2. 安装过程的进度展示仍由插件中心页面负责；协议只负责"发起"。
3. macOS 的协议关联依赖安装包写入 `Info.plist`（`build.protocols` 已声明，未在本机验证）。

*记录人：ZCode（Pier）· 2026-09-12*

---

## 2026-09-12 · 修复换牌后安装器"记不住上次安装目录"

### 一、现象

用户反馈：**已经装过一次，重新安装时安装器没有带出上次选择的目录**，而是回到默认路径
`C:\Users\Administrator\AppData\Local\Programs\TM Agent`。

### 二、根因（已实测确认）

安装器用**一组由 appId 派生的 GUID 注册表键**记住安装位置：

| 产品身份 | appId | 记忆键 |
|---|---|---|
| 换牌前 | `ai.deepseek.harness.desktop` | `HKCU\Software\324de6fc-994c-5e11-a4a4-be1f79b84b94` |
| 换牌后 | `com.tianmu.tmagent` | 另一个全新 GUID |

实测证据：旧键里**完好记录着**用户上次选择的目录

```
HKCU\Software\324de6fc-994c-5e11-a4a4-be1f79b84b94
  InstallLocation = D:\Ai\Deepseek\DSERKAI\DeepSeek Harness
```

但**新 appId 的键为空**，而 electron-builder 的安装器只在"当前键非空"时才沿用上次目录，
否则回落默认值。**所以是换牌改了应用身份导致的"失忆"，不是安装器损坏。**

### 三、修复

在 `apps/desktop/build/installer.nsh` 新增 `preInit` 宏（该钩子位于标准初始化之前）：

1. 当前 appId 的记忆键为空时，读取**换牌前 GUID 键**的 `InstallLocation`
2. 确认该目录**确实存在**（`FileExists "\*.*"`）后，把它**写入当前记忆键**
3. 之后 electron-builder 的标准流程会像处理正常升级一样使用它

同时对 `HKCU`（按用户安装）与 `HKLM`（按机器安装）各处理一次。
只在新键为空、且旧目录真实存在时生效——**不会覆盖已存在的 TM Agent 安装位置**。

### 四、验证

启动重新打包的安装器，其"安装目录"字段实测为：

```
D:\Ai\Deepseek\DSERKAI\DeepSeek Harness
```

即**已正确继承换牌前用户选择的目录**。

### 五、本轮产物

| 项 | 值 |
|---|---|
| 安装包 | `TM-Agent-Windows-x64-0.1.0-rc.19-Setup.exe` |
| 大小 | 174118010 字节 |
| SHA256 | `290aec528520cdfc7e975f6f3818a07aa0bc99146b841e9d2698fb5aebfc6b6f` |

### 六、说明

- 该继承是**一次性的**：本次安装会把位置写入新记忆键，此后 TM Agent 的升级/重装
  都由 electron-builder 原生逻辑沿用，无需再次继承。
- 从**换牌前的旧版**升级的用户同样受益（不会突然落到默认目录）。
- 旧版本目录（如本例的 `D:\Ai\Deepseek\DSERKAI\DeepSeek Harness`）内的旧程序文件
  会由安装器按既有的"预览版替换"逻辑清理。

*记录人：ZCode（Pier）· 2026-09-12*
