# CED Mini audio-tagging model provenance

## Packaged files

Downloaded from the k2-fsa/sherpa-onnx `audio-tagging-models` release on 2026-07-21:

https://github.com/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-mini-audio-tagging-2024-04-19.tar.bz2

- `model.int8.onnx`: 10,451,715 bytes; SHA-256 `ff29f39f9fbe637f72535160e9d006d61d872fdab0fce838672265b9b38cf946`
- `class_labels_indices.csv`: 14,675 bytes; SHA-256 `cdd1049833c4b86127c2773ac0d14a2754b6a6d0d1798002ed5c66e699708429`

The original README in that archive contained only:

> Models in this repo are converted from https://github.com/RicherMans/CED

## License qualification

That archive README does not provide a per-file license or identify the exact upstream checkpoint used for this converted ONNX model. Related upstream pages make different, separately scoped statements:

- RicherMans/CED reference code: GPL-3.0 — https://github.com/RicherMans/CED
- `mispeech/ced-mini` model card: Apache-2.0 — https://huggingface.co/mispeech/ced-mini
- Zenodo CED record publishing original pretrained weights: CC BY 4.0 — https://doi.org/10.5281/zenodo.8275347
- AudioSet annotations: CC BY 4.0; AudioSet ontology: CC BY-SA 4.0 — https://research.google.com/audioset/download.html

These statements do not by themselves prove which license applies to the exact k2-fsa-converted `model.int8.onnx`. Do not describe this conversion bundle as definitively Apache-2.0, GPL-3.0, or CC BY 4.0 without additional confirmation from the archive maintainer or upstream rightsholder. See the repository-root `THIRD_PARTY_NOTICES.md` for the distribution notice.
