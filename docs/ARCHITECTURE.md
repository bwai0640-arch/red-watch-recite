# 背书自习监督架构

## 目标与边界

“背书自习监督”是 Windows x64 本地安装 Electron 应用。背书模式在本机采集麦克风 PCM，先筛选疑似语音活动，再用本地声纹模型验证说话者；只有确认是登记用户时才重置静默计时。自习模式不使用声纹，改由本地 CED Mini 音频事件模型区分键盘与人声、音乐、电视/广播等媒体证据。

应用不使用摄像头、不保存原始录音、不上传声纹、PCM、音频事件标签或分类概率，也不依赖网络账号。当前方案不做活体或本人录音防重放。

## 进程与信任边界

```mermaid
flowchart LR
    UI["Main renderer: UI and scene state"] -->|"desktopAPI and desktop"| Preload["Main preload bridge"]
    Preload -->|"validated IPC"| Main["Electron main process"]
    Prompt["Optional break prompt renderer"] -->|"breakPrompt only"| PromptPreload["Break prompt preload bridge"]
    PromptPreload -->|"validated IPC"| Main
    Main -->|"Worker RPC"| Worker["Speaker worker"]
    Worker --> Model["Local CAM++ ONNX model"]
    Main -->|"Worker RPC"| AudioWorker["Audio-event worker"]
    AudioWorker --> AudioModel["Local CED Mini INT8 ONNX model"]
    Main --> Data["Encrypted speaker profile"]
    UI --> Media["Local sprite sheets and source audio"]
```

- `main.js` 创建一个主 `BrowserWindow`，获得休息券或正在休息时最多再创建一个 420×220 提示窗；它还管理托盘、窗口模式、权限、`rwt://renderer` 协议、声纹服务和音频事件服务。
- `preload.js` 只向主页面暴露窗口、声纹、音频事件分类和休息提示控制；`break-prompt-preload.js` 只向休息提示页暴露两个提示动作。两个渲染器都没有 Node.js 权限。
- 所有 IPC 都同时核对具体窗口的 `webContents`、主 frame 与精确 `rwt://renderer` URL；两个窗口都拒绝 `window.open`、子 frame 导航和非预期主导航。
- `speaker-service.js` 串行化声纹操作，校验 profile，使用当前 Windows 用户的 DPAPI 加密并原子写入。
- `profile-crypto.js` 只通过隐藏的本地 PowerShell 子进程调用 Windows `ProtectedData`；声纹明文以 Base64 写入子进程标准输入，不出现在命令行、文件或日志中。
- `speaker-worker.js` 在线程中运行 Sherpa/CAM++，避免推理阻塞渲染与动画。
- `audio-event-service.js` 校验内存 PCM 和 RPC；`audio-event-worker.js` 在线程中运行 Sherpa/CED Mini。每次只返回有界的标签、索引与概率数组，不写入文件。
- `renderer/app.js` 持有双模式会话、VAD、声纹复核、休息流程、窗口模式与动画播放状态。
- `renderer/study-policy.js` 是阈值范围、有效学习时钟、休息/表扬里程碑、自习音频事件归类与累计判定的唯一事实源。

## 声纹录入

```mermaid
flowchart LR
    Mic["24 s microphone recording"] --> PCM["16 kHz mono PCM"]
    PCM --> Dynamic["loudness, clipping, dynamics checks"]
    Dynamic --> Windows["8 candidates, each 2.4 s"]
    Windows --> Embed["CAM++ embeddings"]
    Embed --> Rank["rank by pairwise consistency"]
    Rank --> Keep["keep best 6"]
    Keep --> Encrypt["schema 3 encrypted profiles"]
```

- 唯一合法来源是 `mic`。
- 渲染器先检查 50 ms 能量帧的动态变化；Worker 再执行响度、削波和动态检查。
- 8 个候选按与其他候选的平均余弦相似度排序，保留前 6 个。
- 每个保留向量必须与其余 5 个向量的质心达到 0.50 一致性阈值。
- 档案保存模型哈希、维度、创建时间、阈值和 6 个嵌入，不保存 WAV、PCM 或其他原始录音。
- schema 不是 2 或 3、模型哈希/维度不符或文件损坏时 fail closed，并要求重新录入。schema 2 单份档案在内存中映射为“原有声纹”；只有新增或删除模板时才原子写入 schema 3。

## 运行时检测与学习策略

