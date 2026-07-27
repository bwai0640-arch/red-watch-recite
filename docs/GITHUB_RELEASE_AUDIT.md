# GitHub 首次发布前审计

## 1.13.4 发布候选（2026-07-27）

1.13.4 完成整应用的深度失败导向审查，覆盖漂浮窗真实命中结构、拖动与缩放状态、提醒/休息/停止状态机、声纹录入与删除事务、设置损坏、Worker 卡死、麦克风中断、休眠锁屏、渲染器崩溃、重复启动、缓存链接、退出等待、正式包调试入口及隔离构建。最终后台门禁通过 46 个 JavaScript 语法检查和 18 组无界面回归；没有启动 Electron、候选 EXE、真实麦克风或真实声纹。真实 Windows 鼠标命中、窗口拖缩观感及打包后的完整用户旅程遵照用户的后台测试要求未在当前桌面执行，不能描述为 UI 实机通过。

最终提交后的 `github-upload-safety` 扫描覆盖 340/340 个上传面文件和完整历史，全部提交均使用 GitHub `noreply` 邮箱；结果为 `BLOCK=0`、`INCOMPLETE=0`、`REVIEW=194`。194 项由当前树与历史中的同类提示组成，人工复核为通用 `name`/事件字段、公开动画名称、公开作者/产品元数据、被手机号规则误报的媒体 SHA-256，以及锁文件中的第三方公开维护者邮箱；没有发现密钥、私人邮箱、本机用户路径、真实声纹、录音、设置文件或运行缓存。GitGuardian 未运行，因为本机缺少 `ggshield` CLI，不能将此结论描述为 GitGuardian 通过。

隔离候选由已提交且干净的源码通过 `scripts/build-release.cjs` 生成，并在不运行 EXE 的情况下复核：

- 安装版 286,481,852 字节，SHA-256 `0279E7FA5EA1B4A0186D1A5834DE4F0DEEE57EF70EDF2E7C376522DA406E773E`；
- 便携版 275,818,466 字节，SHA-256 `F700F0116E2A666CBF6630EB12EEA71687EEB620D6F58F0D93163AC4E5BA437F`；
- 两份 EXE 的 FileVersion/ProductVersion 均为 `1.13.4`，Authenticode 均为 `NotSigned`；
- 安装版与便携版嵌入相同应用核心；最终 `app.asar` 149,459,386 字节，SHA-256 `2F3F065B6674E864ED3E8CF96691BB2610FBA1595E02F61AB758C81E4B419BC4`；
- `app.asar` 355 项、`app.asar.unpacked` 31 个运行文件；23 个核心源码哈希匹配，22 段动画、22 份对应源音轨、两套本地模型及第三方声明完整，禁止的用户数据、设置、测试 fixture、缓存和构建文件为 0。

> 状态：1.13.4 源码与候选附件已通过本地后台、静态包内容及隐私门禁；保留 GitGuardian 缺口、未签名提示、当前桌面未做 UI 实机测试和转换 ONNX 精确逐文件许可未证实等残余边界。

## 1.13.3 本地状态（2026-07-27）

1.13.3 修复了 Windows 原生拖动区域导致漂浮窗真实鼠标悬停工具无法显示的问题。已完成不启动 EXE 的后台语法、窗口策略、源码契约与隔离候选静态验包：包内 22 段动画、22 份对应源音轨、两套本地模型及 19 个核心源码完整，禁止的用户数据/测试数据条目为 0。最终本地交付目录只允许两份 1.13.3 EXE 和同步说明书。

本节只说明本地构建包，不等同于 GitHub 上传安全审计。本轮没有执行 GitHub push、Release 上传、Git 历史/提交者身份复扫或 GitGuardian；后续若要把 1.13.3 推送到公开仓库，仍须按 `github-upload-safety` 重新检查当前工作树、历史、远端身份与最终附件。

## 1.13.0 候选状态（2026-07-22）

