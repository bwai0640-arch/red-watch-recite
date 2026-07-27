# 凛冬督学局测试说明

## 总原则

- 静态测试可以在项目根直接运行。
- UI/CDP 测试必须使用隔离的数据目录和独立调试端口。
- `speaker-ui-test.mjs` 与 `adversarial-ui-test.mjs` 会调用 `deleteSpeakerProfile()` 并退出被测应用，绝不能连接真实用户正在使用的安装版。
- 不要读取、复制或删除真实 `%APPDATA%\背书自习监督\speaker-profile.dat` 来“准备测试”。这个旧数据根在产品改名为“凛冬督学局”后仍刻意保留，不能把路径中的旧名误判为待迁移项。
- 1.13.4 本轮只在当前桌面运行后台纯 Node 测试：不启动 Electron、候选 EXE、窗口、托盘、CDP/UI，不申请真实麦克风，也不读取真实声纹。后台结果不能替代候选包静态门禁或独立 Windows 会话中的原生窗口测试。

## Node 路径

普通开发机应将 Node.js 加入 PATH，然后设置：

```powershell
$node = (Get-Command node -ErrorAction Stop).Source
```

Codex 桌面环境中，先使用工作区依赖定位能力获取 Node 路径，再赋给 `$node`。不要把个人用户目录写进文档或程序逻辑，例如：

```powershell
$node = '<工作区依赖定位结果中的 Node.js executable>'
```

该绝对路径只代表当前机器，不应写进程序逻辑。

## 静态与服务测试

这些测试不会访问真实 `%APPDATA%\背书自习监督` 数据目录：

```powershell
cd D:\RedWatchRecite
& $node --check renderer\app.js
& $node --check main.js
& $node --check preload.js
& $node --check window-mode-policy.js
& $node --check break-prompt-preload.js
& $node --check audio-event-service.js
& $node --check audio-event-worker.js
& $node scripts\profile-crypto-test.cjs
& $node scripts\scene-rules-test.cjs
& $node scripts\study-policy-test.cjs
& $node scripts\vad-adversarial-test.cjs
& $node scripts\audio-event-policy-test.cjs
& $node scripts\audio-event-model-smoke.cjs
& $node scripts\speaker-audio-test.cjs
& $node scripts\speaker-model-test.cjs
& $node scripts\speaker-service-test.cjs
& $node scripts\speaker-runtime-policy-test.cjs
& $node scripts\study-settings-policy-test.cjs
& $node scripts\study-settings-source-test.cjs
& $node scripts\window-mode-policy-test.cjs
& $node scripts\floating-window-source-test.cjs
& $node scripts\media-preload-policy-test.cjs
& $node scripts\cache-cleanup-policy-test.cjs
& $node scripts\build-release-policy-test.cjs
& $node scripts\adversarial-user-simulation-test.cjs
& $node scripts\worker-timeout-test.cjs
```

覆盖范围：

