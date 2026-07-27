# 凛冬督学局本地发布清单

## 红线

- 正式安装版继续使用 `%APPDATA%\背书自习监督` 这个稳定旧数据根；可见产品名改为“凛冬督学局”后也不迁移或改名，以免升级后丢失或重复录入声纹。其中可能含真实 `speaker-profile.dat`，不得读取、复制、移动、删除或打包该文件。
- 同一数据根内的 `study-preferences.json` 可能含用户自定义麦克风标签，只能留在本机，不得读取内容、复制或打包；发布包只包含负责校验设置的 `study-settings-policy.js`。
- 正式构建只能调用 `scripts/build-release.cjs`（`pnpm dist` 只是该脚本的入口），禁止直接调用 electron-builder。包装器只输出到版本对应的全新隔离候选目录，并拒绝清理或覆盖 `release-staging`、现有 `dist`、已有候选或已安装应用。`release-staging` 可能带有旧便携版的 `RedWatchReciteData`，只能在候选通过检查后定点复制两个 EXE 和说明书，绝不能整目录清理。
- 本文仅覆盖用户自用的本地安装包。上传 GitHub 仍须重新执行单独的公开发布隐私检查。
- 自习分类用 PCM、音频事件标签和概率不得写入日志、测试报告、用户数据或发布包；发布包只能包含模型、标签表和来源声明，不能包含运行时采样。

## 1. 构建前

- 确认用户已从托盘退出凛冬督学局。
- 确认 `release-staging` 中没有正在运行的候选实例。
- 不触碰旧便携版的 `RedWatchReciteData`，也不迁移其中的声纹档案。
- 确认 `package.json`、`CHANGELOG.md`、`docs/USER_GUIDE.md` 的版本号一致。
- 确认 Git 工作树完全干净；安全包装器会拒绝未提交或未跟踪的修改。
- 确认 `work\release-candidate-1.13.4` 不存在。包装器不会覆盖旧候选；需要重建时必须先人工核对旧目录是否仍被进程或审查引用，再选择新的、明确的处置。
- 核对 `models/audio-tagging-ced-mini/SOURCE_README.md` 中模型和标签 SHA-256；保留“k2-fsa 转换 ONNX 的精确 checkpoint/许可尚未由随包 README 明确”的限定，不能把任一上游页面的许可直接写成该转换文件的确定许可。

## 2. 构建安装版与便携版

先解析可用 Node；不要把个人用户目录写进仓库。唯一受支持的命令如下：

```powershell
$node = '<工作区依赖定位结果中的 Node.js executable>'
cd D:\RedWatchRecite
$candidate = 'work\release-candidate-1.13.4'
if (Test-Path -LiteralPath $candidate) { throw "候选目录已存在，拒绝覆盖：$candidate" }
if (git status --porcelain=v1 --untracked-files=all) { throw 'Git 工作树不干净，拒绝正式构建。' }
& $node '.\scripts\build-release.cjs'
```

不得复制脚本内部的 electron-builder 命令到终端单独运行。包装器会依次构建安装版和便携版，确认两次构建嵌入相同的 `app.asar`，核对构建前后 Git 跟踪输入没有变化，并自动运行 `release-package-static-test.cjs`；任一步失败都不能把目录当成候选发布。

1.13.4 隔离候选安装包应为：

`D:\RedWatchRecite\work\release-candidate-1.13.4\凛冬督学局-安装版-1.13.4.exe`

候选便携版应为：

`D:\RedWatchRecite\work\release-candidate-1.13.4\凛冬督学局-便携版-1.13.4.exe`

隔离候选目录还会生成 `win-unpacked\凛冬督学局.exe`；本轮不运行 UI，只做包内容检查，完成后不把该目录复制到交付目录。

## 3. 验证