1.13.0 的当前可见产品名、窗口、托盘、快捷方式与候选 EXE 统一为“凛冬督学局”，并包含漂浮全区域拖动、主后台按钮悬停/聚焦选择、黄色动画状态、5 秒自习恢复确认、更强的 0.12 人声/0.20 音乐媒体检测，以及 224×170～320×225 可记忆缩放。背书用户端已移除底噪/抗噪滑块、白色门槛线、漂浮窗底噪条与手动重校准，只保留 20～60 秒未检测到本人提醒时间；底层固定为约 3 秒自动环境适应、内部 8 dB 高召回 VAD 分段和 CAM++ 声纹终判，朗读污染的初始适应使用保守噪声上限并要求 300 ms 内恢复候选。动画改为全播放器最多 3 张大图的片内按需预取，慢加载保持上一帧；表扬可从 hidden/floating 临时恢复同一完整主窗口并返回原模式。CAM++ 正在复核时禁止处罚，渲染侧单次推理超过 5 秒或模型/服务异常则安全停止且不计违规。

为避免升级后丢失或重复录入声纹，运行数据仍刻意沿用 `%APPDATA%\背书自习监督` 旧根；`window-preferences.json` 只允许 `backgroundMode` 与 `floatingWindowSize`，不保存位置或个人数据。新增的 `study-preferences.json` 除固定格式版本外只允许 `mode`、背书 20～60 秒、自习 3～15 秒和选定麦克风 `deviceId`/`label`，不保存音频、声纹、检测结果、学习记录或计时；该文件及可能含用户自定义名称的设备标签均不得进入 Git 或候选包。已选设备缺失时保留原 ID/标签并明确提示，绝不按同名设备或系统默认设备自动替换。固定 8 dB 余量不持久化，旧渲染设置中的 `reciteSensitivityDb` 被忽略，并在首次持久设置迁移后从旧浏览器存储删除。

本轮只允许后台纯 Node/静态门禁，不启动 Electron、UI/CDP、候选 EXE、窗口、托盘、真实麦克风或真实声纹；不得声称真实拖拽、缩放、菜单观感或 UI 候选已实测。

最终本地提交后的 `github-upload-safety` 重扫覆盖 335/335 个上传面文件和完整历史，`BLOCK=0`、`INCOMPLETE=0`、`REVIEW=196`，6 个提交均使用 GitHub `noreply`。196 项是当前树与历史重复出现的保守提示，人工复核为通用 `name`/meta 字段、公开场景/作者显示名、锁文件第三方公开维护邮箱和被手机号规则误报的媒体 SHA-256；没有真实声纹、真人录音、用户设置、EXE、密钥、私人邮箱或本机用户路径进入上传面。GitGuardian 未运行，因为本机缺少 `ggshield` CLI，不能将本结论描述为 GitGuardian 通过。

修复后的隔离候选已构建并在不运行 EXE 的情况下核对：安装版 286,476,167 字节，SHA-256 `2528DAE227FA9B192A8FC4E93F2E15720AC90BAD0A01CC88D0DE79D6EAA56069`；便携版 275,808,923 字节，SHA-256 `0F563B123B2953D88CB99B92A34DA760D141F11F5A3B3FE3D29CB590F571FC2D`。两者 FileVersion/ProductVersion 均为 `1.13.0`，Authenticode 均为 `NotSigned`。`app.asar` 355 项、`app.asar.unpacked` 31 个运行文件，19 个核心源码与当前工作树哈希一致；22 段动画、22 份对应源音轨、两套本地模型、标签和声明完整，实际用户数据、测试 fixture、设置文件、脚本、文档、构建目录、环境文件与缓存等禁止项为 0。

> 状态：1.13.0 源码与候选附件已通过本地后台/静态隐私门禁；按用户要求没有运行 UI 候选，因此不得描述为 UI 实测通过。未执行 GitHub push 或 Release 上传。

## 1.12.0 候选状态（2026-07-22）

