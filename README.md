# FineDent Dental Case Library

A static website displaying all **47 dental diagnostic cases** from the diagnostic-time v2 dataset, with source images, questions, and model-generated Caption / Think / Answer content.

- 47 original cases; 95 diagnostic-time image references.
- Two intentionally text-only cases remain in the directory.
- Three earlier English examples are available as separate versions, each paired with its own original image set.
- 96 unique image files, including the additional image used only in an earlier English example.
- Search by title, diagnosis, or PMC ID; filter by image modality; use direct case links, image enlargement, presentation mode, and printing.

The complete source dataset contains Chinese reasoning. The English examples are separate earlier rewrites. No new diagnostic text or translations were generated for this website. The application hides leading image placeholder tokens visually; the underlying original model input remains preserved in the data.

## Run locally

Open `docs/index.html`, or serve the `docs` directory:

```sh
python -m http.server 8080 --directory docs
```

## GitHub Pages

Publish from the `main` branch and the `/docs` folder. No build service, API key, database, or external JavaScript dependency is required.

## Sources and attribution

`docs/data_manifest.json` records the dataset version, source hashes, image hashes, case identifiers, and provenance. Each case includes its original article link, author credits, and recorded license. Images are copied without alteration and retain the licenses of their original publications. Do not assume a blanket license applies to the entire collection.

`tools/build_data.py` reproduces the website data from the local source artifacts. Original user prompts and model responses are preserved. These are model-generated research examples, not independently adjudicated diagnoses.
