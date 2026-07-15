# 凛冬督学局发布清单

## 红线

`dist/RedWatchReciteData` 可能含真实用户声纹。不要在该目录上直接运行默认的 `pnpm dist`，不要为了“干净打包”删除用户数据，也不要在用户仍运行凛冬督学局时替换 EXE。

## 1. 发布前检查

- 要求用户从托盘退出凛冬督学局。
- 确认没有进程从 `D:\RedWatchRecite\dist` 或其 `%TEMP%` 便携解包目录运行。
- 不打开、不解密、不复制 `speaker-profile.dat`；只确认整个数据目录继续存在。
- 运行 `docs/TESTING.md` 中的静态与隔离 UI 测试。
- 确认 `package.json`、`CHANGELOG.md` 和用户说明的版本号一致。
- 确认 README 首屏与应用标题下都显示原作和二创署名；README 同时保留非官方声明、权利归属和 GitHub Issue 联系删除说明。

## 2. 构建到 staging

先解析可用 Node。Codex 环境应使用工作区依赖定位结果，不要把个人用户目录写进文档：

```powershell
$node = '<工作区依赖定位结果中的 Node.js executable>'
```

使用 electron-builder 已支持的点号配置覆盖输出目录：

```powershell
cd D:\RedWatchRecite
& $node '.\node_modules\electron-builder\cli.js' --win portable --config.directories.output=release-staging
```

`package.json` 的 `build.electronDist` 指向本地 `node_modules/electron/dist`，用于复用已安装 Electron，避免打包时依赖在线下载。

构建完成后，候选程序应为：

`D:\RedWatchRecite\release-staging\凛冬督学局.exe`

## 3. 隔离验证候选

- 不连接当前 `dist/凛冬督学局.exe`。
- 按 `docs/TESTING.md` 将候选复制到独立临时目录。
- 对候选运行 smoke、speaker UI 和完整 adversarial；adversarial 必须包含标题栏三键、双击、隐藏恢复、同一窗口身份和 16:9 检查。
- 确认版本、主窗口/休息提示窗、960×540 最小尺寸、媒体、双模式阈值、休息流程、声音策略和用户数据清理。

## 4. 更新发布说明

计算候选元数据：

```powershell
$candidate = Get-Item -LiteralPath 'D:\RedWatchRecite\release-staging\凛冬督学局.exe'
$hash = Get-FileHash -LiteralPath $candidate.FullName -Algorithm SHA256
$candidate | Select-Object Name,Length,@{n='Version';e={$_.VersionInfo.FileVersion}}
$hash
```

更新源码侧权威说明 `docs/USER_GUIDE.md`：

- 版本号与绝对发布日期。
- EXE 字节数和 MiB。
- SHA-256。
- 行为、隐私或兼容性变化。

随后复制为发布副本，并验证两份文本完全相同：

```powershell
Copy-Item -LiteralPath 'D:\RedWatchRecite\docs\USER_GUIDE.md' -Destination 'D:\RedWatchRecite\dist\使用说明.md' -Force
(Get-FileHash 'D:\RedWatchRecite\docs\USER_GUIDE.md').Hash
(Get-FileHash 'D:\RedWatchRecite\dist\使用说明.md').Hash
```

## 5. 替换正式 EXE

只有在用户已经退出、候选全部通过后，才替换：

`D:\RedWatchRecite\dist\凛冬督学局.exe`

不得替换、删除或清空：

`D:\RedWatchRecite\dist\RedWatchReciteData`

替换后重新计算正式 EXE 的大小和 SHA-256，必须与说明书一致。

## 6. 清理与最终审查

`dist` 顶层只保留：

1. `凛冬督学局.exe`
2. `使用说明.md`
3. `RedWatchReciteData/`

删除 staging、`win-unpacked`、`builder-debug.yml` 和明确属于本次构建的临时副本前，必须先验证绝对路径在项目或测试目录内，并确认没有相关进程。使用原生 PowerShell `Remove-Item -LiteralPath`，不要跨 shell 拼接路径执行递归删除。

最终核对：

- `FileVersion`、`ProductVersion` 与 `package.json` 相同。
- 正式 EXE 大小和 SHA-256 与两份说明一致。
- 项目中除依赖和明确的隔离测试目录外，只存在一个正式 EXE。
- 用户数据目录原样保留。
- `%TEMP%` 中没有仍在运行的候选实例；搜索历史可能仍显示已删除路径，这不代表磁盘上仍有旧版。
- `README.md`、`AGENTS.md`、架构、测试、发布和资产文档没有过期路径或相对时间。

## 7. GitHub 发布是另一道门禁

本地替换 `dist` 成品不等于允许向 GitHub 公开源码、媒体或 EXE。任何 `git init`、首次暂存、remote、push 或 Release 上传之前，必须单独完成：

- 确认项目已经处于可扫描的 Git 仓库中，再检查工作树、实际待提交清单、全部历史、remote、提交者姓名/邮箱和敏感信息；“不是 Git 仓库”只能记为 `INCOMPLETE`，不能记为扫描通过。
- 保持 `.gitignore` 对所有 `RedWatchReciteData`、`speaker-profile.dat*`、`work/`、`dist/`、`release-staging/`、真实 `.env`、日志和缓存的排除。
- 当前公开范围包含 `renderer/media/`、应用图标和后续 Release 中的 EXE；README、作者页、资产页与 Release 说明统一保留非官方声明、权利归属及 GitHub Issue 联系调整或删除方式，不作官方发行或认可表述。
- 核验“原作：叛逆蓝牙 · 二创：眼泪斷了线”的署名准确性；本地真人测试语音继续排除，不得进入 Git 历史、发布包或 Release 附件。
- 重新运行 GitHub 发布安全扫描；若 GitGuardian 不可用，必须明确写成工具未运行，并使用其他本地扫描结果补充，不能声称 GitGuardian 已通过。

GitHub 发布目标为 `bwai0640-arch/red-watch-recite`。提交与 Release 均使用同一套隐私门禁；不得因为源码已通过扫描，就跳过对实际 commit 历史或 EXE 附件的单独检查。

2026-07-15 的本地门禁结论、实际暂存面扫描范围和未解决项见 `docs/GITHUB_RELEASE_AUDIT.md`。该记录不能替代首次 commit 后对真实历史与提交者信息的再次扫描。
