# Mitgelieferte Software

Essensplan lädt die Texterkennung lokal. Die unveränderten Browser-Dateien,
das Sprachmodell und die jeweiligen Lizenztexte liegen unter
[`custom_components/essensplan/frontend/ocr/`](custom_components/essensplan/frontend/ocr/).
Die Projektlizenz ändert die Lizenzen dieser Komponenten nicht.

| Bestandteil | Quelle und Stand | Lizenzdatei im OCR-Ordner |
| --- | --- | --- |
| Tesseract.js und Browser-Worker | [7.0.0](https://github.com/naptha/tesseract.js/tree/v7.0.0) | `TESSERACT-JS-LICENSE.md`, `tesseract.min.js.LICENSE.txt`, `worker.min.js.LICENSE.txt` |
| Tesseract.js Core (LSTM, WebAssembly) | [7.0.0](https://github.com/naptha/tesseract.js-core/tree/v7.0.0) | `TESSERACT-CORE-LICENSE.txt` |
| Deutsches OCR-Modell `deu.traineddata` | [tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0) | `TESSDATA-LICENSE.txt` |
| Emscripten | [4.0.15](https://github.com/emscripten-core/emscripten/tree/4.0.15) | `EMSCRIPTEN-LICENSE.txt` |

Die Hinweise und Lizenzen für weitere Browser-Bestandteile, darunter Buffer,
ieee754, Regenerator, zlib.js, bmp-js, idb-keyval, is-url und
wasm-feature-detect, liegen ebenfalls im OCR-Ordner. Die in den
[Core-Quellen](https://github.com/naptha/tesseract.js-core/tree/v7.0.0/third_party)
referenzierten Fassungen von Tesseract, Leptonica, libjpeg, GIFLIB, libpng,
LibTIFF, libwebp, OpenLibm und zlib sind dort durch ihre Original-Lizenztexte
und Hinweise abgedeckt. Die entsprechenden Quellstände und Buildskripte
sind im verlinkten Core-Repository verfügbar.
