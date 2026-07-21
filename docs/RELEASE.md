# 背书自习监督本地安装版发布清单

## 红线

- 正式安装版的用户数据位于 `%APPDATA%\背书自习监督`；其中可能含真实 `speaker-profile.dat`。不得读取、复制、移动、删除或打包该文件。
- 构建只能输出到新建的隔离候选目录，不得让 electron-builder 直接清理 `release-staging`、现有 `dist` 或已安装的应用。`release-staging` 可能带有旧便携版的 `RedWatchReciteData`，只能在候选通过检查后复制两个 EXE 和说明书，绝不能整目录清理。
- 本文仅覆盖用户自用的本地安装包。上传 GitHub 仍须重新执行单独的公开发布隐私检查。
- 自习分类用 PCM、音频事件标签和概率不得写入日志、测试报告、用户数据或发布包；发布包只能包含模型、标签表和来源声明，不能包含运行时采样。

## 1. 构建前

- 确认用户已从托盘退出背书自习监督。
- 确认 `release-staging` 中没有正在运行的候选实例。
- 不触碰旧便携版的 `RedWatchReciteData`，也不迁移其中的声纹档案。
- 确认 `package.json`、`CHANGELOG.md`、`docs/USER_GUIDE.md` 的版本号一致。
- 核对 `models/audio-tagging-ced-mini/SOURCE_README.md` 中模型和标签 SHA-256；保留“k2-fsa 转换 ONNX 的精确 checkpoint/许可尚未由随包 README 明确”的限定，不能把任一上游页面的许可直接写成该转换文件的确定许可。

## 2. 构建安装版与便携版

先解析可用 Node；不要把个人用户目录写进仓库：

```powershell
$node = '<工作区依赖定位结果中的 Node.js executable>'
cd D:\RedWatchRecite
$candidate = 'work\release-candidate-1.11.1'
if (Test-Path -LiteralPath $candidate) { throw "候选目录已存在，请换一个全新目录：$candidate" }
& $node '.\node_modules\electron-builder\cli.js' --win nsis --config.directories.output=$candidate
& $node '.\node_modules\electron-builder\cli.js' --win portable --config.directories.output=$candidate --config.win.artifactName='背书自习监督-便携版-${version}.${ext}'
```

隔离候选安装包应为：

`D:\RedWatchRecite\work\release-candidate-<version>\背书自习监督-安装版-<version>.exe`

候选便携版应为：

`D:\RedWatchRecite\work\release-candidate-<version>\背书自习监督-便携版-<version>.exe`

electron-builder 还会在隔离候选目录生成 `win-unpacked\背书自习监督.exe`；本轮不运行 UI，只做包内容检查，完成后不把该目录复制到交付目录。

## 3. 验证

- 按 `docs/TESTING.md` 以 `SUPERVISION_DATA_DIR` 指向临时隔离目录。
- 先完成不启动 Electron、窗口、托盘、真实麦克风或真实声纹的后台纯 Node 门禁。本轮用户正在桌面工作时禁止运行 UI/CDP；UI 候选验证只能在用户明确允许后或独立 Windows 会话/虚拟机中进行。
- `audio-event-model-smoke.cjs` 必须以 `BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES=1` 运行发布门禁，读取临时官方媒体 fixture 和至少 3 份来源明确的真实键盘 fixture；fixture 不提交、不打包，验证结束后从临时目录清理。
- 验证自习完全不创建或使用 `AdaptiveVad`，没有 3 秒底噪校准、音量/sensitivity 门槛或重校准路径；白色门槛线、抗噪滑块和重校准按钮均隐藏，音量条只显示原始 RMS 且不得参与分类。
- 验证自习直接进入最近约 2 秒滚动窗口、约 1 秒更新、首次有效分类约需 2 秒；键盘单独不累计，键盘与媒体双证据仍累计。静音/耳机、极端掩蔽和合法课程误判边界必须保留在用户说明中。
- 验证自习应用链路不传入 gap 容忍参数：任一阴性分类窗口立即清空候选，连续阳性仍抵扣约 1 秒滚动窗口重叠。
- 验证休息后的有声开场结束时，背书仍重新校准约 3 秒，自习直接恢复分类并重新形成约 2 秒首窗。
- 验证两个窗口都使用禁用缓存的内存会话；正常退出后隔离数据根中不得残留 `TransientElectronData`、`SessionData`、`Code Cache`、`GPUCache`。
- 验证安装版的名称、窗口标题、托盘名称、桌面和开始菜单快捷方式都是“背书自习监督”。
- 验证首次安装不会读取旧便携版声纹；首次背书前需由用户主动重新录入。

## 4. 生成说明和校验值

```powershell
$artifacts = Get-Item -LiteralPath `
  'D:\RedWatchRecite\release-staging\背书自习监督-安装版-<version>.exe', `
  'D:\RedWatchRecite\release-staging\背书自习监督-便携版-<version>.exe'
$artifacts | Select-Object Name,Length,@{n='Version';e={$_.VersionInfo.FileVersion}}
$artifacts | Get-FileHash -Algorithm SHA256
Copy-Item -LiteralPath 'D:\RedWatchRecite\docs\USER_GUIDE.md' -Destination 'D:\RedWatchRecite\release-staging\使用说明.md' -Force
```

将实际字节数和 SHA-256 写入 `docs/USER_GUIDE.md`，随后再次复制说明到 `release-staging\使用说明.md`，并确认两份文件哈希一致。

1.11.1 实际校验值：

- 安装版：286,465,178 字节；SHA-256 `4F7CE4674E48E5772D5CDC5DFC10FB3DDC1C7F09DE53EECE2226A157FDDC4E2B`；文件版本 `1.11.1`；`NotSigned`。
- 便携版：275,770,933 字节；SHA-256 `F9F66EB0891A48D0A7EC5C1D0CDE4FA71B78ECD1CD02C16828B19EC5DF2E7817`；文件版本 `1.11.1`；`NotSigned`。

## 5. 交付与卸载

- 交付 `背书自习监督-安装版-<version>.exe`、`背书自习监督-便携版-<version>.exe` 与 `使用说明.md`。
- 安装器允许用户选择 D 盘安装目录；默认按当前用户安装，并建立桌面和开始菜单快捷方式。
- 卸载时保留 `%APPDATA%\背书自习监督`，避免误删声纹。用户明确不需要保留时，才手动删除该目录。
- 不得把 `win-unpacked`、构建日志、旧 EXE 或测试数据目录作为最终交付物。
- 解包检查 `app.asar`/`app.asar.unpacked`：不得出现临时音频 fixture、PCM、分类输出或用户声纹；必须包含 CED Mini 模型、AudioSet 标签表、`SOURCE_README.md` 与根目录第三方声明。