- 按 `docs/TESTING.md` 以 `SUPERVISION_DATA_DIR` 指向临时隔离目录。
- 先完成不启动 Electron、窗口、托盘、真实麦克风或真实声纹的后台纯 Node 门禁。本轮用户正在桌面工作时禁止运行 UI/CDP；UI 候选验证只能在用户明确允许后或独立 Windows 会话/虚拟机中进行。
- 后台门禁至少包含 `window-mode-policy-test.cjs`、`study-settings-policy-test.cjs`、`floating-window-source-test.cjs`、`cache-cleanup-policy-test.cjs`、`build-release-policy-test.cjs`、`worker-timeout-test.cjs` 与 `adversarial-user-simulation-test.cjs`：严格核对后台偏好、64 KiB 设置上限、提醒编号、同主窗口、顶层 no-drag 悬停操作、漂浮拖缩、缓存链接、Worker 超时、菜单、黄色动画状态和刁难用户场景。
- `audio-event-model-smoke.cjs` 必须以 `BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES=1` 运行发布门禁，读取临时官方媒体 fixture 和至少 3 份来源明确的真实键盘 fixture；fixture 不提交、不打包，验证结束后从临时目录清理。
- 验证整个用户界面均不存在底噪/抗噪滑块、白色门槛线、漂浮窗底噪条或手动重校准；主界面活动条只显示原始 RMS，漂浮布局不显示音量条。背书用户端只保留 20～60 秒未检测到本人提醒时间，自习用户端只保留 3～15 秒媒体持续时间。
- 验证背书固定使用内部 8 dB 余量的自动环境适应和高召回 VAD 分段，CAM++ 仍是本人终判。最初约 3 秒被朗读污染时噪声基线采用保守上限，适应结束后 300 ms 内恢复候选；正式学习中改变提醒时间不得清空已累计未确认时长或在途声纹候选。
- 验证 `speakerVerificationPending` 时提醒入口无条件返回；声纹 Worker 单次推理 4.5 秒、渲染侧 5 秒保护任一超时都应安全停止且不计违规，不能在模型卡住时先播放处罚动画。声音分类 Worker 5 秒超时也必须终止并标记服务不可用。
- 验证旧设置中的 `reciteSensitivityDb` 在载入时被忽略、不会影响 VAD，并在下一次正常保存设置时被移除；固定 8 dB 余量不得出现在任何持久化文件中。
- 验证自习完全不创建或使用 `AdaptiveVad`，麦克风打开后直接进入 CED Mini，不经过自动环境适应或音量 gate；主界面 RMS 数值不得参与分类。
- 验证自习直接进入最近约 2 秒滚动窗口、约 1 秒更新、首次有效分类约需 2 秒；人声阈值 0.12，音乐/通用媒体阈值 0.20，并覆盖电视、广播、游戏和常见媒体音效；键盘单独不累计。静音/耳机、极端掩蔽和合法课程误判边界必须保留在用户说明中。
- 验证孤立阴性分类窗口只进入恢复确认，连续正常 5 秒才清空候选；5 秒内媒体恢复沿用原累计，连续阳性仍抵扣约 1 秒滚动窗口重叠。
- 验证休息后的有声开场结束时，背书重新自动适应环境约 3 秒，自习直接恢复分类并重新形成约 2 秒首窗。
- 验证两个窗口都使用禁用缓存的内存会话；正常退出后隔离数据根中不得残留 `TransientElectronData`、`SessionData`、`Code Cache`、`GPUCache`。缓存清理遇到符号链接或目录联接时只能解除链接本身，根外哨兵文件必须保留。
- 验证安装版的名称、窗口标题、托盘名称、桌面和开始菜单快捷方式都是“凛冬督学局”。
- 验证完整场景切到漂浮窗时仍是同一 `webContents` 与 Canvas、窗口总数不增加；漂浮窗用 Windows 原生约束在 224×170～320×225 间缩放并保存尺寸，实时缩放不得用 `will-resize` 强改位置。悬停操作层必须是 `body` 下的顶层固定 `no-drag` 元素，不能嵌在 44 像素拖动状态栏内；状态、计时和动画区可拖，两个按钮必须通过真实 Windows 左键命中。置顶/跳过任务栏；常态和未达阈值时只有判断与动画，只有红色异常文案才带秒数；悬停显示“已学习”、隐藏和放大，“隐藏”进入完全后台，取消双击放大。
- 验证“隐藏到后台”按钮的 hover/focus 菜单不会与其他按钮堆叠，Escape 能关闭；两种选择立即生效且旧异步选择不能覆盖新选择。
- 验证动画期间所有可见状态副本统一显示黄色“好好学！盯着你呢！”，不出现“检测暂停”或违规红色。
- 验证 `window-preferences.json` 只含 `backgroundMode` 与 `floatingWindowSize`，不保存位置、检测结果、学习时长、音频、声纹或个人信息；只读取不超过 64 KiB 的非空普通文件。
- 验证 `study-preferences.json` 除固定格式版本外只含 `mode`、20～60 秒、3～15 秒和选定麦克风 `deviceId`/`label`；只读取不超过 64 KiB 的非空普通文件，额外字段必须拒绝，原子写入后不得出现音频、声纹、检测结果、学习记录或计时。已选设备缺失时必须保留原 ID/标签并提示，不能按同名设备或系统默认设备自动替换。
- 验证 `speaker-profile.dat` 只读取 1 字节～4 MiB 的普通文件；损坏、无法解密或超限档案 fail closed 并可在用户确认后删除，有效档案不得走残留删除入口。录入会话 ID 在取消后立即失效，保存/删除故障回滚，回滚失败停止声纹服务。
- 验证应用只允许一个实例；第二次启动恢复既有主窗口。主窗口和托盘先于模型初始化完成；休眠/恢复/锁屏/解锁、麦克风轨道中断、5 秒无 PCM、自习 10 秒全零采样会安全停止而非触发违规。渲染器崩溃或持续无响应会取消在途录入、清理孤儿休息提示并重建待命窗口。
- 验证退出前最多等待 2.5 秒完成已经发起的设置与窗口状态写入；重新启动后最后一次成功选择不丢失。
- 验证正式包 DevTools 关闭、远程调试端口/管道启动参数被移除，且即使设置 `SUPERVISION_TEST_HOOKS=1` 也不暴露 `window.__beishuTest`。带内部钩子的 UI 测试只对未打包源码实例运行。
- 验证 `scene / hidden / floating` 触发非致命提醒后分别返回原状态；旧提醒编号、非法枚举或额外字段不得改变当前窗口。
- 验证首次安装不会读取旧便携版声纹；首次背书前需由用户主动重新录入。