1.12.0 新增同主窗口漂浮模式：常态只显示统一检测结果和 16:9 教官动画，悬停后显示“已学习”有效计时、隐藏和放大；后台偏好只保存 `hidden | floating`。提醒仍复用同一主窗口并按 `scene / hidden / floating` 来源返回。窗口切换使用主进程串行队列和严格渲染回执，提醒期间拒绝普通恢复、最小化和最大化；休息提示临时避让且不会遮住提醒。

本轮按用户要求只运行不触碰桌面的纯 Node/静态门禁，没有启动 Electron、UI/CDP、候选 EXE、窗口、托盘、真实麦克风或真实声纹。语法、窗口策略/源码门禁、场景规则、自习策略、VAD 对抗、音频事件策略、声纹音频、DPAPI 跨进程和 CED Mini 基础模型检查均通过。`mode-rest-ui-test.mjs` 已加入真实悬停、漂浮→提醒→漂浮、隐藏/放大和原生窗口能力断言，但本轮没有运行，不能声称 UI 候选门禁通过。

使用 `github-upload-safety` 的内置扫描器提高单文件上限到 40,000,000 字节后，完整扫描当前上传面和 Git 历史：330 个文件全部扫描，其中二进制 248 个；缺失跟踪文件 0；历史状态 `complete`；5 个本地 commit 的邮箱均为 GitHub `noreply`。结果为 `BLOCK=0`、`INCOMPLETE=0`、`REVIEW=97`。97 项与 1.11.1 已复核集合相同：通用 `name`/事件字段、HTML `meta name`、公开场景显示名、公开包名、依赖锁文件中的第三方公开维护邮箱，以及被电话号码规则误报的媒体 SHA-256；未发现密钥、密码、令牌、私人邮箱、电脑用户名、真实用户数据或真人测试录音。GitGuardian 未运行，因为本机缺少 `ggshield` CLI；本结论不把内置扫描描述为 GitGuardian 通过。

候选附件在全新 `work/release-candidate-1.12.0` 中后台构建，并在不运行 EXE 的情况下核对：

- 安装版 286,471,909 字节，SHA-256 `981DAA8939DB0CA9F0F37050511333F5C96BC6ECD15C73BB8172211D30340451`；
- 便携版 275,783,085 字节，SHA-256 `6431F740F4ACC3D4A783CBE2A6D2AF14CA9160512D7C19E658DBD6FB25FBE5B4`；
- 两份文件版本与产品版本均为 `1.12.0`，Authenticode 状态均为 `NotSigned`；
- `app.asar` 354 项、`app.asar.unpacked` 31 个运行文件；6 个核心源码文件与当前工作树 SHA-256 一致；
- 22 段动画、22 份各自对应的源库音轨、两套本地模型、标签表、模型来源说明、原生依赖和第三方声明完整；
- 包内禁止项为 0：没有实际 `speaker-profile.dat`、`window-preferences.json`、`RedWatchReciteData`、测试 fixture、`work`、`scripts`、`docs`、`.env` 或浏览器运行缓存。

> 状态：1.12.0 源码上传面和候选附件满足本地隐私门禁（保留 97 项已复核提示与 GitGuardian 缺口）；按用户要求未运行 UI，因此只允许作为“后台静态核对通过”的本地交付候选，不得描述为 UI 实测通过。本轮没有执行 GitHub push 或 Release 上传。

## 1.11.1 候选状态（2026-07-21）

1.11.1 调整自习模式的本地声音检测链路：自习完全不创建或使用 `AdaptiveVad`，不再进行 3 秒环境底噪校准，也不使用音量/sensitivity 门槛；白色门槛线、抗噪滑块和“重新校准环境底噪”在自习界面隐藏，音量条只显示原始 RMS 且不参与分类。自习打开麦克风后直接形成约 2 秒 CED Mini 首窗，休息结束后也直接恢复该分类链路；任一阴性分类窗口立即清空候选，连续阳性仍抵扣约 1 秒滚动窗口重叠；键盘单独不累计、键盘与媒体双证据仍可累计。背书的底噪校准、VAD、抗噪门槛和声纹验证保持不变。