| 脚本 | 重点 |
|---|---|
| `scene-rules-test.cjs` | 开场/结束、随机池、30～120 秒、25% 独立事件、三级违规、仅预览资源 |
| `study-policy-test.cjs` | 双模式阈值、有效学习时钟、休息券/表扬里程碑和自习累计状态机 |
| `vad-adversarial-test.cjs` | 背书模式固定 8 dB、高召回 VAD、稳态风扇、朗读污染的保守噪声上限及适应后 300 ms 恢复；自习模式不得引用该 VAD 结果 |
| `audio-event-policy-test.cjs` | CED 人声 0.12、音乐/通用媒体 0.20、常见媒体音效集合、键盘单独放行、3～15 秒阈值、重叠抵扣、5 秒漏窗恢复和设置变更作废旧 generation |
| `audio-event-model-smoke.cjs` | 纯 Node 加载实际 CED Mini；静音与合成键盘负样本；可选临时官方媒体和真实键盘混音正样本 |
| `speaker-audio-test.cjs` | 重采样、24 秒、8 个 2.4 秒窗口、动态范围 |
| `speaker-model-test.cjs` | 打印 3 个身份 fixture 的相似度矩阵；该脚本没有完整阈值断言 |
| `speaker-service-test.cjs` | mic-only、8 选 6、0.55/0.70、加密档案形态、污染候选、损坏/超 4 MiB 档案 fail closed 与确认删除、录入取消/删除事务回滚，以及实际 CAM++ 两秒本人/他人快速门槛 |
| `speaker-runtime-policy-test.cjs` | 2 秒严格快速门槛、2.4 秒标准兜底、停声竞态、多模板最佳匹配，以及正式阈值不降低 |
| `profile-crypto-test.cjs` | 当前 Windows 用户 DPAPI 的加密、非明文保存与跨独立子进程解密；不读写用户声纹档案 |
| `study-settings-policy-test.cjs` / `study-settings-source-test.cjs` | 设置白名单、原子保存、64 KiB 文件上限、非普通文件/损坏回退、设备缺失不静默替换和退出前写入链 |
| `window-mode-policy-test.cjs` | `hidden/floating` 严格参数、提醒编号/返回处置、多屏负坐标、224×170～320×225 尺寸钳制/持久化、64 KiB 偏好上限、系统指针窗口内判定，以及偏好原子覆盖与损坏回退 |
| `floating-window-source-test.cjs` | 同主窗口/Canvas、顶层悬停操作层、拖动区与按钮显式 no-drag、漂浮窗无音量/底噪控件、hover/focus 后台菜单、取消双击放大、黄色动画状态和提醒原状态返回的源码门禁；它不能证明 Windows 原生命中层真的传递鼠标点击 |
| `media-preload-policy-test.cjs` | 图集预载边界、失败释放与媒体缓存上限 |
| `cache-cleanup-policy-test.cjs` | 清理根/`run-<pid>` 路径白名单、符号链接/目录联接不跟随和外部哨兵文件保留 |
| `build-release-policy-test.cjs` | 干净 Git、全新候选目录、`dist`/`release-staging` 保护、跟踪输入哈希与静态验包调用 |
| `worker-timeout-test.cjs` | 模拟不回应的 Worker，验证声纹约 4.5 秒、声音分类约 5 秒后终止、拒绝遗留请求并标记服务不可用 |
| `adversarial-user-simulation-test.cjs` | 连续/断续视频、4/5 秒恢复边界、键盘/风扇/纯游戏音效，1+2 自习分类队列、麦克风健康、声纹在途禁止处罚/失败关闭，以及漂浮缩放、多屏、偏好损坏、单实例/恢复、菜单和黄色文案等刁难用户场景 |
| `release-package-static-test.cjs <candidate-root>` | 不运行 EXE，直接核对候选 `app.asar` 的版本、核心源码与提示页/Worklet 哈希、22 段动画/22 份源音轨、模型/原生依赖、正式包测试钩子/DevTools 门禁和用户数据排除项 |

`speaker-service-test.cjs` 只使用并清理 `work/speaker-service-test-data-<pid>`。若修改该路径，必须重新确认不会指向用户数据。

### 1.13.4 本轮验证边界

2026-07-27 本轮后台检查与模型 fixture 结果只以实际终端输出为准。当前桌面没有启动 Electron、UI/CDP、候选 EXE、窗口、托盘、真实麦克风或真实声纹，因此不把源码断言写成真实界面实测。1.13.4 候选完成隔离构建后，再由 `RELEASE.md` 记录解包、核心源码哈希、禁止项、文件大小与 SHA-256；构建前不得沿用 1.13.3 数值。

“刁难用户”审查至少覆盖：

- 在状态、计时和动画区域拖动，按钮点击不误拖；多屏/负坐标钳制后窗口仍可找回。
- 把漂浮窗缩到 224×170、放到 320×225，反复进出并重启恢复；非法偏好钳制且不崩溃。
- hover、focus、Escape 与快速选择两种后台方式时，菜单不黏住、不与按钮堆叠，旧异步选择不覆盖新选择。
- 动画期间主状态、底部状态、预检状态和漂浮状态均显示黄色精确文案，结束后恢复实时判断。
- 背书界面、折叠/展开面板和漂浮布局均不存在底噪/抗噪滑块、白色门槛线或手动重校准；旧 `reciteSensitivityDb` 不参与检测并在下次保存后消失。
- 用稳定风扇、正常朗读和“最初约 3 秒已经朗读”的污染序列验证固定 8 dB VAD：风扇不形成候选，朗读污染后噪声基线受保守上限保护，适应完成后的语音候选在 300 ms 内恢复。
- 视频“播放—暂停不足 5 秒—继续”不重置；连续正常满 5 秒才清；键盘单独/风扇放行，语音、音乐和常见音效达到阈值。
- 漂浮、隐藏和完整场景中触发提醒、休息、结束与异常时返回正确状态，不新增违规窗口。
- 漂浮窗拖动与缩放均不拦截 Windows 原生手势；缩放到任意合法尺寸后继续拖动仍保持宽高。常态和未达阈值时只显示判断与动画，只有红色异常判断才在原句中带累计秒数；悬停后必须完整显示“已学习时长 / 隐藏 / 放大”，“隐藏”进入完全后台。
- 多份声纹分别匹配；严格 2 秒快速门槛只接受高置信样本，未通过者保留 PCM 并回落 2.4 秒标准复核，停声后也会触发已满足长度的兜底。
- 录入在准备、采集、推理和保存阶段均可取消；旧会话 ID 的完成请求不能写入档案，保存或删除故障必须回滚，回滚失败须停用服务。
- 自习 Worker 变慢时只保留 1 个在途和 2 个有序等待窗口；超量、声纹 4.5 秒超时或分类 5 秒超时均安全停止，不处罚用户、不接受迟到结果。
- 麦克风轨道静音/结束、AudioContext 停止、5 秒无 PCM、10 秒数字全零、电脑休眠/恢复/锁屏/解锁、渲染器崩溃/无响应和退出写入竞态都回到可理解、可重新开始的状态；渲染器恢复还必须销毁孤儿休息提示。
- 两个设置文件只读取不超过 64 KiB 的普通文件，声纹只读取不超过 4 MiB 的普通文件；符号链接或目录联接不能把缓存清理引向数据根外。

