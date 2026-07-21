# 背书自习监督测试说明

## 总原则

- 静态测试可以在项目根直接运行。
- UI/CDP 测试必须使用隔离的数据目录和独立调试端口。
- `speaker-ui-test.mjs` 与 `adversarial-ui-test.mjs` 会调用 `deleteSpeakerProfile()` 并退出被测应用，绝不能连接真实用户正在使用的安装版。
- 不要读取、复制或删除真实 `%APPDATA%\背书自习监督\speaker-profile.dat` 来“准备测试”。

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
& $node --check break-prompt-preload.js
& $node scripts\profile-crypto-test.cjs
& $node scripts\scene-rules-test.cjs
& $node scripts\study-policy-test.cjs
& $node scripts\vad-adversarial-test.cjs
& $node scripts\speaker-audio-test.cjs
& $node scripts\speaker-model-test.cjs
& $node scripts\speaker-service-test.cjs
```

覆盖范围：

| 脚本 | 重点 |
|---|---|
| `scene-rules-test.cjs` | 开场/结束、随机池、30～120 秒、25% 独立事件、三级违规、仅预览资源 |
| `study-policy-test.cjs` | 双模式阈值、有效学习时钟、休息券/表扬里程碑、自习连续人声策略 |
| `vad-adversarial-test.cjs` | 稳态风扇、真人响应、键盘瞬态、VAD 尾音与连续原始人声边界 |
| `speaker-audio-test.cjs` | 重采样、24 秒、8 个 2.4 秒窗口、动态范围 |
| `speaker-model-test.cjs` | 打印 3 个身份 fixture 的相似度矩阵；该脚本没有完整阈值断言 |
| `speaker-service-test.cjs` | mic-only、8 选 6、0.55/0.70、加密档案形态、污染候选、损坏档案 fail closed |
| `profile-crypto-test.cjs` | 当前 Windows 用户 DPAPI 的加密、非明文保存与跨独立子进程解密；不读写用户声纹档案 |

`speaker-service-test.cjs` 只使用并清理 `work/speaker-service-test-data`。若修改该路径，必须重新确认不会指向用户数据。

## 隔离启动开发版

为每个 UI 测试创建新的数据目录和端口：

```powershell
cd D:\RedWatchRecite
$port = 9333
$testData = Join-Path $env:TEMP "redwatch-ui-$([guid]::NewGuid().ToString('N'))"
$env:SUPERVISION_DATA_DIR = $testData
$electron = Resolve-Path '.\node_modules\electron\dist\electron.exe'
$app = Start-Process -FilePath $electron -ArgumentList @('.', "--remote-debugging-port=$port") -WindowStyle Hidden -PassThru
```

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

| 脚本 | 是否主动退出 | 是否删除被测声纹 | 覆盖范围 |
|---|---:|---:|---|
| `cdp-smoke.mjs` | 否 | 否 | 初始场景、22 资源、主窗口身份、无视频元素 |
| `media-runtime-test.mjs` | 否 | 否 | 3092 帧、222 图集、22 音轨哈希和接缝连续性 |
| `speaker-ui-test.mjs` | 是 | 是 | 纯麦克风录入、本人/他人、无摄像头、按钮不重叠 |
| `adversarial-ui-test.mjs` | 是 | 是 | 完整场景状态机、音轨分级、表扬字幕、同主窗口违规、无黑屏，以及候选包标题栏三键/双击/隐藏回归 |
| `mode-rest-ui-test.mjs` | 是 | 是 | 双模式阈值、待命检测测试、主面板出声条、双作者署名、960×540 原生最小尺寸、标题栏三键/双击、独立休息提示窗、休息恢复和异常清理 |
| `capture-ui.mjs` | 否 | 否 | 截取待命或提醒界面用于人工布局核对 |

表中 `mode-rest-ui-test.mjs` 的“主动退出”和“删除被测声纹”只针对它自行创建的隔离源码实例。

不主动退出的脚本完成后，可只停止记录下来的测试主进程：

```powershell
if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id }
```

确认没有仍指向 `$testData` 的测试进程后，才可删除这个隔离目录。不要按进程名批量结束“背书自习监督”，因为用户可能正在运行正式版。

## 安装版验证

不得直接测试用户已安装的背书自习监督。NSIS 构建生成的 `win-unpacked` 仅用于隔离候选验证；安装器本体需要在人工确认后安装到单独目录：

```powershell
$candidateRoot = 'D:\RedWatchRecite\release-staging\win-unpacked'
$testData = Join-Path $env:TEMP "study-supervisor-ui-$([guid]::NewGuid().ToString('N'))"
$env:SUPERVISION_DATA_DIR = $testData
Start-Process -FilePath (Join-Path $candidateRoot '背书自习监督.exe') -ArgumentList '--remote-debugging-port=9444' -WindowStyle Hidden
```

只对这个候选运行 CDP/UI 测试。退出并确认没有从该目录运行的进程后，再删除 `$testData`。安装版的主窗口和休息提示都必须使用内存会话：`webContents.session.storagePath` 为 `null`，且测试数据目录中不得出现 `SessionData`、`Code Cache` 或 `GPUCache`。

## 发布前矩阵

至少确认：

- 静态与声纹服务测试全部通过。
- 开发版 smoke、media、speaker UI、完整 adversarial 通过。
- staging 安装版的 `win-unpacked` 候选至少通过 smoke、speaker UI 和完整 adversarial；窗口外壳检查必须实际连接候选包，不能只测源码。
- 初始界面先显示“开始学习”，提醒不会抢先出现；主学习面板的出声状态始终可见。
- 开始前测试使用 audio-only 正式链路；滑块在测试中实时生效。背书测试必须与正式会话共享最多 3 秒的在途声纹验证宽限；最终达到阈值只能显示预期提醒提示，不能改变 `active`、有效时长、提醒次数、生命值、场景轨迹或音轨轨迹。
- 检测面板收起时，常驻音量条白线仍可通过 pointer 和键盘改变设置；两条白线、range、ARIA、localStorage、VAD 与 `QuietModeDetector` 必须同步，位置按当前底噪与相对灵敏度换算。
- 自习预检先达到 3 秒阈值再改为 15 秒或改变门槛时，旧锁定/累计必须立即清零，并能按新阈值从头累计。
- 背书无声纹时不能伪装成本人检测；停止测试、开始学习、切换模式、声纹录入、最小化/隐藏窗口和退出都必须释放测试音频流，正式开始后最多只有一条麦克风音轨。选中的麦克风必须持久化，且待命测试与正式链路均使用其精确 `deviceId`。
- 声纹服务须保留最多五份同一用户模板；删除一份后其余模板仍可识别，schema 2 单份档案可安全载入为“原有声纹”。
- 使用当前 Windows 用户的 DPAPI 加密一份隔离声纹档案后，必须能由新的 Node/PowerShell 子进程解密；测试不得接触真实 `speaker-profile.dat`。
- 在待命测试仍占用麦克风时，快速连点“开始学习/动画预览/声纹录入”必须只有先取得互斥状态的流程继续；其他流程不得打开第二条音频流。预览结束后模式和声纹按钮必须恢复可用。
- README 开头和应用标题下都能看到“原作：叛逆蓝牙 · 二创：眼泪斷了线”，960×540 下署名、预检按钮和状态不得与其他控件重叠。
- 主窗口标题栏可拖动、双击最大化/还原；最小化、最大化/还原和隐藏到后台三键均可用，顺序正确，960×540 下不与模式按钮或页面按钮重叠。
- 主窗口、子 frame 与休息提示页不能越权调用不属于自己的 IPC；新窗口和非预期导航会被拒绝。
- 默认只有一个主窗口；休息提示出现时恰好两个窗口且不替换主 webContents；违规仍恢复同一个主窗口。
- 背书阈值 20～60 秒、自习持续人声阈值 3～15 秒均正确钳制；键盘瞬态不累计成自习违规。
- 背书 20 分钟、自习 45 分钟各获得一张两分钟休息券；休息不计时，结束后主窗前台且只播放一次有声 `E1 → S1 → X1`。
- 普通动画静音；开场、结束、违规、里程碑表扬和休息恢复音轨与画面一一对应。
- 表扬字幕位于下侧且不遮挡教官或按钮；背书每 45 分钟、自习每 60 分钟触发。
- 无摄像头、无音频导入、无黑帧、无按钮重叠。
- 主场景和休息提示均使用 `cache: false` 的内存会话，退出后隔离数据目录不出现 `SessionData`、`Code Cache` 或 `GPUCache`；只有用户主动录入时才允许存在 `speaker-profile.dat`。
- 媒体或窗口 IPC 失败后回到 `idle`，麦克风、有效时钟、遮罩和置顶提醒状态均被清理。
- 测试结束后隔离 profile、麦克风流和进程均被清理。
