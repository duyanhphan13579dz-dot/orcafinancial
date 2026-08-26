# VNM PDF markup review

Source: `/home/ubuntu/upload/VNM_BAO_CAO_PHAN_TICH.pdf`
Reviewed pages: 1-4 of 8 on 2026-08-26.

## Highlighted content to remove

The user-highlighted regions observed so far are these exact elements:

| Page | Highlighted content | Required action |
|---|---|---|
| 1 | `STOCK INTELLIGENCE` in the top cover line `ORCA FINANCIAL · STOCK INTELLIGENCE` | Replace with `INTELLIGENT INVESTMENT` |
| 1 | Executive summary sentence: `Khuyến nghị theo technical engine: Hold. Expected value theo xác suất scenario là 38,77 nghìn VNĐ.` | Remove this exact sentence and replace with a cleaner Vietnamese-only summary block |
| 4 | Forecast intro line: `Mô hình ORCA Forecast v1.1. Forecast là estimate; prediction confidence 57%.` | Remove this line or replace with a fully Vietnamese sentence without English terms |
| 4 | News bullets with English tags such as `[LOW · general]` | Convert all of them to full Vietnamese labels and cleaner wording |

## Formatting issues confirmed

1. The document still contains mixed English/Vietnamese labels such as `Hold`, `Technical score`, `Expected value`, `Forecast`, `prediction confidence`, `Current state`, `estimate`, `degraded`, `MEDIUM`, `valuation`.
2. The line spacing is still slightly tight in paragraph blocks and bullet regions; spacing needs to be made more even for readability.
3. The closing section must become an actual overall stock assessment, not a disclosure-focused paragraph.
4. Cover branding line must use `ORCA FINANCIAL · INTELLIGENT INVESTMENT` while small footer branding can remain unchanged as requested.

## Pending verification

Pages 5-8 still need review to catch any additional highlighted regions or remaining English text before finalizing the text replacement pass.

## Additional highlighted content from pages 5-8

The remaining highlighted areas confirm a clear editing rule: most highlighted text is either mixed-language disclosure, internal engine jargon, or English classification tags that should be removed from the user-facing PDF.

| Page | Highlighted content | Required action |
|---|---|---|
| 5 | All bullet prefixes like `[LOW · general]` | Replace with Vietnamese-only event labels such as `Tác động thấp · Tin chung` or remove bracket taxonomy entirely |
| 6 | Title `CROSS-MODULE, HÀO KINH TẾ VÀ INVESTMENT THESIS` | Rename fully to Vietnamese except where user allowed English only for cover/footer branding |
| 6 | `Market regime`, `risk level`, `Cross-module score`, all bracket tags `[MARKET]`, `[COMMODITY]`, `[CAUSAL]`, `[MOAT]`, `[GROWTH]`, `[WHY BUY]`, `[WHY NOT]`, `[INVALIDATION]` | Convert all to Vietnamese labels |
| 6 | Sentences containing `current-state health`, `Moat score`, `Expected value`, `current financial health`, `commodity, FX, macro market regime`, `support` | Rewrite to full Vietnamese and simplify phrasing |
| 7 | Table row labels `MARKET`, `INDUSTRY`, `COMMODITY`, `FX`, `MACRO` | Convert to Vietnamese `Thị trường`, `Ngành`, `Hàng hóa`, `Tỷ giá`, `Vĩ mô` |
| 7 | Values `unknown`, `neutral`, `positive`, `change N/A`, `strength N/A` | Convert to Vietnamese `chưa xác định`, `trung tính`, `tích cực`, `chưa có dữ liệu` |
| 7 | Closing explanatory sentence under cycle section | Remove from final-facing summary and replace with concise Vietnamese assessment |
| 8 | Entire disclosure block starting from `Cross-module disclosure:` through `Các trường estimate/degraded...` | Remove from the closing commentary area |
| 8 | One-line conclusion `KẾT LUẬN MỘT DÒNG: VNM — Hold; theo dõi fair value kỳ vọng...` | Rewrite to a true overall stock assessment in Vietnamese |
| 8 | Final disclaimer line beginning `Báo cáo chỉ nhằm mục đích nghiên cứu...` | Keep if needed, but de-emphasize and ensure it is not highlighted in main conclusion region |

## Editing decisions

The revised report should keep analytical content but reduce internal-system wording. Disclosures about source quality and estimate/degraded status should remain in a compact methodology or footnote area, not dominate the conclusion page.

## Findings from the Vietnamese redesign draft

The Vietnamese redesign removed the originally highlighted disclosure block on the last page and updated the cover line to `INTELLIGENT INVESTMENT`. However, three issues remained in the draft `VNM_BAO_CAO_PHAN_TICH_VIET_FINAL.pdf`.

| Area | Remaining issue | Required fix |
|---|---|---|
| Page 5 | Section 7 is too sparse and leaves a large blank area before page 6 | Remove the forced page break before section 8 so the next section can continue naturally when there is room |
| Pages 6-7 | Dynamic text still leaks English phrases such as `DATA SYNCING`, `current price`, `competitive advantage`, and untranslated moat/thesis evidence | Apply translation to row values too, and extend dynamic string normalization rules |
| Page 6 | Section title wraps awkwardly because it is too long | Keep the title but let the section begin higher and use available space from page 5 |

The final version should therefore reuse the freed space on page 5, and ensure row values are normalized through the same Vietnamese text cleaner already used for paragraphs, bullets, and tables.
