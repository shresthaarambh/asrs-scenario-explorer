# ASRS Scenario Explorer — free browser edition

Live website: https://aarambhshrestha.com/asrs-scenario-explorer/

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

Frozen semantic and hybrid retrieval are now available in the local static
edition. They reuse the graph site's pinned aviation EmbeddingGemma 2 browser
model and a verified 47,723-report ASRS vector index. The semantic vectors are
derived from the graph site's original-ASRS block and reordered to this site's
report catalogue before use. The browser loads the model and vectors lazily on
the first semantic query; no Python process or CIS 634 benchmark run is needed
at query time. No similarity probabilities or automatic relevance judgments are
invented. Browser timings include fetching the report batches and semantic assets
on first use; cached searches can be faster.

The method selector also lists the paper's Qwen3-Embedding 8B frozen/adapted,
Qwen3 fusion, reranker, and proposed SCRQA pipeline as research benchmarks.
Those entries are intentionally disabled in this browser edition because their
matching checkpoints and full-corpus indexes are not packaged here. The site
has two workspace tabs: Search and Graph. Graph opens the companion explorer
checkout locally and does not copy the graph corpus.

Flight-stage suggestions use scenario wording and top-report phase labels. They
select illustrations; they are not a validated incident classifier. Scores are
ranking values, not probabilities that reports describe the same incident.

## Run or update

Run `python3 -m http.server 8080` from this repository and open
http://localhost:8080. The data, lexical index, and semantic index are already
generated. GitHub Pages
publishes the `main` branch, root folder. Push website edits to `main` to update.
The website uses relative asset URLs so it also works under its project path.
Run `node tests/search.test.cjs` with Node 22 or later to compare the browser
worker with eleven saved Python reference rankings, scores, passages, counts,
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
`stem-overrides.json` preserves PyStemmer's newer stemming for 55 word forms
found by comparing both stemmers across all 54,847 observed corpus word forms.