```mermaid
flowchart LR
    Mic["Microphone"] --> Worklet["AudioWorklet PCM capture"]
    Worklet --> Mode{"Mode"}
    Mode -->|"recite"| VAD["3 s noise calibration and adaptive VAD"]
    VAD --> Window["2.4 s window, 0.6 s overlap"]
    Window --> Verify["Local CAM++ verification"]
    Verify --> Owner{"Owner confirmed?"}
    Owner -->|"yes"| Reset["Reset 20-60 s silence clock"]
    Owner -->|"no"| ReciteCount["Continue counting"]
    Mode -->|"study"| Roll["Latest 2 s rolling PCM window"]
    Roll --> CED["Local CED Mini, update about every 1 s"]
    CED --> Event{"Keyboard only or media evidence?"}
    Event -->|"keyboard only"| Ignore["Do not accumulate"]
    Event -->|"media / keyboard plus media"| Quiet["Accumulate 3-15 s evidence"]
    ReciteCount --> Alert["Escalating reminder"]
    Quiet --> Alert
```

- 背书启动后先进行约 3 秒环境底噪校准，再用音量门槛/VAD 筛选声纹候选。自习完全不创建或使用 `AdaptiveVad`，不校准底噪、不读取音量门槛；麦克风打开后直接填充最近约 2 秒滚动分类窗口，首次有效分类约需 2 秒。
- 普通阈值为 0.55，强匹配阈值为 0.70。
- 强匹配一次即可确认；普通匹配要求最近三次判断中至少两次命中。
- 单次失败保持中性复核状态；连续三次明显失败才显示“暂未确认本人声音”。
- 确认状态保持 2.5 秒，验证间隔为 1.2 秒。
- 背书静默阈值由用户在 20～60 秒间选择；阈值到达时若存在正在采集/验证的候选，最多宽限 3 秒。
- 自习只向用户暴露 3～15 秒媒体持续时间，默认 8 秒；没有环境底噪、sensitivity 或音量 gate。模型直接对最近约 2 秒 PCM 做滚动分类，约每 1 秒更新一次；单独键盘标签不累计。键盘标签占主导时，至少两项达到专用阈值的媒体标签可构成“键盘 + 媒体”双证据。
- 连续阳性先从原始证据时长中抵扣约 1 秒窗口重叠；三个 1 秒步进的阳性窗口只累计约 2 秒，避免同一有限片段被重复计时。应用不启用通用状态机的 gap 容忍参数，任一阴性分类窗口立即同时清空原始与抵扣后的候选；触发后仍需约 1 秒无媒体证据才重新武装。
- 自习的 `getUserMedia` 约束请求关闭 `echoCancellation`、`noiseSuppression` 与 `autoGainControl`，避免系统优先消除电脑扬声器媒体声；浏览器、驱动或硬件可能不遵守，运行时需读取实际 track 设置并提示，不能把约束请求视为强保证。
- 程序自己的动画播放期间暂停静默时钟，因此源音轨不会被计为本人背书。

### 待命检测测试

检测面板在会话开始前提供一个独立的 `preflight` 状态并复用正式 `getUserMedia(audio-only)`。背书测试走约 3 秒底噪校准、自适应 VAD 与 CAM++ 声纹验证；自习测试绕过底噪/VAD 门槛，直接走 CED Mini 滚动分类与 `QuietModeDetector`。自习首窗约 2 秒，形成前显示暖机状态，不把不完整窗口当成安静或违规。

`preflight` 始终保持 `active = false`，并把会话阶段归一为 `idle`。它不启动有效学习时钟、里程碑、巡查调度、动画、源音轨、提醒等级或学习记录。背书测试与正式会话共享最多 3 秒的在途声纹验证宽限；最终达到当前阈值时只在检测面板显示“按当前设置将触发提醒”。背书模式没有本机声纹时拒绝启动测试并引导先录入，避免把普通 VAD 误展示成“本人检测”。

停止测试、开始学习、切换模式、打开声纹录入、手动预览动画、最小化/隐藏窗口、进入漂浮模式、麦克风轨道结束、页面退出或异常时都会走幂等清理，停止 `AudioWorklet`/轮询、关闭 `AudioContext` 并停止全部轨道。这样待命测试不会在后台悄悄占用麦克风，也不会与正式会话叠加第二条音频流。正式学习进入漂浮或完全隐藏时不会释放、重开或重置既有麦克风检测链路。

待命态的开始学习、动画预览、声纹录入与声纹删除使用同步置位的互斥状态。任何操作在第一次异步等待之前先占位并禁用其他入口，等待测试麦克风释放后再次核对状态；因此快速连点不会同时启动两个场景流程、两条麦克风流，或在启动途中修改声纹档案。