本轮只能用策略/源码后台测试覆盖可自动部分；真实指针、窗口观感、黑帧和按钮堆叠仍待独立 Windows 会话或虚拟机，不能声称已实测。`mode-rest-ui-test.mjs` 的浮窗回归会实际移动系统光标并发送 Windows 原生左键点击，能够发现 CDP 合成点击绕过原生拖动层的问题，但会干扰当前桌面，禁止在用户工作会话中运行。

### 1.12.0 本轮后台结果

2026-07-22 已完成且通过以下不触碰桌面的门禁：

- `main.js`、`preload.js`、`renderer/app.js`、`window-mode-policy.js` 语法检查；
- `window-mode-policy-test.cjs` 与 `floating-window-source-test.cjs`；
- 隔离构建 1.12.0 安装版和便携版，文件版本、大小、SHA-256 与 `NotSigned` 状态核对；
- `release-package-static-test.cjs`：`app.asar` 354 项、unpacked 31 个文件、22 段动画、22 份源音轨、6 个核心源码哈希一致、禁止项 0；
- 漂浮偏好测试只写入系统临时目录，结束后删除；不读取或改写用户声纹、正式偏好、麦克风或音频。

`mode-rest-ui-test.mjs` 已补充同 `webContents` 漂浮窗口、320×225 布局、无音量条、16:9 Canvas、真实鼠标悬停后的“已学习”计时/两个操作、漂浮→提醒→漂浮返回、隐藏与放大，以及全部原生窗口能力恢复断言；按用户要求没有运行，避免窗口抢占桌面。

### 1.11.1 后台结果

2026-07-21 已完成且通过以下不触碰桌面的门禁：

- 核心 JavaScript 文件语法检查；
- `study-policy-test.cjs`、`vad-adversarial-test.cjs`、`audio-event-policy-test.cjs`；
- `audio-event-model-smoke.cjs` 的无 fixture 基础检查；
- 强制真实 fixture 的 CED Mini 检查：5 份 ESC-50 键盘样本、4 组键盘与音乐强度混合、5 组键盘与人声混合，失败数为 0。
- `profile-crypto-test.cjs`、`scene-rules-test.cjs`、`speaker-audio-test.cjs`、`speaker-model-test.cjs` 与使用隔离 `work/speaker-service-test-data` 的 `speaker-service-test.cjs`；
- 1.11.1 安装版与便携版的后台构建、版本/SHA-256 核对和 `app.asar` 解包内容检查。

临时 fixture 与解包检查目录均在验证后删除。Electron、UI/CDP、真实麦克风、真实声纹、候选 EXE 运行和窗口布局没有运行，仍属待验证项。

### CED Mini 发布候选正样本门禁

不带 fixture 运行 `audio-event-model-smoke.cjs` 只能证明模型可加载、静音不误报、合成键盘不误报，不能证明真实媒体在响键盘下仍能识别。发布当前候选前必须额外运行一次强制正样本门禁：

