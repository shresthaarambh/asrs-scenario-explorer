# ASRS Scenario Explorer — free browser edition

Live website: https://shresthaarambh.github.io/asrs-scenario-explorer/

This independent repository contains **only the website and its public search
data**. It does not push changes into the original class project repository.

Search runs entirely in a Web Worker in your browser. There is no paid server,
API key, Python process, or query submission service. The first visit downloads
the compressed keyword index; full reports are fetched in small batches only
when needed. A current browser supporting Web Workers and DecompressionStream
is required. Opening index.html directly with file:// does not work.

## What works

- Real BM25 search over all 47,723 prepared NASA ASRS reports and 136,842 passages.
- The original BM25 passage weights: k1=1.2, b=0.75, English stopword removal,
  English Snowball stemming, and maximum passage score per report.
- Full report accounts, all 23 prepared columns, matching passages, and sidebar.
- Pagination, adjustable high-score band, score distributions and actual counts.
- Manual relevance assessments and JSON export; saved only in this browser.
- Day/night mode, homepage flight-cycle animation, and selectable stage artwork.

**MiniLM and hybrid search are not available in this free static edition.** They
remain available in the original Python app. No similarity probabilities or
automatic relevance judgments are invented. Browser timings include fetching
the report batches on a first request; cached searches can be faster.

Flight-stage suggestions use scenario wording and top-report phase labels. They
select illustrations; they are not a validated incident classifier. Scores are
ranking values, not probabilities that reports describe the same incident.

## Run or update

Run `python3 -m http.server 8080` from this repository and open
http://localhost:8080. The data and index are already generated. GitHub Pages
publishes the `main` branch, root folder. Push website edits to `main` to update.
The website uses relative asset URLs so it also works under its project path.
Run `node tests/search.test.cjs` with Node 22 or later to compare the browser
worker with nine saved Python reference rankings, scores, passages, counts,
and distributions, and to check pagination and high-score filtering offline.

The full project can regenerate this site with `python scripts/build_pages.py`.
That exporter uses the original prepared data and BM25 implementation. The
`data/manifest.json` records SHA256 hashes; the browser verifies downloaded
compressed files before using them. No model weights or personal credentials
are included here.

## Credits and data

Class research project: Jacob Tang and Aarambh Shrestha, CIS 634.
Source project: https://github.com/Jacob19999/cis634
Public dataset: https://huggingface.co/datasets/elihoole/asrs-aviation-reports
Reports are de-identified voluntary accounts, used for research and exploration.

Flight artwork was supplied by Aarambh Shrestha, with the Hairline visual system
by Lucas Markes. Geist font licensing is included in FONT-LICENSE.txt.
The vendored snowball-stemmers 0.6.0 package is by Oleg Mazko
(https://github.com/mazko/jssnowball); see vendor/SNOWBALL-LICENSE.txt.
Its npm metadata declares ISC; the upstream repository's BSD license is retained.
