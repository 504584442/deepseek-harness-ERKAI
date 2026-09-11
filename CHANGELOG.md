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