```powershell
$env:BEISHU_AUDIO_EVENT_FIXTURES = '<临时解压的 sherpa-onnx 官方 audio-tagging test_wavs 目录>'
$env:BEISHU_KEYBOARD_FIXTURES = '<至少 3 份来源明确、仅用于本地测试的真实键盘 WAV 目录>'
$env:BEISHU_SPEECH_FIXTURE = '<临时下载的 sherpa-onnx Obama.wav>'
$env:BEISHU_SPEECH_OFFSET_SECONDS = '0'
$env:BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES = '1'
& $node scripts\audio-event-model-smoke.cjs
Remove-Item Env:BEISHU_AUDIO_EVENT_FIXTURES, Env:BEISHU_KEYBOARD_FIXTURES, Env:BEISHU_SPEECH_FIXTURE, Env:BEISHU_SPEECH_OFFSET_SECONDS, Env:BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES
```

音乐正样本来自 sherpa-onnx CED Mini 转换包的 `test_wavs/3.wav`，人声正样本从 sherpa-onnx 示例 `Obama.wav` 的起始位置读取；偏移省略或设为 `0`，超出文件范围必须报错，不能静默生成全零样本。真实键盘负样本可从 ESC-50 每个 fold 各取一份 `Keyboard typing` 样本。ESC-50 使用 CC BY-NC 3.0，仅用于本机临时回归，不随项目再分发。所有 fixture 都只从临时目录读取，不播放、不改写，不得提交 Git、打进 EXE、复制到 `release-staging` 或用户数据目录。测试需覆盖媒体单独播放、键盘峰值高于媒体以及真实键盘与音乐/人声混音；键盘单独不得累计，键盘与媒体同时存在时不得被键盘标签放行。

## 隔离启动开发版

本节会创建 Electron 进程，即使使用 `-WindowStyle Hidden` 仍可能产生窗口、焦点或托盘副作用。用户正在桌面工作时不要运行；本轮 1.13.4 明确跳过本节及后续全部 UI/CDP 脚本。

为每个 UI 测试创建新的数据目录和端口：

```powershell
cd D:\RedWatchRecite
$port = 9333
$testData = Join-Path $env:TEMP "redwatch-ui-$([guid]::NewGuid().ToString('N'))"
$env:SUPERVISION_DATA_DIR = $testData
$env:SUPERVISION_TEST_HOOKS = '1'
$electron = Resolve-Path '.\node_modules\electron\dist\electron.exe'
$app = Start-Process -FilePath $electron -ArgumentList @('.', "--remote-debugging-port=$port") -WindowStyle Hidden -PassThru
```

`SUPERVISION_TEST_HOOKS=1` 只在 `app.isPackaged === false` 的源码实例生效；正式包即使继承同名环境变量也不会暴露 `window.__beishuTest`，DevTools 固定关闭，远程调试端口/管道启动参数也会被移除。使用内部钩子的测试只能验证这次明确启动的源码实例，不能改连安装版或候选 EXE。

在第二个 PowerShell 中使用同一个端口运行一个测试：

```powershell
& $node scripts\cdp-smoke.mjs 9333
```

上述端口参数适用于 `cdp-smoke.mjs`、`media-runtime-test.mjs`、`speaker-ui-test.mjs`、`adversarial-ui-test.mjs` 和 `capture-ui.mjs`。`mode-rest-ui-test.mjs` 是例外：它不接收外部端口，而是自行保留随机端口、创建 `work/mode-rest-ui-*` 隔离目录并启动源码 Electron；应直接运行：

```powershell
& $node scripts\mode-rest-ui-test.mjs
```

不要先启动候选 EXE 再把端口传给 `mode-rest-ui-test.mjs`，否则该脚本仍会测试自己启动的源码实例，外部候选也不会由它关闭。

结束后确认该测试实例退出，再为下一个测试创建新的数据目录、端口和进程。不要让测试脚本连接端口不明的现有应用。

## CDP/UI 脚本

| 脚本 | 适用对象 | 是否主动退出 | 是否删除被测声纹 | 覆盖范围 |
|---|---|---:|---:|---|
| `cdp-smoke.mjs` | 显式启用钩子的隔离源码实例 | 否 | 否 | 初始场景、22 资源、主窗口身份、无视频元素 |
| `media-runtime-test.mjs` | 显式启用钩子的隔离源码实例 | 否 | 否 | 3092 帧、222 图集、22 音轨哈希和接缝连续性 |
| `speaker-ui-test.mjs` | 显式启用钩子的隔离源码实例 | 是 | 是 | 纯麦克风录入、本人/他人、无摄像头、按钮不重叠 |
| `adversarial-ui-test.mjs` | 显式启用钩子的隔离源码实例 | 是 | 是 | 完整场景状态机、音轨分级、表扬字幕、同主窗口违规、无黑屏，以及标题栏三键/双击/隐藏回归 |
| `mode-rest-ui-test.mjs` | 自行启动的隔离源码实例；只能在独立桌面/虚拟机 | 是 | 是 | 双模式阈值、待命测试、录入取消、主面板出声条、署名、窗口/休息/异常清理，以及用真实系统光标和原生左键验证浮窗“隐藏/放大”命中 |
| `capture-ui.mjs` | 显式启用钩子的隔离源码实例 | 否 | 否 | 截取待命或提醒界面用于人工布局核对 |

