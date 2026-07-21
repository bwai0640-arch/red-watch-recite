# 背书自习监督项目规则

## 基本工作准则

严格遵循以下八项：

- 以瞎猜接口为耻，以认真查询为荣。
- 以模糊执行为耻，以寻求确认为荣。
- 以臆想业务为耻，以人类确认为荣。
- 以创造接口为耻，以复用现有为荣。
- 以跳过验证为耻，以主动测试为荣。
- 以破坏架构为耻，以遵循规范为荣。
- 以假装理解为耻，以诚实无知为荣。
- 以盲目修改为耻，以谨慎重构为荣。

## 项目边界

- 应用源码和交付物的权威根目录是 `D:\RedWatchRecite`。不要把源码重新镜像到 C 盘工作目录；用户要求应用内容保留在 D 盘。
- 产品名固定为“背书自习监督”；当前本地版本为 `1.11.0`，交付物为 `背书自习监督-安装版-1.11.0.exe` 与 `背书自习监督-便携版-1.11.0.exe`。
- 应用标题下固定显示“原作：叛逆蓝牙 · 二创：眼泪斷了线”；README 开头必须先显示同一署名。署名不等于素材授权，不得据此跳过资产权利核验。
- GitHub 发布目标为 `bwai0640-arch/red-watch-recite`。提交者使用该账号对应的 GitHub `noreply` 邮箱；任何 push 或 Release 上传前都必须复查实际提交历史、个人信息、密钥与发布附件。
- `docs/USER_GUIDE.md` 是用户说明的源码侧权威副本；本地安装包交付时必须复制为 `release-staging/使用说明.md` 并保持完全一致。
- `renderer/scene-rules.js` 是自动动画顺序与随机池的唯一事实源，禁止在其他文件复制第二套业务规则。

## 不可破坏的产品规则

- 只申请麦克风音频权限；禁止恢复摄像头、视频轨道、人脸或手机检测。
- 只允许直接麦克风声纹录入；禁止恢复音频文件导入和网络注册。
- 原始麦克风 PCM、音频事件标签和分类概率只在内存处理，不得写盘或上传。
- 用户选择的麦克风必须在待命测试、正式学习与声纹录入中共用；设备不可用时提示重新选择，禁止静默回退到其他设备。
- 背书模式只有确认到本人声纹才清零静默计时，用户可在 20～60 秒内调节；VAD 只筛选疑似语音，不等同于本人判断。
- 自习模式不要求声纹，使用本地 CED Mini 对最近约 2 秒滚动窗口分类并约每 1 秒更新，首次有效分类约需 2 秒；连续阳性累计必须抵扣约 1 秒窗口重叠，阈值为 3～15 秒。单独键盘证据不得累计，键盘占主导时必须保留“键盘 + 至少两项媒体标签”的双证据路径，不能让响键盘掩盖媒体声。
- 自习模式请求麦克风时应关闭 `echoCancellation`、`noiseSuppression` 与 `autoGainControl`；必须检测驱动实际设置并在驱动拒绝时提示，不能把请求关闭描述为系统必然遵守。
- 待命时允许在检测面板启动“当前设置测试”：必须复用正式检测链路和实时滑块，只做校准与判定，不启动会话、有效时钟、场景计划、音轨、提醒或学习记录；停止、开始学习、切换模式、录入声纹、最小化/隐藏窗口和退出时必须释放测试麦克风。
- 常驻音量条和详细音量条的白色门槛线是同一 sensitivity 设置的可拖动控制：必须按 `latestNoiseFloorDb + sensitivityDb` 映射绝对 dB 位置，并与 range、ARIA、持久化设置、VAD 和 `QuietModeDetector` 双向同步；禁止把相对 sensitivity 百分比伪装成音量 dB 百分比。
- 自习预检修改时间或 sensitivity 时必须清除旧 `QuietModeDetector` 累计/锁定、音频事件滚动缓冲和 `preflightThresholdReached`，再等待新窗口暖机并按新设置累计。
- 待命态的开始学习、动画预览、声纹录入和声纹删除必须互斥；异步释放预检麦克风前先同步占位，等待后再复核状态，禁止双麦克风流或场景并发。
- 当前反重放不在范围内；不要私自加入随机口令或把当前方案描述为 100% 准确。
- 违规提醒必须恢复原来的同一个主 `BrowserWindow`，禁止新建违规窗口；只有休息券提示允许使用一个 420×220 的右下角独立窗口。
- 主窗口使用无框自定义标题栏，控件顺序固定为最小化、最大化/还原、隐藏到后台；双击标题栏切换最大化，原生最小尺寸为 960×540。
- 主窗口允许调整大小，场景 Canvas 始终保持 16:9；页面按钮、模式切换、检测条和标题栏不得互相遮挡。
- 隐藏模式只隐藏原窗口；禁止摄像头小窗。
- 动画始终在同一 Canvas 连贯切换；禁止在接缝清屏、改变 Canvas 尺寸或引入黑帧。
- 目标画布为 1920×1080，源动画等比例放大，禁止横向或纵向拉伸。
- 普通巡查、观察和路过静音；开场、结束、违规、里程碑表扬和休息结束后的开场使用每段动画自己的源音轨。
- 禁止生成、替换、错配或叠加无来源音效。
- 动画播放期间暂停静默计时，应用自己的音轨不能计为本人背书。
- `R_fatigue_warning` 与 `X6_exit_abrupt` 只允许手动预览，不进入自动池。
- 22 段动画和 22 份源音轨必须保持完整。
- 有效学习时长不含休息和有声动画：背书每 20 分钟获得 2 分钟休息券、每 45 分钟表扬；自习每 45 分钟获得休息券、每 60 分钟表扬。休息券仅在本次会话内累计。

