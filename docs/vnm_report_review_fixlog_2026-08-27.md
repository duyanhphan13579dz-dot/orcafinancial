# VNM report review fix log — 27 August 2026

## Current status after first review-driven revision

The report now addresses several high-priority issues from the review file. The cover no longer shows a conclusive fair-value line when valuation confidence is low; the market-cap wording is corrected to `tỷ VNĐ`; the financial-health section now discloses that current figures are estimate/degraded rather than audited actuals; the scenario table shows weighted contribution; the forecast section includes model assumptions; and moat factors with missing evidence are rendered as `Chưa xác định` instead of pseudo-scores.

## Remaining visual/content issues found in the regenerated PDF

| Area | Observation | Needed adjustment |
|---|---|---|
| Cover summary box | The executive conclusion text wraps a little tightly in the fixed-height card after the longer confidence-gated wording was added | Increase the card height slightly or shorten the sentence to avoid cramped final lines |
| Section 6 pagination | The scenario table starts on page 4 and continues onto page 5 without an ideal visual break | Prefer moving Section 6 earlier or forcing the section to start with enough remaining space so the table does not split awkwardly |
| Section 8 title | The title still wraps into two lines because it is too long for the width | Either shorten the title or reduce font size slightly for this section heading |
| Moat summary row | `Điểm hào kinh tế` still shows `0/100` before `chưa đủ dữ liệu`, which visually suggests a real zero score | Replace the row value with a data-coverage statement when moat rating is insufficient_data |
| Mixed untranslated domain terms | Some narrative still contains partially untranslated or awkward technical phrases such as `actual audited`, `proxy ngành`, `benchmark`, and `retention` in longer paragraphs | Extend the normalization rules and rewrite fixed narrative strings into clean Vietnamese |
| Data labeling | The report now discloses estimate/degraded status, but the quarter table itself still lists raw periods like `Q3/2026` without a per-row classification tag | Add a compact source/classification note near the table or append a status marker to period labels |

## Verification artifacts

- Generated sample PDF: `/home/ubuntu/work/VNM_BAO_CAO_PHAN_TICH_VNM_REVIEW.pdf`
- Extracted text: `/home/ubuntu/work/VNM_BAO_CAO_PHAN_TICH_VNM_REVIEW.txt`


## Completed review-driven changes

The following high-priority review items are now implemented: market-cap unit wording is normalized to billion VND; degraded financial history is explicitly marked `Ước tính` beside each quarter; valuation is gated by valuation confidence and no longer presents a conclusive fair value when source confidence is low; forecast probabilities are normalized and each scenario exposes weighted contribution; forecast assumptions include revenue, margin, EPS/multiple and cash-flow caveats; health-score methodology and weights are shown in the PDF; DuPont decomposition is rendered from available health indicators; moat factors retain `Chưa xác định` and coverage rather than defaulting to 50/100; causal text is cleaned before rendering; and investment-thesis WHY BUY/WHY NOT/invalidation text is localized and no longer emits the reviewed raw English phrases.

The final local smoke test generated `/home/ubuntu/work/VNM_BAO_CAO_PHAN_TICH_REVIEWED.pdf` as a valid eight-page A4 PDF. The targeted English-fragment scan was empty. Pages contained 665, 2920, 2648, 2110, 3152, 2494, 1358 and 1277 extracted characters respectively, with no empty page. The report visibly shows the confidence-gated conclusion, DuPont table, scenario contribution column, assumptions bridge and Unknown moat treatment.
