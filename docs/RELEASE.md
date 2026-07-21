# 背书自习监督本地安装版发布清单

## 红线

- 正式安装版的用户数据位于 `%APPDATA%\背书自习监督`；其中可能含真实 `speaker-profile.dat`。不得读取、复制、移动、删除或打包该文件。
- 构建只能输出到 `D:\RedWatchRecite\release-staging`，不得覆盖现有 `dist` 或已安装的应用。
- 本文仅覆盖用户自用的本地安装包。上传 GitHub 仍须重新执行单独的公开发布隐私检查。

## 1. 构建前

- 确认用户已从托盘退出背书自习监督。
- 确认 `release-staging` 中没有正在运行的候选实例。
- 不触碰旧便携版的 `RedWatchReciteData`，也不迁移其中的声纹档案。
- 确认 `package.json`、`CHANGELOG.md`、`docs/USER_GUIDE.md` 的版本号一致。

## 2. 构建安装版与便携版

先解析可用 Node；不要把个人用户目录写进仓库：

```powershell
$node = '<工作区依赖定位结果中的 Node.js executable>'
cd D:\RedWatchRecite
& $node '.\node_modules\electron-builder\cli.js' --win nsis --config.directories.output=release-staging
& $node '.\node_modules\electron-builder\cli.js' --win portable --config.directories.output=release-staging --config.win.artifactName='背书自习监督-便携版-${version}.${ext}'
```

候选安装包应为：

`D:\RedWatchRecite\release-staging\背书自习监督-安装版-<version>.exe`

候选便携版应为：

`D:\RedWatchRecite\release-staging\背书自习监督-便携版-<version>.exe`

electron-builder 还会生成 `release-staging\win-unpacked\背书自习监督.exe`，它只用于隔离 UI 验证，不能作为交付文件保留。

## 3. 验证

- 按 `docs/TESTING.md` 以 `SUPERVISION_DATA_DIR` 指向临时隔离目录。
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

## 5. 交付与卸载

- 交付 `背书自习监督-安装版-<version>.exe`、`背书自习监督-便携版-<version>.exe` 与 `使用说明.md`。
- 安装器允许用户选择 D 盘安装目录；默认按当前用户安装，并建立桌面和开始菜单快捷方式。
- 卸载时保留 `%APPDATA%\背书自习监督`，避免误删声纹。用户明确不需要保留时，才手动删除该目录。
- 不得把 `win-unpacked`、构建日志、旧 EXE 或测试数据目录作为最终交付物。
