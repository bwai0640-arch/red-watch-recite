# GitHub 首次发布前审计

审计日期：2026-07-15  
审计对象：`D:\RedWatchRecite` 的实际 Git 暂存面

## 当前结论

完整可构建仓库已经在本地准备：当前分支为 `codex/github-release-prep`，暂存面包含源码、文档、CAM++ 模型、应用图标、22 段动画和 22 份对应源音轨。正式 EXE、真人测试语音、声纹档案、用户运行数据和构建缓存均未进入 Git。

本次审计以首次公开提交前的暂存面为基线；审计时尚无 commit、remote 或 push。本机没有运行 GitGuardian，因此结论明确保留该工具缺口，不把本地扫描表述为 GitGuardian 通过。

## 实际暂存面

- 暂存文件：316 个。
- `renderer/media/`：267 个文件，约 142.07 MiB，单文件最大 997,698 字节。
- `assets/`：2 个图标文件。
- CAM++ ONNX 模型：28,281,164 字节。
- remote：0。
- commit：0，因此历史状态为 `no-commits`。

`.gitignore` 和实际暂存清单共同确认以下内容被排除：

- `dist/`、`release-staging/` 和所有 EXE；
- 根目录及任意嵌套的 `RedWatchReciteData/`；
- 任意 `speaker-profile.dat*`；
- `work/` 中的真人测试语音和本地审查产物；
- 真实 `.env`、日志、缓存、临时文件及 `node_modules/`。

## 敏感信息扫描

使用 `github-upload-safety` 扫描实际当前文件与暂存索引，单文件上限提高到 40,000,000 字节以覆盖 ONNX 模型。扫描结果：316 个文件发现、316 个完成检查、缺失 0、`BLOCK=0`、`REVIEW=32`、`INCOMPLETE=0`；其中 247 个为二进制媒体、图标或模型文件。

32 项 `REVIEW` 已逐项人工核对：

- `package.json` 的项目 `name` 字段；
- `pnpm-lock.yaml` 中第三方 `glob` 包的公开弃用说明邮箱；
- HTML 的 `meta name` 与 `theme-color` 字段；
- JavaScript 中错误类的 `name` 属性和声纹管理器的参数名。
- `renderer/media/catalog.json` 中 22 个动画显示名称字段；
- `E3_enter_rush/manifest.json` 中被电话号码启发式规则误命中的 SHA-256 十六进制串。

这些位置不是用户隐私、真实测试数据或应用凭据，也没有发现硬编码密钥。扫描器仍按保守规则保留 `REVIEW`；创建首个 commit 后必须再次扫描真实历史和提交邮箱。

首个本地 commit 创建后已再次扫描：当前文件树与 Git 历史各出现同一组 32 项保守 `REVIEW`，因此总数为 64；`BLOCK=0`、`INCOMPLETE=0`，历史检查状态为 `complete`。提交历史共 1 个 commit，非 `noreply` 邮箱计数为 0；这些重复项仍是上文已人工核对的字段名、第三方公开维护邮箱、动画名称和 SHA-256 误报。

GitGuardian 状态为“未运行”：本机没有 `ggshield` CLI，也没有配置其 API 凭据。不能把内置本地扫描结果表述为 GitGuardian 通过。

## 权利与公开说明

公共仓库不将本项目描述为原作者或 `redwatch.top` 的官方发行、共同维护或认可。README、作者页和资产页统一使用以下原则：

- 原作：叛逆蓝牙；二创：眼泪斷了线。
- 原素材相关权利归其权利人所有。
- 如权利人认为内容存在侵权或署名问题，可通过 GitHub Issue 联系维护者；核实后将及时调整或删除。

项目保持 `UNLICENSED`，只能称为公开可查看的非官方二创源码，不能称为采用某个开源许可证的项目。GitHub 公共仓库允许其他用户查看和 fork；如未来添加 LICENSE，必须另行审查可授予的权利范围。

## GitHub 文件大小核对

GitHub 普通 Git 对单个对象强制限制为 100 MB；当前仓库最大普通媒体文件不足 1 MiB，ONNX 模型约 27 MiB，均低于限制。仓库媒体约 142.07 MiB，可直接进入普通 Git；本次不额外引入 Git LFS。

正式 EXE 为 268,309,572 字节（约 255.88 MiB），不提交进 Git 历史，后续作为 GitHub Release 附件发布。GitHub 当前允许每个 Release 附件小于 2 GiB，因此该 EXE 在尺寸范围内。

## Release EXE 隐私检查

对 1.8.0 正式 EXE 的实际 7z/ASAR 内容做了只读检查：`app.asar` 共 345 个条目，未包含 `RedWatchReciteData`、`speaker-profile.dat`、`work/`、真人录音、`.env`、日志、`dist/` 或 `release-staging/`。对解包文本再次搜索高置信密钥、邮箱、个人用户目录和数据库连接串，结果均为 0。

正式 EXE 的 SHA-256 为 `79282B193B071774125EF6B998C44304757683987AFD32D60F0ABA4CC0E341CF`；文件版本与产品版本均为 1.8.0。PE 元数据只包含应用名及公开署名“原作：叛逆蓝牙 · 二创：眼泪斷了线”，未包含真实姓名、真实邮箱或本机用户名。该文件未进行数字签名，不能将其描述为已签名安装包。

官方限制说明：

- [Repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits)
- [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## 提交与上传规则

1. 提交署名使用“眼泪斷了线”，邮箱使用 GitHub 账号 `bwai0640-arch` 对应的 ID 型 `noreply` 地址，不公开真实邮箱。
2. 公开仓库使用 `bwai0640-arch/red-watch-recite`，并保持 Issues 可用，作为权利人提出侵权或署名异议的联系渠道。
3. 创建或修改 commit 后重新扫描真实历史、提交者邮箱与实际文件树；GitGuardian 未运行时继续明确披露。
4. 只有最终门禁无 `BLOCK/INCOMPLETE` 时，才 push 并上传经过独立隐私检查的正式 EXE。