1.11.1 已完成后台纯 Node 语法、策略、VAD 对抗、声纹服务和 CED Mini 模型/真实 fixture 门禁；没有启动 Electron、UI/CDP、真实麦克风、用户声纹或候选 EXE。临时真实键盘、音乐和人声 fixture 已删除。

使用 `github-upload-safety` 在 1.11.1 本地提交后重扫当前上传面与完整历史：326 个文件全部扫描，其中二进制 248 个；缺失跟踪文件 0；历史扫描完整；4 个本地 commit 的邮箱均为 GitHub `noreply`。结果为 `BLOCK=0`、`INCOMPLETE=0`、`REVIEW=97`；当前树 48 项、历史 49 项。逐项复核为 JavaScript/模型事件对象的通用 `name` 字段、HTML `meta name`、公开场景显示名、公开项目包名与作者署名、依赖锁文件中的第三方公开维护邮箱，以及被电话号码规则误报的媒体 SHA-256；新增的历史项是自习 UI 回归里的合成 `Speech` 事件字段。未发现密钥、密码、令牌、私人邮箱、电脑用户名、真实用户数据或真人测试录音。GitGuardian 未运行，因为本机缺少 `ggshield` CLI。

候选附件已独立构建和解包核对：

- 安装版 286,465,178 字节，SHA-256 `4F7CE4674E48E5772D5CDC5DFC10FB3DDC1C7F09DE53EECE2226A157FDDC4E2B`；
- 便携版 275,770,933 字节，SHA-256 `F9F66EB0891A48D0A7EC5C1D0CDE4FA71B78ECD1CD02C16828B19EC5DF2E7817`；
- 两份文件版本均为 `1.11.1`，Authenticode 状态均为 `NotSigned`；
- `app.asar` 解出 322 个文件；产品代码与源码 SHA-256 一致，包含 CED Mini 模型、标签、来源说明和根第三方声明；
- 解包文件树不含实际 `speaker-profile.dat`、`RedWatchReciteData`、临时 fixture、Obama/ESC-50 测试音频、PCM 或运行缓存；文本扫描未发现本机用户路径或测试目录。源码中只保留运行时定位档案所需的预期文件名常量 `speaker-profile.dat`，没有附带任何档案内容。包内自习代码确认无 `studySensitivityDb`、环境音量 gate 或应用级 gap 参数。

剩余未执行项只有 UI 候选验证；需在独立 Windows 会话/虚拟机或用户明确允许后运行。当前允许源码和已核对附件进入本地发布准备，但不能声称 UI 候选门禁通过。

## 1.11.0 历史候选审计（2026-07-21）

1.11.0 新增 CED Mini 音频事件服务、约 10 MiB 的 INT8 ONNX、AudioSet 标签表和相关文档。本轮已重新运行 `github-upload-safety` 检查当前文件树、完整历史和提交者身份，并对两个候选 EXE 做了独立解包检查：

- 不包含真实 `speaker-profile.dat`、原始 PCM、分类标签/概率运行结果、真人键盘/媒体 fixture、临时下载目录或本机路径；
- CED Mini 模型与标签哈希、来源声明实际进入发布包，临时正样本不进入 Git 或 EXE；
- k2-fsa 转换包随附 README 没有明确 `model.int8.onnx` 的逐文件许可或精确 checkpoint，因此不能把 RicherMans/CED 代码的 GPL-3.0、mispeech 模型卡的 Apache-2.0、Zenodo 记录的 CC BY 4.0 中任一项直接写成转换 ONNX 的确定许可；
- 本轮自动测试只运行后台纯 Node 路径，没有启动 UI、真实麦克风或真实用户档案；这不是 UI 候选门禁通过。