## 4. 生成说明和校验值

```powershell
$artifacts = Get-Item -LiteralPath `
  'D:\RedWatchRecite\work\release-candidate-1.13.4\凛冬督学局-安装版-1.13.4.exe', `
  'D:\RedWatchRecite\work\release-candidate-1.13.4\凛冬督学局-便携版-1.13.4.exe'
$artifacts | Select-Object Name,Length,@{n='Version';e={$_.VersionInfo.FileVersion}}
$artifacts | Get-FileHash -Algorithm SHA256
```

将实际字节数和 SHA-256 写入本文件。候选完整通过后，再定点复制这两个 EXE，并把 `docs/USER_GUIDE.md` 复制为 `release-staging\使用说明.md`；确认两份说明完全一致。用户说明不承载构建哈希、内部算法阈值或测试日志。

1.13.4 在本次文档同步时尚未完成隔离候选构建；不得在此预填大小、SHA-256、签名状态、`app.asar` 项数或说明书哈希。实际构建和静态验包完成后再补充，并与 `docs/GITHUB_RELEASE_AUDIT.md` 的附件事实一致。

1.13.3 隔离候选已于 2026-07-27 完成后台静态核对，未启动任何 EXE：

- 安装版：286,475,613 字节；SHA-256 `B213920D929266FC995AE560E9EF4E01B480305AB045F7D797A006E68EC47E15`；FileVersion/ProductVersion `1.13.3`；Authenticode `NotSigned`。
- 便携版：275,807,614 字节；SHA-256 `603CDF42EB855B4389EC3701D37A9285B7EF2E3608D88B4E951922B9F501CD62`；FileVersion/ProductVersion `1.13.3`；Authenticode `NotSigned`。
- `app.asar` 355 项，`app.asar.unpacked` 31 个文件；19 个核心源码与当前工作树逐字节哈希一致；22 段动画、22 份对应源音轨及两套本地模型完整；禁止项 0。
- `USER_GUIDE.md` 与待复制的 `release-staging/使用说明.md` 内容 SHA-256 应为 `262E54046F8113C83357F5EDC5B9A7E253C9921A02909C80F5FE4AE80C1C8209`；交付目录最终只允许两份 1.13.3 EXE 和该说明书。