白色门槛线、抗噪 range、`latestNoiseFloorDb + reciteSensitivityDb` 映射和“重新校准环境底噪”只属于背书模式，并与背书 VAD 双向同步。自习模式隐藏这些控件；两条音量活动条只显示原始 RMS 作为可视反馈，不进入 CED Mini 或 `QuietModeDetector` 判定。

自习预检或正式学习中改变持续时间会立即清除旧累计、解除 `QuietModeDetector` 的未武装状态、递增分类 generation 以丢弃在途旧结果，并清空旧滚动窗口，再等待约 2 秒首窗；自习没有灵敏度设置。背书改变抗噪门槛时仍更新 VAD、作废在途声纹结果并从调整时刻重新计时。

有效学习时钟只在 `studying` 阶段运行；休息、有声事件、开始/恢复、提醒和停止阶段全部暂停。里程碑规则为：

| 模式 | 休息券 | 表扬 |
|---|---|---|
| 背书 | 每 20 分钟 1 张，每张 2 分钟 | 每 45 分钟 |
| 自习 | 每 45 分钟 1 张，每张 2 分钟 | 每 60 分钟 |

休息券在当前会话内累计。休息时释放麦克风并隐藏主窗口；倒计时结束后恢复主窗口，播放一次有声 `E1 → S1 → X1` 并重新打开麦克风。背书随后校准约 3 秒再回到检测；自习直接回到 `studying` 并重新形成约 2 秒首窗。

## 场景状态机

`renderer/scene-rules.js` 生成计划，`renderer/app.js` 负责调度和播放。

| 计划 | 顺序 | 自动音轨 |
|---|---|---|
| 开场 | `E1 → S1 → X1` | 三段各自源音轨 |
| 普通巡查 | 随机入场 → 正常观察 → 随机退场 | 静音 |
| 独立事件 | `L_lean` / 红或蓝路过 | 静音 |
| 里程碑表扬 | 随机入场 → `R_pass_react_salute` → 随机退场 | 三段各自源音轨 |
| 第一次违规 | 随机入场 → `R1_react_yell` → 随机退场 | 三段各自源音轨 |
| 第二次违规 | 随机入场 → `R_aim_react_gun` → 随机退场 | 三段各自源音轨 |
| 第三次违规 | 随机入场 → `R_aim_shoot` 或 `R_whip_react_lash` | 两段各自源音轨；结束会话 |
| 手动结束 | `E1 → R_pass_react_salute → X1` | 三段各自源音轨 |

正常计划每 30～120 秒调度一次，25% 为独立事件，75% 为完整巡查。待播放的表扬优先于随机计划。窗口隐藏时普通计划和表扬不会恢复窗口；违规会恢复同一个主窗口并置顶。

`R_fatigue_warning` 与 `X6_exit_abrupt` 不在自动池，只能在媒体库中手动预览。

## 无黑屏媒体播放

- 媒体清单固定为 22 段，均含 1280×720、24 FPS 精灵图和对应源音轨。
- `media-player.js` 在播放下一段前并行预解码图集和可选音频。
- 切换时保留上一段末帧，不调用 Canvas `clearRect`，也不改变画布尺寸。
- 1920×1080 是展示目标；源帧只做等比例缩放。
- 媒体 manifest 中的哈希用于完整性校验，不代表版权授权。

## 窗口模型

主窗口模式为：

- `scene`：正常可见场景。
- `hidden`：同一窗口隐藏到托盘，检测继续。
- `floating`：同一窗口缩为 320×225、置顶并跳过任务栏；上方 44 像素只镜像统一检测结果，下方继续显示同一 Canvas 的 16:9 动画。鼠标移入时才出现“已学习”有效计时、完全隐藏和恢复完整场景操作。
- `alert`：发生违规时恢复同一窗口并置顶。

后台偏好为 `hidden | floating`，默认 `hidden`，只决定正式学习时点击后台按钮或标题栏关闭键后的表现。待命检测测试转入任一后台方式都会停止并释放测试麦克风。漂浮模式不创建额外 `BrowserWindow`、不重新载入页面，也不替换 `webContents`、Canvas、动画播放器或检测状态。