## 声纹与用户数据红线

- `%APPDATA%\背书自习监督` 可能包含真实用户数据。没有用户明确授权时，不读取声纹内容、不删除、不移动、不覆盖。
- 安装版唯一持久化的麦克风衍生数据是 `%APPDATA%\背书自习监督\speaker-profile.dat`；不自动读取、复制或迁移旧便携版的 `RedWatchReciteData`。
- 开发和自动化测试必须通过 `SUPERVISION_DATA_DIR` 指向隔离目录。
- `speaker-ui-test.mjs`、`adversarial-ui-test.mjs` 与 `mode-rest-ui-test.mjs` 只允许连接隔离实例，绝不能直接连接用户正在使用的安装版。
- 不得提交、分享或打包真实 `speaker-profile.dat`。
- 声纹档案 schema 当前为 3，最多保存 5 份同一用户的模板。schema 2 单份档案只能以内存形式映射为“原有声纹”，新增或删除模板时才写入 schema 3；修改模型、维度、样本结构或阈值时，必须同步审查迁移/强制重录策略和对抗测试。
- 声纹特征必须以当前 Windows 用户的 DPAPI 加密后原子写入；不得用每次运行都会变化的 Electron 安全存储上下文加密。浏览器 `sessionData` 仍必须保持每次运行后清理。
- `speaker-worker.js`、`audio-event-worker.js`、两类本地模型及 Sherpa 原生模块必须保持在 `asarUnpack` 中。

## 安全与进程边界

- 渲染器保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- 新增 IPC 必须限制可信来源并验证 payload；必须同时绑定具体 `BrowserWindow.webContents`、主 frame 和精确 `rwt://renderer` URL。
- 主页面与休息提示页使用各自的最小 preload；两个窗口都必须拒绝新窗口和非预期导航。
- 本地 `rwt://` 协议必须继续阻止目录穿越。
- 麦克风权限只允许 `audio`，任何意外视频轨道都必须 fail closed。
- 安装版运行期间出现多个 `背书自习监督.exe` 是 Electron 渲染、GPU 等辅助进程，不等于磁盘上存在多个安装版或持久化缓存。

## 修改路由

| 修改内容 | 首要文件 | 同步检查 |
|---|---|---|
| 动画顺序、概率、升级 | `renderer/scene-rules.js` | `scene-rules-test.cjs`、用户说明、架构文档 |
| 音轨启停或字幕 | `renderer/app.js` | `adversarial-ui-test.mjs`、用户说明 |
| 双模式阈值、有效时长、休息券 | `renderer/study-policy.js` | `study-policy-test.cjs`、`mode-rest-ui-test.mjs`、用户说明 |
| 待命检测测试 | `renderer/app.js`、`renderer/index.html` | `mode-rest-ui-test.mjs`、架构与用户说明 |
| 声纹阈值或档案 | `speaker-service.js`、`profile-crypto.js` | worker、schema、DPAPI 跨进程测试、服务/UI 测试、隐私说明 |
| 音频质量或推理 | `speaker-worker.js` | `speaker-audio-test.cjs`、`speaker-service-test.cjs` |
| 自习音频事件分类 | `audio-event-service.js`、`audio-event-worker.js`、`renderer/study-policy.js` | `audio-event-policy-test.cjs`、`audio-event-model-smoke.cjs`、隐私与模型来源说明 |
| 窗口/托盘/权限 | `main.js`、`preload.js` | CDP/UI 对抗测试、架构文档 |
| 媒体资源 | `renderer/media/`、`catalog.json` | `media-runtime-test.mjs`、资产来源文档 |
| 发布版本 | `package.json` | EXE 版本、两份用户说明、CHANGELOG、SHA-256 |

## 测试与发布

- 静态测试可使用工作区依赖定位结果中的 Node；当前 shell 不能假设 `node` 在 PATH。
- 用户正在桌面工作时，本轮验证只能运行纯 Node 后台测试；禁止启动 Electron、CDP/UI、候选 EXE、窗口、托盘、真实麦克风或真实声纹档案。UI 验证需等待用户明确允许，或移到独立 Windows 会话/虚拟机。
- `audio-event-model-smoke.cjs` 的发布候选门禁必须设置 `BEISHU_REQUIRE_AUDIO_EVENT_FIXTURES=1`，使用临时官方正样本和至少 3 份来源明确的键盘 fixture；这些 fixture 不得提交、打包或复制到用户数据目录。
- UI/CDP 测试必须使用独立端口、隔离数据目录和全新实例。完整命令见 `docs/TESTING.md`。
- 正式构建必须输出到 `release-staging`，不得让 electron-builder 清理含真实用户数据的 `dist`。
- 发布前要求用户退出背书自习监督；不得覆盖旧 `dist` 或已安装应用。
- 重新打包后必须重新计算安装版和便携版的大小与 SHA-256，并同步到 `docs/USER_GUIDE.md` 和 `release-staging/使用说明.md`。
- 本地交付目录仅保留安装版、便携版和同步后的说明书；不得交付 `win-unpacked`、`builder-debug.yml`、旧版 EXE 或测试目录。

## 深入文档

- 架构与状态机：`docs/ARCHITECTURE.md`
- 测试隔离和矩阵：`docs/TESTING.md`
- 安全发布清单：`docs/RELEASE.md`
- GitHub 发布门禁与审计：`docs/GITHUB_RELEASE_AUDIT.md`
- 资产来源与权利说明：`docs/ASSET_PROVENANCE.md`
- 最终用户流程：`docs/USER_GUIDE.md`
