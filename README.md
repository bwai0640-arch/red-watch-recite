> **原作：叛逆蓝牙 · 二创：眼泪斷了线**
>
> 本项目为非官方二创，不代表原作者、`redwatch.top` 或任何相关权利人的官方发行或认可。原素材相关权利归其权利人所有；如权利人认为仓库内容存在侵权或署名问题，请通过 GitHub Issue 联系维护者，核实后将及时调整或删除。

# 背书自习监督

“背书自习监督”是 Windows 64 位本地背书与安静自习监督桌面应用。它只使用麦克风；不使用摄像头、不需要网络账号，也不保存或上传原始录音。背书模式会在本机验证登记用户的声纹；自习模式用本地 CED Mini 音频事件模型区分键盘与持续的人声、音乐、电视/广播等媒体声音。

作者角色与署名边界见 [作者与署名](AUTHORS.md)，媒体素材的来源和公开边界见 [资产来源与权利说明](docs/ASSET_PROVENANCE.md)。

当前本地版本为 1.11.1，发布日期为 2026-07-21。

## 本地成品与 GitHub 仓库

本地交付物构建在 `release-staging/`：安装版为 `背书自习监督-安装版-<version>.exe`，便携版为 `背书自习监督-便携版-<version>.exe`。GitHub 仓库包含构建所需源码、22 段动画、22 份对应源音轨、应用图标、本地声纹模型和本地音频事件模型；EXE 不直接提交进 Git 历史。

`.gitignore` 默认排除 `node_modules/`、`dist/`、`release-staging/`、所有 `RedWatchReciteData/`、本地 `work/`、真实 `.env`、日志和缓存。真人测试语音、加密声纹、用户运行数据及本地审查产物不会进入公开仓库。该策略只防止未跟踪文件被首次加入；若文件已经进入 Git 历史，仍须另行清理历史并重新审查。

不要移动、提交、分享或清理 `%APPDATA%\背书自习监督` 中的 `speaker-profile.dat`；它可能是用户真实录入的加密声纹。公开仓库、commit 历史和 Release 附件都不得包含声纹档案、用户运行数据或真人测试录音。

## 核心行为

- 可在检测面板选择用于测试、学习与录入的麦克风；选择会仅保存在本机。
- 可为同一人保存最多 5 份麦克风/环境声纹模板。每份模板均通过麦克风连续录入 24 秒生成，运行时匹配任一模板即可。
- 开始学习前可在检测面板测试当前设置；测试复用对应模式的正式判定链路，但不计时、不播放动画或音轨，也不触发提醒。
- 背书模式的音量条白色门槛线可直接拖动或用方向键粗调，并与抗噪滑块和 VAD 同步。自习模式只显示麦克风原始 RMS 活动强度，不创建或使用 `AdaptiveVad`，并隐藏门槛线、抗噪滑块和环境底噪重校准；该数值只供观察，不参与分类。
- 背书模式只有确认到本人的声音才清零静默计时；提醒阈值可在 20～60 秒内调节。
- 自习模式不要求声纹，也不做 3 秒环境底噪校准或音量门槛筛选；打开麦克风后直接用本地 CED Mini 分析最近约 2 秒声音，首个有效结果约需 2 秒，之后约每 1 秒更新。连续阳性窗口会抵扣重叠，任一阴性窗口立即清空候选；单独键盘声不累计，键盘与媒体标签同时出现时仍按媒体证据判断。用户只调 3～15 秒的媒体持续时间。
- 背书每 20 分钟、自习每 45 分钟获得一张 2 分钟休息券；可立即休息或在本次会话内攒下。
- 背书每 45 分钟、自习每 60 分钟播放一次带源音轨的表扬序列，并显示不遮挡教官的字幕。
- 正常巡查、观察和路过静音；开场、结束、违规、表扬及休息结束后的开场播放对应动画自己的源音轨。
- 隐藏到后台后，违规仍恢复原来的主窗口；只有休息券使用一个右下角独立提示窗。
- 场景按 1920×1080 等比例展示，屏幕不足时整体缩小，不拉伸源动画。
- 主窗口可拖动和缩放；右上角依次为最小化、最大化/还原、隐藏到后台，双击标题栏也可最大化/还原。安全最小尺寸为 960×540。

## 开发环境

依赖版本由 `package.json` 和 `pnpm-lock.yaml` 固定：