源码与历史扫描覆盖 326 个文件，其中 248 个二进制文件；缺失跟踪文件 0，完整历史扫描完成，3 个本地 commit 的邮箱均为 GitHub `noreply`。结果为 `BLOCK=0`、`INCOMPLETE=0`、`REVIEW=95`。95 项逐项人工复核为当前树与历史中的重复提示：JavaScript 错误类/音频标签对象的通用 `name` 字段、HTML `meta name`、公开场景显示名、包名、依赖锁文件中的第三方公开维护邮箱，以及被电话号码规则误报的 SHA-256 片段；未发现密钥、密码、令牌、私人邮箱、电脑用户名、真实用户数据或真人测试录音。GitGuardian 状态为“未运行”，因为本机缺少 `ggshield` CLI；不得将本地扫描描述为 GitGuardian 通过。

候选附件另行解包核对：安装版 286,465,401 字节，SHA-256 为 `2C3B057FD85B390C8436E883D9513F653F1CA1BC239BCDF96CC1AE13F587C1EE`；便携版 275,780,352 字节，SHA-256 为 `D97C9379944C0279D5DFD53A778E71700E0EE9A44A4A831B376CF770DAABB02D`。包内包含 CED Mini 模型、标签、来源说明和第三方声明，并确认包含重叠抵扣、单个分类空档容忍与学习中设置变更作废旧 generation 的修正；路径与解包文本中没有 `speaker-profile.dat`、`RedWatchReciteData`、临时 fixture、本机用户路径或测试音频。两个 EXE 均未使用商业代码签名证书。

> 状态：1.11.0 源码上传面和候选附件已通过本地隐私门禁（保留上述人工复核项与 GitGuardian 缺口）；按用户要求没有运行 UI/真实麦克风测试，因此不能声称 UI 候选门禁通过。

## 1.10.1 历史同步审计（2026-07-21）

审计对象为 `D:\RedWatchRecite` 的当前工作树及完整 Git 历史，目标仓库为 `bwai0640-arch/red-watch-recite`。本次仅同步源码、文档、应用媒体、图标和本地模型；安装版、便携版、用户声纹、运行缓存和真人测试录音均由 `.gitignore` 排除，不作为 Git 上传内容。

使用 `github-upload-safety` 对完整上传面及历史执行扫描，并将单文件读取上限提高到 40,000,000 字节以覆盖 28 MiB 的本地模型。结果：上传面发现并扫描 319 个文件，缺失跟踪文件 0；历史检查完成；`BLOCK=0`、`INCOMPLETE=0`、`REVIEW=65`。其中 65 项是当前树与历史中的重复提示，已逐项复核为：公开项目/第三方包元数据字段、用户要求公开展示的原作“叛逆蓝牙”和二创“眼泪斷了线”署名、媒体显示名、代码中的通用 `owner` 标识，以及被电话号码启发式规则误报的 SHA-256 十六进制片段；不含用户声纹、原始录音、真实姓名、真实邮箱、令牌、密码或运行缓存。

GitGuardian 状态为“未运行”：本机没有 `ggshield` CLI，也没有为其配置凭据。本审计不将本地扫描描述为 GitGuardian 通过。Git 历史中的提交者邮箱均为 GitHub `noreply` 地址。本次同步前，用户已明确授权删除两份无法由 1.10.1 载入的旧声纹档案；删除操作不属于 Git 上传内容，也没有读取其声纹内容。

> 结论：在上述已记录的 `REVIEW` 例外下，当前源码同步满足“无 BLOCK、无 INCOMPLETE、无用户数据上传”的发布门槛。正式 EXE 如需上传 GitHub Release，仍须单独执行附件隐私检查，不能以本次源码审计替代。

> 状态：从下一节“审计日期：2026-07-15”开始记录的是 1.8.0 的更早历史审查基线，不可作为 1.10.0 或后续版本的发布结论。任何 GitHub 推送或 Release 前均须重新执行当前文件树、提交历史、EXE 与隐私审查。

## 1.8.0 历史首次发布审计

审计日期：2026-07-15  
审计对象：`D:\RedWatchRecite` 的实际 Git 暂存面

### 当时结论

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