窗口模式操作由主进程串行化。完整场景、漂浮窗或提醒之间切换时，先锁定当前显示器，再隐藏原窗口并完成原生尺寸/置顶/任务栏属性，最后通知渲染器切换布局；渲染器优先在连续两个动画帧后回传带递增编号的严格回执，隐藏页面无法产生动画帧时则在 80 毫秒内强制完成布局并回执，主进程收到匹配回执后才显示窗口。最终超时会保持主窗口隐藏，不暴露尺寸与布局不匹配的残缺界面。这样不会让全尺寸窗口短暂显示漂浮布局，也不会让 320×225 窗口短暂显示完整布局。重复请求当前可见模式直接聚焦或保持原位，不重新隐藏/重排。普通恢复、最小化和最大化请求不能中断正在播放的提醒；只有异常清理使用独立的强制恢复 IPC。

漂浮位置只在 Windows 的用户拖动 `will-move` 事件中更新。休息提示引起的程序性挪动不会覆盖用户位置，因此提示关闭后可确定返回原处，不依赖延时猜测。后台偏好写入同样在主进程串行化，快速连续选择时以最后一次操作为准。

主进程在进入 `alert` 时保存来源模式并签发递增提醒编号；渲染器只能携带该编号请求“返回原状态”或“强制回完整场景”，不能指定任意目标模式。过期编号、非法枚举和额外字段被拒绝或忽略。非致命提醒遵循 `scene → scene`、`hidden → hidden`、`floating → floating`，致命提醒、手动结束与异常清理回到 `scene`。

窗口关闭按钮等同于进入后台；托盘“退出程序”才结束主进程。休息提示窗是严格单例、无边框、跳过任务栏且不抢焦点；可选择立即休息或攒下。没有提示时 `BrowserWindow` 数量为 1，提示存在时为 2。漂浮窗与右下角休息提示共存时先移到提示上方，空间不足再移到左下角，提示关闭后恢复原漂浮位置。违规始终复用主窗口；违规提醒展开前暂时隐藏休息提示，提醒结束后若提示仍有效再恢复，防止其置顶遮挡督学画面。

主窗口使用自定义标题栏：右上角标准顺序为最小化、最大化/还原、隐藏到后台；标题栏其余区域使用 Electron 的拖动区域移动窗口，双击可切换最大化/还原。渲染器只通过受信任 IPC 请求窗口动作。主窗口原生最小尺寸为 960×540，可以继续放大或调整比例，但 Canvas 始终按 16:9 等比例绘制。

核心会话阶段为 `idle → starting → studying → resting → resuming`，违规临时进入 `violation`，结束进入 `stopping`。待命检测测试是 `idle` 内部的非会话子状态，不进入这条有效学习状态机。动画解码或窗口 IPC 失败时统一进入幂等失败清理：停止有效时钟和媒体、释放麦克风、清除遮罩/展示状态、关闭休息提示并尽力恢复主窗口，最后回到 `idle`。

## 数据位置

数据根为 `%APPDATA%/背书自习监督`；自动化测试可通过 `SUPERVISION_DATA_DIR` 指向隔离目录。

- `speaker-profile.dat`：Windows DPAPI（当前 Windows 用户）加密的声纹特征，是唯一由本应用持久保存的麦克风衍生数据；schema 3 最多保存 5 份同一用户的模板。所选麦克风的设备标识只保存在本机设置中，测试、正式学习和录入共用该设备。
- `window-preferences.json`：只保存后台方式 `hidden` 或 `floating`，使用临时文件加替换的原子写入；不保存窗口内文字、学习时长、检测结果、音频或个人信息。损坏或非法值安全回退为 `hidden`。
- 自习模式的原始 PCM、CED Mini 标签和概率只在 `AudioWorklet → IPC → audio-event-worker` 的有界内存链路中流转，不进入档案、设置、日志、浏览器缓存或学习记录；分类完成或会话释放后丢弃。
- 主场景和休息提示共享 `rwt-runtime` 非持久会话，并以 `cache: false` 创建；两个窗口的 V8 代码缓存也被禁用。因此该会话的 `storagePath` 为 `null`，不会写出 `SessionData/`、`Code Cache/`、`GPUCache/` 等 Chromium 浏览器缓存。
- Electron 默认会话的必要临时目录位于数据根内的 `TransientElectronData/run-<pid>/`。每次启动会清理已退出进程留下的运行目录；正常 `will-quit` 时还会启动一个最小 Node 清理器，待主进程退出后删除本次运行目录。该目录不是用户数据，不能与 `speaker-profile.dat` 一起保留或发布。
- 首次安装不会自动接触旧便携版的 `RedWatchReciteData`；如需继续使用背书模式，用户在新安装版中重新录入声纹。

任何测试和构建都必须避免覆盖真实用户数据。