1.13.2 隔离候选已于 2026-07-26 完成后台静态核对，未启动任何 EXE：

- 安装版：286,475,560 字节；SHA-256 `759DBE6F470A51888CD923DDA30823C7E9B4355652323988C3A08B31D8CED72C`；FileVersion/ProductVersion `1.13.2`；Authenticode `NotSigned`。
- 便携版：275,806,123 字节；SHA-256 `74148C63DC3716EBF30845775B1B3FF5440DCFDCCA28C804BD52C32DE78D73EF`；FileVersion/ProductVersion `1.13.2`；Authenticode `NotSigned`。
- `app.asar` 355 项，`app.asar.unpacked` 31 个文件；19 个核心源码与当前工作树逐字节哈希一致；22 段动画、22 份对应源音轨及两套本地模型完整；禁止项 0。
- `USER_GUIDE.md` 与 `release-staging/使用说明.md` 内容一致，SHA-256 均为 `1039D545C1725CF95BB3359A2EAF3FC72E005A45BF56F7ACD1CFC01025A0F3CB`；交付目录最终仅含两份 1.13.2 EXE 和该说明书。

1.13.1 隔离候选已于 2026-07-26 完成后台静态核对，未启动任何 EXE：

- 安装版：286,475,279 字节；SHA-256 `7E59AFFD7E34BC033102E2F80C109639A818BD3C1B76EA3ECCB9CC035A7F2D9D`；FileVersion/ProductVersion `1.13.1`；Authenticode `NotSigned`。
- 便携版：275,802,516 字节；SHA-256 `0ED9D48814F6335F175F1FADF98082C672FE9EE2F21242BE64602CA4C11BE34D`；FileVersion/ProductVersion `1.13.1`；Authenticode `NotSigned`。
- `app.asar` 355 项，`app.asar.unpacked` 31 个文件；19 个核心源码与当时工作树逐字节哈希一致；22 段动画、22 份对应源音轨及两套本地模型完整；禁止项 0。
- `USER_GUIDE.md` 与 `release-staging/使用说明.md` 内容一致，SHA-256 均为 `4048470A621BCB7579ED67A7F9C57B741680083778D7091A873BC98A95F8D915`；交付目录最终仅含两份 1.13.1 EXE 和该说明书。

1.13.0 隔离候选已于 2026-07-22 完成后台静态核对，未启动任何 EXE：

- 安装版：286,476,167 字节；SHA-256 `2528DAE227FA9B192A8FC4E93F2E15720AC90BAD0A01CC88D0DE79D6EAA56069`；FileVersion/ProductVersion `1.13.0`；Authenticode `NotSigned`。
- 便携版：275,808,923 字节；SHA-256 `0F563B123B2953D88CB99B92A34DA760D141F11F5A3B3FE3D29CB590F571FC2D`；FileVersion/ProductVersion `1.13.0`；Authenticode `NotSigned`。
- `app.asar` 355 项，`app.asar.unpacked` 31 个文件；19 个核心源码与当时工作树逐字节哈希一致；22 段动画、22 份对应源音轨及两套本地模型完整；禁止项 0。
- `USER_GUIDE.md` 与 `release-staging/使用说明.md` 内容一致，SHA-256 均为 `145744264C3D629E8B7D5B5E7E42A1295390722C7E042C3DDA23F51C6F122D47`；交付目录最终仅含两份 1.13.0 EXE 和该说明书。

## 5. 交付与卸载

- 交付 `凛冬督学局-安装版-<version>.exe`、`凛冬督学局-便携版-<version>.exe` 与 `使用说明.md`。
- 安装器允许用户选择 D 盘安装目录；默认按当前用户安装，并建立桌面和开始菜单快捷方式。
- 卸载时保留 `%APPDATA%\背书自习监督`，避免误删声纹。用户明确不需要保留时，才手动删除该目录。
- 不得把 `win-unpacked`、构建日志、旧 EXE 或测试数据目录作为最终交付物。
- 解包检查 `app.asar`/`app.asar.unpacked`：不得出现临时音频 fixture、PCM、分类输出或用户声纹；必须包含 CED Mini 模型、AudioSet 标签表、`SOURCE_README.md` 与根目录第三方声明。