- Electron 43.1.0
- electron-builder 26.15.3
- sherpa-onnx-node 1.13.4
- CAM++ 本地声纹模型
- CED Mini 本地音频事件模型

CED Mini INT8 ONNX 取自 k2-fsa/sherpa-onnx 音频标签模型转换包。该包 README 只说明转换自 RicherMans/CED，没有明确精确 checkpoint 与转换文件的逐文件许可；项目因此不把任一上游页面的许可直接写成该 ONNX 的确定许可。哈希、相关上游声明与公开分发限定见 [第三方软件声明](THIRD_PARTY_NOTICES.md) 和模型目录中的 `SOURCE_README.md`。

当前已验证的开发环境为 Node.js 24.14.0 与 pnpm 11.7.0；Electron 43.1.0 要求 Node.js 至少为 22.12.0。请使用 Node.js 22.12.0 或更高版本，并确保 `node` 与 `pnpm` 已加入 PATH。

在 Node.js 已加入 PATH 的普通开发机上：

```powershell
cd <仓库目录>
pnpm install --frozen-lockfile
pnpm start
```

公开仓库包含运行与构建所需媒体、图标和模型，但不包含 `work/speaker-fixtures/` 中的本地真人测试语音，也不提交音频事件模型的临时正样本。依赖真人 fixture 的声纹模型/UI 测试只供维护者在合规数据准备完成后运行。1.11.1 取消自习底噪/门槛后的后台纯 Node 门禁已通过，覆盖策略、背书 VAD 对抗、声纹服务、CED 模型基础检查，以及临时音乐、人声和真实键盘 fixture；临时 fixture 已删除。安装版和便携版已在隔离目录构建并完成解包内容/隐私核对。按用户要求没有启动 Electron、UI/CDP、候选 EXE、真实麦克风或用户声纹，因此不能把后台结果写成完整 UI 候选已通过。

## 构建

不要在已经含有用户数据的 `dist` 或 `release-staging` 上直接运行 `pnpm dist`；electron-builder 可能清理输出目录。正式构建必须先输出到 `work/` 下全新的隔离候选目录，验证通过后再只把两个 EXE 和说明书复制到 `release-staging`，完整流程见 [发布清单](docs/RELEASE.md)。

公开仓库包含完整媒体和图标，可按上述流程启动并构建。正式 `背书自习监督.exe` 不提交到 Git 历史，后续作为 GitHub Release 附件单独提供。

## 源码导航

| 路径 | 职责 |
|---|---|
| `main.js` | Electron 主进程、主窗口、休息提示窗、托盘、本地协议、权限、声纹与音频事件 IPC |
| `preload.js`、`break-prompt-preload.js` | 分别向主页面与休息提示页暴露相互隔离的最小 API |
| `renderer/app.js` | 双模式用户流程、VAD、声纹复核、休息与场景总状态机 |
| `renderer/study-policy.js` | 模式阈值、有效学习时钟、休息/表扬里程碑和安静自习判定 |
| `renderer/scene-rules.js` | 动画计划、巡查池、里程碑表扬和三级违规的唯一事实源 |
| `renderer/media-player.js` | 精灵图、源音轨和无黑屏连续播放 |
| `speaker-service.js` | 声纹档案、阈值、加密、原子写入和 Worker RPC |
| `profile-crypto.js` | 通过当前 Windows 用户的 DPAPI 加密/解密声纹档案；明文仅经子进程标准输入传递 |
| `speaker-worker.js` | Sherpa/CAM++ 推理、音频质量和动态检查 |
| `audio-event-service.js`、`audio-event-worker.js` | CED Mini 本地音频事件推理与隔离的 Worker RPC |
| `scripts/` | 静态、声纹、音频事件、媒体和 UI 对抗测试 |

## 文档

- [架构](docs/ARCHITECTURE.md)
- [测试](docs/TESTING.md)
- [发布](docs/RELEASE.md)
- [GitHub 发布前审计](docs/GITHUB_RELEASE_AUDIT.md)
- [资产来源与权利说明](docs/ASSET_PROVENANCE.md)
- [作者与署名](AUTHORS.md)
- [版本记录](CHANGELOG.md)
- [第三方软件声明](THIRD_PARTY_NOTICES.md)
- [Apache License 2.0 全文](LICENSES/Apache-2.0.txt)
