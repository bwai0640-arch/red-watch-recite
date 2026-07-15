# 资产来源与权利说明

## 项目身份

“凛冬督学局”是非官方本地二创桌面应用，不代表 `redwatch.top`、原作者或任何相关权利人的官方发行或认可。

- 原作：叛逆蓝牙
- 本二创：眼泪斷了线

本项目保留上述署名，但不表示本项目是原作者或 `redwatch.top` 的官方发行、共同维护或官方认可。原素材相关权利归其权利人所有；如有侵权或署名异议，请通过 GitHub Issue 联系维护者，核实后将及时调整或删除。

## 拟公开的 GitHub 范围

公开仓库包含源码、媒体、图标和 CAM++ 模型；根目录 `.gitignore` 阻止以下内容被首次加入：

- `dist/`、`release-staging/` 和其他本地发布产物；
- 所有 `RedWatchReciteData/`、声纹档案、真实 `.env`、日志与缓存；
- `work/` 中的真人测试语音和本地审查产物。

公开可见不等于采用开源许可证。项目仍为 `UNLICENSED`；除 GitHub 服务条款允许的查看与 fork 外，不额外授予通用复制、修改或再分发许可。

`.gitignore` 不能清除已经跟踪或进入历史的文件。首次提交前仍须查看实际暂存清单；如果未来改变资产策略，应逐项重新审查来源、权利状态与公开范围。

## 动画与源音轨

- 用户指定的参考站点为 `https://redwatch.top/`。
- 当前本地工作副本包含 22 段动画、22 份对应源音轨、3092 帧和 222 张精灵图。
- 本地运行资源位于 `renderer/media/`，清单为 `renderer/media/catalog.json`。
- 每段 manifest 记录帧数、尺寸、帧率、图集和音频完整性信息。
manifest 哈希只用于证明本地文件完整性，不表示本项目为原站官方发行。原素材相关权利归其权利人所有；如有侵权或署名异议，请通过 GitHub Issue 联系维护者，核实后将及时调整或删除。

公开仓库准备包含 `renderer/media/`，以便源码能够完整构建和复现本地运行效果。媒体目录约 142.07 MiB，单个最大文件小于 1 MiB。

## 图标

公开仓库准备包含 `assets/icon.ico` 与 `assets/icon.png`。图标同样适用本页的非官方声明、权利归属与联系删除规则。

## 声纹模型与软件

- `sherpa-onnx-node` 1.13.4：Apache License 2.0。
- CAM++ 模型 `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`：项目记录为 Apache License 2.0。
- 模型 SHA-256：`aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2`。
- Electron 43.1.0：MIT License；其 Chromium 等第三方组件由 Electron 随附声明覆盖。

声纹软件与模型的随包声明见根目录 `THIRD_PARTY_NOTICES.md`，Apache License 2.0 全文见 `LICENSES/Apache-2.0.txt`。Electron/Chromium 和其他传递依赖的完整随包声明仍须在公开二进制发布前逐项核对。

## 测试语音

`work/speaker-fixtures/` 含以 `fangjun`、`leijun`、`liudehua` 命名的测试 WAV。当前本地项目文档没有记录这些文件的来源和授权。它们只用于本地测试，且不在 `package.json` 的打包文件列表中。

不要把这些测试语音打包、公开上传或当作用户录音。需要公开测试仓库时，应先替换为有明确许可的合成或自有测试语料。

## 公开分发前必须完成

1. README、应用界面和本页保持“原作：叛逆蓝牙 · 二创：眼泪斷了线”署名、非官方声明及 GitHub Issue 联系删除方式。
2. 本地真人测试语音继续排除；如需公开测试语料，应替换为有明确来源的合成或自有素材。
3. 核对 Apache-2.0、Electron 与所有传递依赖的 NOTICE/许可证随包要求。
4. 首次提交前检查实际暂存文件和敏感信息扫描结果；公开 EXE 前单独审查二进制所包含的文件。
5. 除非维护者明确决定向公众授予额外权利，否则保持 `license: UNLICENSED`，不要随意添加开源许可证。
