# FineDent Dental Case Library

A static website displaying all **47 dental diagnostic cases in English**, with source images, questions, and model-generated Caption / Think / Answer content from the diagnostic-time v2 dataset.

- 47 original cases; 95 diagnostic-time image references.
- Two intentionally text-only cases remain in the directory.
- Three earlier English examples are available as separate versions, each paired with its own original image set.
- 96 unique image files, including the additional image used only in an earlier English example.
- Search by title, diagnosis, or PMC ID; filter by image modality; use direct case links, image enlargement, presentation mode, and printing.

All 47 source questions, captions, reasoning sections, and answers have been translated into English for display. Existing English passages, patient details, measurements, tooth references, evidence identifiers, diagnostic scope, and uncertainty are retained. Three separate earlier English examples remain available with their matching images. The application hides leading image placeholder tokens visually while preserving them in the translated model input.

## Run locally

Open `docs/index.html`, or serve the `docs` directory:

```sh
python -m http.server 8080 --directory docs
```

## GitHub Pages

Publish from the `main` branch and the `/docs` folder. No build service, API key, database, or external JavaScript dependency is required.

## Sources and attribution

`docs/data_manifest.json` records the dataset version, source hashes, image hashes, case identifiers, and provenance. Each case includes its original article link, author credits, and recorded license. Images are copied without alteration and retain the licenses of their original publications. Do not assume a blanket license applies to the entire collection.

`tools/build_data.py` reproduces the website data from the local source artifacts and the three files in `translations/`. The build requires all 47 translations, rejects Chinese characters, and checks numeric tokens, evidence identifiers, image markers, numbered step order, and pre-existing English lines. Source and translated text hashes remain in the provenance manifest. These mechanical checks and translations are not independent clinical adjudications.
