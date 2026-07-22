# Third-party notices

`凛冬督学局` uses the following components for local speaker verification and local audio-event tagging:

- `sherpa-onnx-node` 1.13.4, Copyright the Next-gen Kaldi contributors, Apache License 2.0.
  Source: https://github.com/k2-fsa/sherpa-onnx
- `3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`, CAM++ speaker-verification model from 3D-Speaker / ModelScope, Apache License 2.0.
  Source: https://modelscope.cn/models/iic/speech_campplus_sv_zh_en_16k-common_advanced
  SHA-256: `aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2`

## CED Mini audio-event model

Packaged conversion source:

- Archive: `sherpa-onnx-ced-mini-audio-tagging-2024-04-19.tar.bz2`
- Source: https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-mini-audio-tagging-2024-04-19.tar.bz2
- `model.int8.onnx` SHA-256: `ff29f39f9fbe637f72535160e9d006d61d872fdab0fce838672265b9b38cf946`
- `class_labels_indices.csv` SHA-256: `cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429`

The archive's included README says only that its models were converted from `https://github.com/RicherMans/CED`; it does not state a per-file license for this converted ONNX bundle or identify the exact upstream checkpoint. The following are separate upstream statements and must not be collapsed into an unsupported license claim for the k2-fsa conversion:

- The RicherMans/CED reference-code repository is marked GPL-3.0: https://github.com/RicherMans/CED
- The `mispeech/ced-mini` model card is marked Apache-2.0: https://huggingface.co/mispeech/ced-mini
- The Zenodo CED record that publishes original pretrained weights is marked CC BY 4.0: https://doi.org/10.5281/zenodo.8275347
- Google publishes AudioSet dataset annotations under CC BY 4.0 and the AudioSet ontology under CC BY-SA 4.0: https://research.google.com/audioset/download.html

No RicherMans/CED Python source code is copied into this application. Until the k2-fsa archive maintainer or upstream rightsholder confirms the exact checkpoint lineage and license of `model.int8.onnx`, this project does **not** claim that the converted ONNX file's redistribution license is conclusively resolved. Public binary distribution must keep this qualification and re-check the model's provenance instead of inferring a license from any one upstream page.

Apache License 2.0 全文随项目保存在 `LICENSES/Apache-2.0.txt`：https://www.apache.org/licenses/LICENSE-2.0

GPL-3.0、CC BY 4.0 与 CC BY-SA 4.0 的官方文本分别见：

- https://www.gnu.org/licenses/gpl-3.0.txt
- https://creativecommons.org/licenses/by/4.0/legalcode
- https://creativecommons.org/licenses/by-sa/4.0/legalcode
