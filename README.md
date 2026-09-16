# FineDent Clinical Reasoning Review

A clinical review website for all **47 dental diagnostic cases in English**, using the original two-column review layout: source images and tabbed reasoning on the left, seven assessment dimensions and an overall recommendation on the right.

- 47 original cases; 95 diagnostic-time image references.
- Two intentionally text-only cases remain available for review.
- Three earlier English examples are available as separate versions, each paired with its own original image set.
- 96 unique image files, including the additional image used only in an earlier English example.
- Search by title, diagnosis, or PMC ID; switch cases with the selector or previous/next buttons. Direct case links, image enlargement, and printing are supported.
- Score seven dimensions from 1–5 or select Unable to assess with an explanation. Record an overall recommendation, focused annotations, source concerns, and feedback on the criteria.
- Drafts save locally by case and text version. No doctor identity fields or server-side assessment collection are used. Export a completed review, or export all reviews including unfinished drafts, as JSON to return to the study team. JSON files can be imported again.

All 47 source questions, captions, reasoning sections, and answers have been translated into English for display. Existing English passages, patient details, measurements, tooth references, evidence identifiers, diagnostic scope, and uncertainty are retained. Three separate earlier English examples remain available with their matching images. The application hides leading image placeholder tokens visually while preserving them in the translated model input.

The review layout reuses the previous `doctor_review/review_template.html`, `review.css`, and `review.js` design. Step counts are derived from each sample, and differential diagnoses, diagnostic chains, and limitations remain visible in their own sections. Case information supplied to the model is expandable in the evidence library. Source reports and independent reference diagnoses are marked unavailable unless added for review.

Static source images are served from the site and are not copied into browser storage. Optional uploaded images are stored only as local draft overrides and are included in exported review files. The browser reports a storage failure if its local quota is unavailable; export the drafts before leaving in that situation.

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

`tools/verify_site.py` checks the collection in Microsoft Edge through Playwright, including case content, image decoding, scoring, isolated drafts, JSON round trips, and responsive layout. Set `COT_SITE_URL` to check a deployed copy.