表中 `mode-rest-ui-test.mjs` 的“主动退出”和“删除被测声纹”只针对它自行创建的隔离源码实例。

不主动退出的脚本完成后，可只停止记录下来的测试主进程：

```powershell
if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id }
```

确认没有仍指向 `$testData` 的测试进程后，才可删除这个隔离目录。不要按进程名批量结束“凛冬督学局”，因为用户可能正在运行正式版。

## 候选包与安装版验证

不得直接测试用户已安装的凛冬督学局。1.13.4 候选首先运行不执行 EXE 的静态门禁：

```powershell
& $node scripts\release-package-static-test.cjs `
  'D:\RedWatchRecite\work\release-candidate-1.13.4'
```

正式包不开放 DevTools，也不响应 `SUPERVISION_TEST_HOOKS`，因此不能把上述源码 UI 脚本改连 `win-unpacked`，更不能为了测试重新打开正式包钩子。候选窗口若要做黑盒人工验证，必须在独立 Windows 会话或虚拟机中，以全新的 `SUPERVISION_DATA_DIR` 启动并使用真实鼠标/键盘；只观察公开界面、托盘、窗口行为和数据目录，不能依赖 `window.__beishuTest`。验证结束后先退出候选并确认没有该目录进程，再删除隔离数据。

黑盒候选至少核对启动先出现主窗口、单实例恢复、浮窗真实点击/拖缩、休息提示、提醒同窗返回、休眠/锁屏安全停止和正常退出。数据目录不得出现 `SessionData`、`Code Cache` 或 `GPUCache`；只有用户主动完成隔离录入时才允许出现测试用 `speaker-profile.dat`。

## 发布前矩阵

至少确认：

- 静态与声纹服务测试全部通过。
- 显式启用钩子的隔离源码实例通过 smoke、media、speaker UI 和完整 adversarial；`mode-rest-ui-test.mjs` 仅在允许移动系统光标的独立 Windows 会话/虚拟机运行。
- `work\release-candidate-1.13.4` 必须通过 `release-package-static-test.cjs`；正式包不含测试钩子、DevTools 关闭。候选黑盒窗口验证如未在独立会话执行，必须明确列为未验证，不能用源码 UI 结果代替。
- 初始界面先显示“开始学习”，提醒不会抢先出现；主学习面板的出声状态始终可见。
- 开始前测试使用 audio-only 正式链路。背书测试先自动适应环境约 3 秒，再走高召回 VAD 与 CAM++；候选采集最多宽限 3 秒，CAM++ 已开始复核时禁止处罚，服务端 4.5 秒或渲染侧 5 秒超时必须安全停止且未计违规。自习测试不得创建 `AdaptiveVad` 或等待环境适应，直接收集约 2 秒首个 CED Mini 窗口；单个 Worker 请求 5 秒超时，并且只能有 1 个在途与最多 2 个有序等待窗。测试达到条件只能显示预期提醒提示，不能改变正式会话状态。
- 背书和自习的折叠/展开界面都不得存在白色门槛线、底噪/抗噪 range 或重校准按钮，漂浮布局也不得存在底噪条。两条主界面音量活动条只显示原始 RMS，数值不得直接作为 CAM++ 终判或输入 CED Mini/`QuietModeDetector`。运行时 VAD 余量固定为 8 dB，不序列化；载入含 `reciteSensitivityDb` 的旧设置后必须忽略该值，并在下一次保存时移除字段。
- 正式背书中改变 20～60 秒提醒时间不得重置未确认计时或在途候选；正式自习中改变 3～15 秒持续时间不得把已经形成的媒体证据清零。只有待命预检为便于重新观察，才允许重置本次预检显示/累计。
- 自习预检首次有效分类约需 2 秒，之后约每 1 秒更新；三个连续阳性窗口抵扣重叠后只能累计约 2 秒，第四个才可达到 3 秒阈值。预检中改变持续时间时，旧分类缓冲、在途 generation、锁定和累计必须立即清零，并能从新的约 2 秒窗口重新暖机；正式学习中只更新阈值并保留已有证据。自习不存在音量/sensitivity 修改路径。
- 背书无声纹时不能伪装成本人检测；停止测试、开始学习、切换模式、声纹录入、最小化/隐藏窗口和退出都必须释放测试音频流，正式开始后最多只有一条麦克风音轨。选中的麦克风必须持久化，且待命测试与正式链路均使用其精确 `deviceId`。
- 声纹服务须保留最多五份同一用户模板；删除一份后其余模板仍可识别，schema 2 单份档案可安全载入为“原有声纹”。录入全程可取消且旧会话 ID 不能完成保存；录入/删除失败必须回滚 Worker、内存和磁盘。损坏或超 4 MiB 的无效档案可确认删除，有效档案不能走残留删除入口。
- 使用当前 Windows 用户的 DPAPI 加密一份隔离声纹档案后，必须能由新的 Node/PowerShell 子进程解密；测试不得接触真实 `speaker-profile.dat`。
- 在待命测试仍占用麦克风时，快速连点“开始学习/动画预览/声纹录入”必须只有先取得互斥状态的流程继续；其他流程不得打开第二条音频流。预览结束后模式和声纹按钮必须恢复可用。
- README 开头和应用标题下都能看到“原作：叛逆蓝牙 · 二创：眼泪斷了线”，960×540 下署名、预检按钮和状态不得与其他控件重叠。
- 主窗口标题栏可拖动、双击最大化/还原；最小化、最大化/还原和隐藏到后台三键均可用，顺序正确，960×540 下不与模式按钮或页面按钮重叠。
- 主窗口、子 frame 与休息提示页不能越权调用不属于自己的 IPC；新窗口和非预期导航会被拒绝。
- 应用只能取得一个实例锁；第二次启动恢复既有主窗口。默认只有一个主窗口；休息提示出现时恰好两个窗口且不替换主 webContents；违规仍恢复同一个主窗口。模型初始化较慢时主窗口和托盘已经出现，界面保持可响应。
- 背书阈值 20～60 秒、自习媒体证据阈值 3～15 秒均正确钳制；键盘单独不累计，键盘与媒体双证据仍累计；孤立阴性分类窗保留候选，连续正常 5 秒才清除，5 秒内媒体恢复沿用原累计，连续阳性仍抵扣约 1 秒滚动窗口重叠。
- 背书 20 分钟、自习 45 分钟各获得一张两分钟休息券；休息不计时，结束后主窗前台且只播放一次有声 `E1 → S1 → X1`。背书随后自动适应环境约 3 秒；自习直接恢复分类并等待约 2 秒首窗，不能出现环境适应阶段。
- 普通动画静音；开场、结束、违规、里程碑表扬和休息恢复音轨与画面一一对应。
- 表扬字幕位于下侧且不遮挡教官或按钮；背书每 45 分钟、自习每 60 分钟触发。
- 无摄像头、无音频导入、无黑帧、无按钮重叠。
- 主场景和休息提示均使用 `cache: false` 的内存会话，退出后隔离数据目录不出现 `SessionData`、`Code Cache` 或 `GPUCache`；只有用户主动录入时才允许存在 `speaker-profile.dat`。
- `study-preferences.json`、`window-preferences.json` 的空文件、目录、链接、损坏和超过 64 KiB 输入均安全回退；声纹超过 4 MiB 不读取。退出请求最多等待 2.5 秒完成已发起设置写入，重新启动后最后一次成功设置不丢失。
- `TransientElectronData/run-<pid>` 清理只作用于精确目标；符号链接/目录联接只移除链接本身，根外哨兵文件和真实数据目录保持不变。
- 麦克风轨道中断、5 秒无 PCM、自习 10 秒数字全零、休眠/恢复/锁屏/解锁、渲染器崩溃或持续无响应时安全停止或重建待命窗口，不产生违规、不遗留半完成录入或孤儿休息提示。
- 自习分类的 PCM、标签和概率只存在于渲染器、IPC 与 Worker 内存中；隔离数据目录、日志、报告和发布包不得出现分类输入或运行结果。静音视频、耳机输出、极端声学掩蔽与合法课程音频的边界必须在发布说明中保留。
- 媒体或窗口 IPC 失败后回到 `idle`，麦克风、有效时钟、遮罩和置顶提醒状态均被清理。
- 测试结束后隔离 profile、麦克风流和进程均被清理。
