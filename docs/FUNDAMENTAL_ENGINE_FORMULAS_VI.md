# Công thức tính toán — Hiệu suất kinh doanh · Sức khỏe tài chính · Định giá

> Phạm vi: tab **Cơ bản** của mỗi cổ phiếu (`/stocks/:symbol`).
> Nguồn dữ liệu: **báo cáo tài chính đã xác minh** (VnDirect / Vietstock / CafeF / filing)
> + giá thị trường thực. Hệ thống **không dùng số liệu synthetic** — thiếu dữ liệu thì
> chỉ số để trống (`null`), không nội suy thành 0.
>
> Mã nguồn engine:
> - `src/lib/fundamental-engine.ts` — chuẩn hoá kỳ báo cáo, cửa sổ LTM, số dư bình quân
> - `src/lib/fundamental-performance.ts` — hiệu suất kinh doanh
> - `src/lib/fundamental-health.ts` — sức khỏe tài chính nâng cao
> - `src/lib/fundamental-valuation.ts` — định giá
> - `src/lib/fundamental-analytics-service.ts` — tầng nạp dữ liệu + cache
> - API: `GET /api/v1/stocks/:symbol/fundamental-analytics`
> - Kiểm thử: `tests/fundamental-engine.test.ts`, `tests/fundamental-analytics-service.test.ts`

---

## 0. Quy ước đơn vị

| Đại lượng | Đơn vị |
|---|---|
| Số tiền trên BCTC (doanh thu, LN, tài sản, nợ, dòng tiền) | **tỷ VND** |
| Giá cổ phiếu, EPS, BVPS, DPS | **nghìn VND** |
| Số cổ phiếu lưu hành | **triệu cổ phiếu** |

Hệ quả dùng xuyên suốt engine:

```
Vốn hoá (tỷ VND)   = Giá (nghìn VND) × Số CP (triệu)
EPS (nghìn VND/CP) = LN ròng (tỷ VND) ÷ Số CP (triệu)
BVPS (nghìn VND/CP)= VCSH (tỷ VND) ÷ Số CP (triệu)
```

Nếu BCTC không khai báo `sharesOutstanding`, engine suy ngược:

```
Số CP (triệu) = LN ròng (tỷ VND) ÷ EPS (nghìn VND)
```

Ký hiệu: **LTM** = *Last Twelve Months* (12 tháng gần nhất); **BQ** = bình quân đầu kỳ/cuối kỳ.

---

## 1. Chuẩn hoá kỳ báo cáo (nền tảng của mọi công thức)

Đây là phần sửa lỗi lớn nhất so với bản cũ.

### 1.1. Phát hiện BCTC luỹ kế hay riêng quý

BCTC quý của doanh nghiệp Việt Nam thường trình bày **luỹ kế từ đầu năm (YTD)**.
Bản cũ nhân quý mới nhất với 4, nên với BCTC luỹ kế Q3 (9 tháng) kết quả bị
phóng đại gấp 3 lần.

Engine phát hiện bằng cách so sánh các quý **liền kề trong cùng năm tài chính**:

```
pairs              = số cặp quý liền kề so sánh được (cùng năm, quý sau = quý trước + 1)
nonDecreasing      = số cặp có Doanh thu(q) ≥ Doanh thu(q−1)
strictlyIncreasing = số cặp có Doanh thu(q) > 1.05 × Doanh thu(q−1)
decreasing         = số cặp có Doanh thu(q) < 0.95 × Doanh thu(q−1)

Nếu nonDecreasing = pairs VÀ strictlyIncreasing ≥ max(1, ⌊pairs/2⌋) → "cumulative-ytd"
Ngược lại nếu decreasing > 0                                      → "standalone"
Còn lại                                                          → "unknown"
```

Có thể ép bằng biến môi trường `FINANCIAL_STATEMENT_BASIS=standalone|cumulative-ytd`.

### 1.2. Tách số luỹ kế về số riêng quý

Áp dụng cho **báo cáo kết quả kinh doanh** và **lưu chuyển tiền tệ** (số dòng).
**Bảng cân đối kế toán là số dư thời điểm nên giữ nguyên.**

```
Riêng(Q1) = Luỹ kế(Q1)
Riêng(Qn) = Luỹ kế(Qn) − Luỹ kế(Qn−1)     với n = 2, 3, 4
```

### 1.3. Cửa sổ LTM (12 tháng gần nhất)

Ưu tiên theo thứ tự:

| # | Phương pháp | Công thức | Ghi chú |
|---|---|---|---|
| 1 | `sum-4q` | `LTM = Σ 4 quý riêng lẻ liên tiếp` | chính xác nhất |
| 2 | `ytd-plus-fy-minus-pytd` | `LTM = FY(năm trước) + YTD(năm nay) − YTD(cùng kỳ năm trước)` | khi chưa đủ 4 quý liên tiếp nhưng có đủ số năm trước |
| 3 | `full-year` | `LTM = FY(năm nay)` | khi kỳ mới nhất là Q4 |
| 4 | `annualized-ytd` | `LTM = YTD × 4/n` | nội suy, **có cảnh báo** vì bỏ qua mùa vụ |

### 1.4. Số dư bình quân (mẫu số chuẩn)

Mọi chỉ số sinh lời/vòng quay dùng **bình quân số dư đầu kỳ và cuối kỳ LTM**,
trong đó "đầu kỳ" là số dư **cách đúng 4 quý** (không phải quý liền trước):

```
Số dư BQ = (Số dư cuối kỳ LTM + Số dư đầu kỳ LTM) ÷ 2
```

### 1.5. Hệ số năm hoá cho các module cũ

`evaluateHealthDetail()` và `buildFundamentalChart()` nhận thêm tham số
`annualizationFactor`:

```
BCTC riêng từng quý      → hệ số = 4      (giữ hành vi cũ)
BCTC luỹ kế đến quý n    → hệ số = 4 / n
```

---

## 2. HIỆU SUẤT KINH DOANH

Điểm tổng có trọng số 5 trụ cột:

| Trụ cột | Trọng số |
|---|---|
| Tăng trưởng | 20% |
| Biên lợi nhuận | 20% |
| Sức sinh lời | 25% |
| Hiệu quả vận hành | 20% |
| Chất lượng lợi nhuận | 15% |

```
Điểm nhóm  = trung bình cộng điểm các chỉ số có dữ liệu trong nhóm
Điểm tổng  = Σ(điểm nhóm × trọng số) ÷ Σ(trọng số các nhóm có dữ liệu)
Hạng       = A ≥ 80 · B ≥ 65 · C ≥ 45 · D ≥ 25 · E < 25
```

Trọng số được **chuẩn hoá lại** theo các nhóm có dữ liệu để doanh nghiệp thiếu
một vài chỉ số không bị "phạt oan".

### 2.1. Tăng trưởng (20%)

| Chỉ số | Công thức |
|---|---|
| Tăng trưởng doanh thu LTM (YoY) | `(DT LTM ÷ DT LTM kỳ trước − 1) × 100` |
| Tăng trưởng doanh thu QoQ | `(DT quý này ÷ DT quý trước − 1) × 100` |
| Tăng trưởng doanh thu cùng kỳ | `(DT quý này ÷ DT cùng quý năm trước − 1) × 100` |
| CAGR doanh thu n năm | `((DT năm cuối ÷ DT năm đầu)^(1/n) − 1) × 100` — chỉ dùng năm có đủ 4 quý |
| Tăng trưởng LN ròng LTM | `(LN LTM − LN LTM kỳ trước) ÷ \|LN LTM kỳ trước\| × 100` (chấp nhận gốc âm) |
| Tăng trưởng LN ròng cùng kỳ | `(LN quý này − LN cùng quý năm trước) ÷ \|LN cùng quý năm trước\| × 100` |
| Tăng trưởng EBITDA LTM | `(EBITDA LTM ÷ EBITDA LTM kỳ trước − 1) × 100` |
| Tăng trưởng EPS LTM | `(EPS LTM ÷ EPS LTM kỳ trước − 1) × 100` |

### 2.2. Biên lợi nhuận (20%)

| Chỉ số | Công thức |
|---|---|
| Biên lợi nhuận gộp | `LN gộp ÷ Doanh thu thuần × 100` |
| Biên EBITDA | `EBITDA ÷ Doanh thu thuần × 100` |
| Biên lợi nhuận hoạt động | `EBIT ÷ Doanh thu thuần × 100` |
| Biên lợi nhuận ròng | `LN ròng ÷ Doanh thu thuần × 100` |
| Biến động biên gộp | `Biên gộp LTM − Biên gộp LTM kỳ trước` (điểm %) |
| Biến động biên ròng | `Biên ròng LTM − Biên ròng LTM kỳ trước` (điểm %) |
| Thuế suất hiệu dụng | `Thuế TNDN ÷ LN trước thuế × 100` |
| Chi phí lãi vay / Doanh thu | `Chi phí lãi vay ÷ Doanh thu thuần × 100` |

### 2.3. Sức sinh lời (25%)

| Chỉ số | Công thức |
|---|---|
| **ROE** | `LN ròng LTM ÷ VCSH bình quân × 100` |
| **ROA** | `LN ròng LTM ÷ Tổng tài sản bình quân × 100` |
| **ROIC** | `NOPAT ÷ Vốn đầu tư bình quân × 100` |
| NOPAT | `EBIT × (1 − thuế suất hiệu dụng)` |
| Vốn đầu tư (IC) | `VCSH + Nợ vay chịu lãi − Tiền & tương đương − Đầu tư tài chính ngắn hạn` |
| **ROCE** | `EBIT ÷ (Tổng tài sản − Nợ ngắn hạn) × 100` |
| Chênh ROE − ROA | `ROE − ROA` (đo mức ROE phụ thuộc đòn bẩy nợ) |
| Chênh lệch kinh tế | `ROIC − 12%` (dương ⇒ EVA > 0, doanh nghiệp tạo giá trị) |
| Vòng quay tổng tài sản | `Doanh thu LTM ÷ Tổng tài sản bình quân` |
| Đòn bẩy vốn chủ | `Tổng tài sản BQ ÷ VCSH bình quân` |

#### DuPont 3 bước

```
ROE = Biên LN ròng × Vòng quay tổng tài sản × Đòn bẩy VCSH
```

#### DuPont 5 bước

```
ROE = (LNST/LNTT) × (LNTT/EBIT) × (EBIT/DT) × (DT/TS BQ) × (TS BQ/VCSH BQ)
    = Gánh nặng thuế × Gánh nặng lãi vay × Biên EBIT × Vòng quay TS × Đòn bẩy
```

Đồng nhất thức: 5 nhân tử triệt tiêu nhau và bằng đúng `LNST ÷ VCSH BQ`
(được kiểm chứng bằng unit test).

### 2.4. Hiệu quả vận hành (20%)

| Chỉ số | Công thức |
|---|---|
| Vòng quay hàng tồn kho | `Giá vốn LTM ÷ Hàng tồn kho bình quân` |
| **DIO** (ngày tồn kho) | `365 ÷ Vòng quay hàng tồn kho` |
| **DSO** (kỳ thu tiền) | `Phải thu bình quân ÷ Doanh thu LTM × 365` |
| **DPO** (kỳ thanh toán) | `Phải trả người bán BQ ÷ Giá vốn LTM × 365` |
| **CCC** (chu kỳ tiền mặt) | `DIO + DSO − DPO` |
| Biến động CCC | `CCC quý này − CCC cùng quý năm trước` |
| Vòng quay TSCĐ | `Doanh thu LTM ÷ TSCĐ bình quân` |
| Cường độ đầu tư | `Capex LTM ÷ Doanh thu LTM × 100` |
| Đòn bẩy hoạt động (DOL) | `%Δ EBIT ÷ %Δ Doanh thu` (LTM so với LTM kỳ trước) |

Nếu BCTC không tách "phải trả người bán", engine ước:
`Phải trả ≈ Nợ ngắn hạn − Nợ vay ngắn hạn`.

### 2.5. Chất lượng lợi nhuận (15%)

| Chỉ số | Công thức | Ý nghĩa |
|---|---|---|
| Hệ số chuyển đổi tiền | `OCF LTM ÷ LN ròng LTM` | LN kế toán có thành tiền thật không |
| Hệ số chuyển đổi FCF | `FCF LTM ÷ LN ròng LTM` | |
| Biên dòng tiền tự do | `FCF LTM ÷ Doanh thu LTM × 100` | |
| Tỷ lệ dồn tích (Accruals) | `(LN ròng − OCF) ÷ Tổng tài sản BQ × 100` | càng thấp chất lượng LN càng cao |
| OCF / Doanh thu | `OCF LTM ÷ Doanh thu LTM × 100` | |
| Capex / Khấu hao | `Capex ÷ Chi phí khấu hao` | >1 ⇒ đang mở rộng năng lực |
| Tỷ lệ chi trả cổ tức | `Cổ tức đã trả LTM ÷ LN ròng LTM × 100` | |

Với `FCF = OCF − Capex`.

---

## 3. SỨC KHỎE TÀI CHÍNH

### 3.1. Altman Z'-Score (bản cho thị trường mới nổi / phi sản xuất)

```
Z' = 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4

X1 = (Tài sản ngắn hạn − Nợ ngắn hạn) ÷ Tổng tài sản      (vốn lưu động)
X2 = Lợi nhuận chưa phân phối ÷ Tổng tài sản
X3 = EBIT (LTM) ÷ Tổng tài sản
X4 = VCSH sổ sách ÷ Tổng nợ phải trả
```

| Vùng | Ngưỡng | Diễn giải |
|---|---|---|
| An toàn | `Z' > 2.6` | rủi ro mất khả năng thanh toán rất thấp |
| Vùng xám | `1.1 ≤ Z' ≤ 2.6` | cần theo dõi sát nợ đáo hạn và dòng tiền |
| Nguy hiểm | `Z' < 1.1` | cảnh báo nguy cơ mất khả năng thanh toán |

Điểm quy đổi 0–100: `score = min(100, Z' ÷ 4.2 × 100)`.

### 3.2. Piotroski F-Score (0–9 điểm)

Mỗi tiêu chí đạt = 1 điểm; tiêu chí thiếu dữ liệu **không bị tính là trượt**,
mà bị loại khỏi mẫu (`evaluated`).

| # | Tiêu chí | Điều kiện |
|---|---|---|
| 1 | ROA dương | `LN ròng LTM ÷ Tổng tài sản > 0` |
| 2 | Dòng tiền hoạt động dương | `OCF LTM > 0` |
| 3 | ROA cải thiện | `ROA kỳ này > ROA kỳ trước` |
| 4 | Chất lượng lợi nhuận | `OCF > LN ròng` |
| 5 | Đòn bẩy giảm | `Nợ dài hạn/TS kỳ này < kỳ trước` |
| 6 | Thanh khoản cải thiện | `Current ratio kỳ này > kỳ trước` |
| 7 | Không phát hành thêm CP | `Số CP kỳ này ≤ 1.005 × số CP kỳ trước` |
| 8 | Biên gộp cải thiện | `Biên gộp kỳ này > kỳ trước` |
| 9 | Vòng quay tài sản cải thiện | `Vòng quay TS kỳ này > kỳ trước` |

```
Điểm chuẩn hoá = fScore ÷ số tiêu chí đánh giá được × 100
≥7: cải thiện rõ rệt · 5–6: trung tính · 3–4: thận trọng · ≤2: suy yếu
```

### 3.3. Beneish M-Score (khả năng "làm đẹp" số liệu)

```
M = −4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI
      + 0.115·DEPI − 0.172·SGAI + 4.679·TATA − 0.327·LVGI

DSRI = (Phải thu_t / DT_t) ÷ (Phải thu_{t−1} / DT_{t−1})
GMI  = Biên gộp_{t−1} ÷ Biên gộp_t
AQI  = (1 − (TSCĐ_t + TSNH_t)/TS_t) ÷ (1 − (TSCĐ_{t−1} + TSNH_{t−1})/TS_{t−1})
SGI  = DT_t ÷ DT_{t−1}
DEPI = Tỷ lệ khấu hao_{t−1} ÷ Tỷ lệ khấu hao_t     với Tỷ lệ KH = KH / (TSCĐ + KH)
SGAI = (CP QLDN_t / DT_t) ÷ (CP QLDN_{t−1} / DT_{t−1})
TATA = (LN ròng − OCF) ÷ Tổng tài sản
LVGI = Đòn bẩy_{t−1} ÷ Đòn bẩy_t                    với Đòn bẩy = (Nợ DH + Nợ NH)/TS
```

| M-Score | Kết luận |
|---|---|
| `M < −2.22` | ít dấu hiệu điều chỉnh số liệu |
| `−2.22 ≤ M ≤ −1.78` | vùng trung tính, cần theo dõi |
| `M > −1.78` | cảnh báo khả năng lợi nhuận bị điều chỉnh |

Cần tối thiểu 6/8 biến; nếu thiếu thì trả về `null` kèm thông báo.

### 3.4. Bộ chỉ số thanh toán & đòn bẩy (35% trọng số điểm sức khỏe)

| Chỉ số | Công thức | Ngưỡng tham chiếu |
|---|---|---|
| Thanh toán hiện hành | `TSNH ÷ Nợ ngắn hạn` | 1.5 |
| Thanh toán nhanh | `(TSNH − Hàng tồn kho) ÷ Nợ ngắn hạn` | 1.0 |
| Tiền mặt / Nợ ngắn hạn | `(Tiền + Đầu tư ngắn hạn) ÷ Nợ ngắn hạn` | 0.2 |
| Nợ vay / VCSH | `Nợ vay chịu lãi ÷ VCSH` | 1.0 |
| Nợ vay / Tổng tài sản | `Nợ vay chịu lãi ÷ Tổng tài sản × 100` | 40% |
| Tỷ lệ tự chủ tài chính | `VCSH ÷ Tổng tài sản × 100` | 50% |
| Khả năng trả lãi (ICR) | `EBIT LTM ÷ Chi phí lãi vay LTM` | 5 lần |
| EBITDA / Lãi vay | `EBITDA LTM ÷ Chi phí lãi vay LTM` | 6 lần |
| Nợ ròng / EBITDA | `(Nợ vay − Tiền − Đầu tư NH) ÷ EBITDA LTM` | 1.5 lần |
| Tổng nợ / EBITDA | `Tổng nợ vay ÷ EBITDA LTM` | 2.5 lần |
| Thời gian phủ nợ đáo hạn | `(Tiền + OCF LTM) ÷ Nợ đáo hạn 12 tháng × 12` (tháng) | 12 tháng |
| EBIT / Tổng nợ vay | `EBIT LTM ÷ Tổng nợ vay × 100` | 20% |
| Chi phí nợ sau thuế | `(Chi phí lãi vay ÷ Nợ vay BQ) × (1 − thuế suất)` | 8% |

Với `Nợ vay chịu lãi = Nợ dài hạn + Nợ ngắn hạn` (không gồm phải trả người bán).

### 3.5. Cờ cảnh báo (distress flags)

- `Current ratio < 1` → mất cân đối thanh khoản
- `ICR < 1.5` → EBIT không đủ bù chi phí lãi vay
- `Nợ ròng/EBITDA > 4` → áp lực tái cấp vốn cao
- `VCSH ≤ 0` → mất an toàn tài chính nghiêm trọng
- `Thời gian phủ nợ đáo hạn < 6 tháng`

### 3.6. Điểm sức khỏe tổng hợp

| Thành phần | Trọng số |
|---|---|
| Thanh toán & đòn bẩy | 35% |
| Altman Z' | 25% |
| Piotroski F | 20% |
| Beneish M | 10% |
| An toàn tăng trưởng | 10% |

```
An toàn tăng trưởng = ramp(Tăng trưởng EBITDA LTM − Tăng trưởng nợ vay, −25%, +15%)
Điểm tổng = Σ(điểm × trọng số) ÷ Σ(trọng số các thành phần có dữ liệu)
```

Kèm theo là **radar 6 trụ cột** sẵn có (`evaluateHealthDetail`): thanh khoản 10%,
đòn bẩy 20%, hiệu quả hoạt động 15%, sinh lời 25%, tăng trưởng 15%, dòng tiền 15% —
nay đã dùng hệ số năm hoá `4/n` đúng chuẩn.

---

## 4. ĐỊNH GIÁ DOANH NGHIỆP

### 4.1. Đại lượng nền

```
Vốn hoá (tỷ)  = Giá (nghìn) × Số CP (triệu)
Nợ ròng       = Nợ vay chịu lãi − Tiền & tương đương − Đầu tư tài chính ngắn hạn
EV            = Vốn hoá + Nợ ròng
EPS LTM       = LN ròng LTM ÷ Số CP
BVPS          = VCSH ÷ Số CP
DPS LTM       = Cổ tức đã trả LTM ÷ Số CP
FCF LTM       = OCF LTM − Capex
```

### 4.2. Bội số và so sánh với ngành

| Bội số | Công thức |
|---|---|
| P/E | `Giá ÷ EPS LTM` |
| P/B | `Giá ÷ BVPS` |
| EV/EBITDA | `EV ÷ EBITDA LTM` |
| EV/Doanh thu | `EV ÷ Doanh thu LTM` |
| EV/EBIT | `EV ÷ EBIT LTM` |
| P/FCF | `Vốn hoá ÷ FCF LTM` |
| P/OCF | `Vốn hoá ÷ OCF LTM` |
| PEG | `P/E ÷ % tăng trưởng doanh thu LTM` |
| Tỷ suất cổ tức | `DPS LTM ÷ Giá × 100` |

#### Bội số ngành — **không hard-code**, suy ra từ benchmark ngành bằng mô hình Gordon

```
ROE_ngành    = Biên ròng × Vòng quay TS × [1 ÷ (1 − Tỷ lệ nợ)]
P/B ngành    = (ROE_ngành − g) ÷ (Ke − g)                  ← Gordon trên giá trị sổ sách
P/E ngành    = P/B ngành ÷ ROE_ngành
Biên EBITDA  = Biên hoạt động + Tỷ lệ KH/TSCĐ × 0.55
Nợ ròng/EBITDA ngành = (Tỷ lệ nợ − Tiền/TS) ÷ (Biên EBITDA × Vòng quay TS)
EV/EBITDA ngành = P/E ngành × (LN ròng/EBITDA) + Nợ ròng/EBITDA
EV/Sales ngành  = EV/EBITDA ngành × Biên EBITDA

Chênh lệch vs ngành = (Bội số công ty ÷ Bội số ngành − 1) × 100
```

P/B được chặn trong `[0.2, 12]`, EV/EBITDA trong `[1, 60]` để tránh ngoại suy vô lý.

### 4.3. Chi phí vốn — CAPM & WACC

```
Ke = Rf + β × ERP
Kd = Chi phí lãi vay LTM ÷ Nợ vay          (nếu BCTC không tách → mặc định 9%)
Kd sau thuế = Kd × (1 − thuế suất hiệu dụng)
E/(D+E) = Vốn hoá thị trường ÷ (Vốn hoá + Nợ vay)
D/(D+E) = Nợ vay ÷ (Vốn hoá + Nợ vay)

WACC = Ke × E/(D+E) + Kd(1−t) × D/(D+E)
```

Giả định mặc định (ghi đè bằng biến môi trường):

| Tham số | Mặc định | Biến môi trường |
|---|---|---|
| Rf (TPCP VN 10 năm) | 4.50% | `VALUATION_RISK_FREE_RATE` |
| ERP (phần bù rủi ro CP VN) | 9.50% | `VALUATION_EQUITY_RISK_PREMIUM` |
| g (tăng trưởng vĩnh cửu) | 3.00% | `VALUATION_TERMINAL_GROWTH` |
| Số năm giai đoạn 1 | 5 | `VALUATION_STAGE_ONE_YEARS` |
| Trần/sàn tăng trưởng GĐ1 | 25% / 2% | `VALUATION_MAX/MIN_STAGE_ONE_GROWTH` |

```
Tăng trưởng GĐ1 = clamp(Tăng trưởng doanh thu LTM, 2%, 25%)
```

### 4.4. DCF 2 giai đoạn trên FCFF

```
FCF_t = FCF_0 × (1 + g1)^t                       với t = 1..n
PV(GĐ1)  = Σ_{t=1..n} FCF_t ÷ (1 + WACC)^t
TV       = FCF_n × (1 + g) ÷ (WACC − g)
PV(TV)   = TV ÷ (1 + WACC)^n
EV_DCF   = PV(GĐ1) + PV(TV)
Giá trị VCSH = EV_DCF − Nợ ròng
Giá mỗi CP   = Giá trị VCSH ÷ Số CP (triệu)  →  nghìn VND/CP

Tỷ trọng giá trị cuối = PV(TV) ÷ EV_DCF × 100     (> 80% ⇒ cảnh báo)
```

Ba kịch bản:

| Kịch bản | Tăng trưởng GĐ1 | Suất chiết khấu | g |
|---|---|---|---|
| Bi quan | `g1 − 5%` (sàn 0) | `WACC + 2%` | `g − 0.5%` |
| Cơ sở | `g1` | `WACC` | `g` |
| Lạc quan | `g1 + 5%` | `WACC − 1%` (sàn 5%) | `g + 0.5%` |

Nếu `FCF LTM ≤ 0` hoặc thiếu → DCF trả về `available = false` và **bị loại khỏi
giá mục tiêu** (không bịa).

### 4.5. DCF trên FCFE

Cùng công thức nhưng chiết khấu bằng **chi phí vốn chủ sở hữu Ke** và không trừ
nợ ròng (FCFE đã là dòng tiền thuộc về cổ đông):

```
Giá mỗi CP (FCFE) = Σ FCFE_t/(1+Ke)^t + [FCFE_n(1+g)/(Ke−g)]/(1+Ke)^n , tất cả ÷ Số CP
```

### 4.6. DDM Gordon (mô hình cổ tức)

```
P = DPS × (1 + g) ÷ (Ke − g)
```

Chỉ áp dụng khi `DPS > 0` và `Ke > g`; ngược lại trả về `null`.

### 4.7. Graham Number

```
Graham = √(22.5 × EPS × BVPS)
```

(ngưỡng an toàn cổ điển: P/E ≤ 15 và P/B ≤ 1.5 ⇒ 15 × 1.5 = 22.5)

### 4.8. Reverse DCF (tăng trưởng thị trường đang kỳ vọng)

Giải phương trình ẩn `g`:

```
DCF(g) = Giá thị trường
```

bằng phương pháp **chia đôi khoảng** (bisection, 60 vòng) trên `g ∈ [−20%, +60%]`.
Kết quả cho biết thị trường đang trả tiền cho mức tăng trưởng FCF nào.

### 4.9. Giá mục tiêu hỗn hợp (football field)

| Phương pháp | Công thức giá mỗi CP | Trọng số |
|---|---|---|
| DCF (FCFF, WACC) | xem 4.4 | 35% |
| Bội số P/E ngành | `EPS LTM × P/E ngành` | 20% |
| Bội số EV/EBITDA ngành | `(EV/EBITDA ngành × EBITDA LTM − Nợ ròng) ÷ Số CP` | 20% |
| Bội số P/B ngành | `BVPS × P/B ngành` | 10% |
| Bội số EV/Sales ngành | `(EV/Sales ngành × DT LTM − Nợ ròng) ÷ Số CP` | 5% |
| Graham Number | `√(22.5 × EPS × BVPS)` | 10% |
| DDM Gordon | `DPS(1+g)/(Ke−g)` | 10% |

Mỗi phương pháp có dải ±15% quanh giá trị trung tâm (riêng DCF dùng 3 kịch bản).

```
Trọng số chuẩn hoá_i = trọng số_i ÷ Σ(trọng số các phương pháp khả dụng)
Giá mục tiêu = Σ(giá trị_i × trọng số chuẩn hoá_i)
Upside %     = (Giá mục tiêu − Giá hiện tại) ÷ Giá hiện tại × 100
Biên an toàn = (Giá mục tiêu − Giá hiện tại) ÷ Giá mục tiêu × 100
```

| Upside | Xếp hạng |
|---|---|
| ≥ +30% | HẤP DẪN |
| +10% … +30% | TÍCH LŨY |
| −10% … +10% | HỢP LÝ |
| −30% … −10% | ĐẮT |
| < −30% | RẤT ĐẮT |
| thiếu dữ liệu | N/A |

### 4.10. Lưới độ nhạy

Ma trận **5 × 5**:

```
WACC ∈ {W − 2%, W − 1%, W, W + 1%, W + 2%}
g    ∈ {g − 1%, g − 0.5%, g, g + 0.5%, g + 1%}
Mỗi ô = giá mỗi CP tính lại bằng DCF FCFF với cặp (WACC, g) đó
```

---

## 5. Thang điểm chỉ số (ramp)

Mỗi chỉ số được chấm 0–100 bằng thang tuyến tính giữa ngưỡng "xấu" và "tốt":

```
ramp(x, bad, good) = clamp01( (x − bad) ÷ (good − bad) )
```

Với chỉ số **càng thấp càng tốt** (D/E, DSO, DIO, CCC, Nợ/EBITDA…) thì đảo dấu
cả `x`, `bad`, `good`. Thiếu dữ liệu ⇒ `score = null` và nhãn "Chưa có dữ liệu"
(**không bao giờ** gán điểm trung tính 50).

| Điểm | Nhãn |
|---|---|
| ≥ 80 | Rất tốt |
| 65–79 | Tốt |
| 45–64 | Trung bình |
| 25–44 | Yếu |
| < 25 | Rất yếu |

---

## 6. Hiệu năng

| Kỹ thuật | Tác dụng |
|---|---|
| `Promise.all` khi nạp BCTC + giá + hồ sơ doanh nghiệp | bỏ đọc tuần tự |
| `cached()` TTL 10 phút + in-flight dedupe | 4 endpoint dùng chung 1 kết quả |
| Gộp 3 request của tab Cơ bản thành 1 (`/fundamental-analytics`) | giảm 2 round-trip HTTP |
| Engine thuần (không I/O), duyệt danh sách quý 1 lượt | chi phí tính lại ≈ 0 |
| `meta.computedInMs` trong response | đo được thời gian tính thực tế |

---

## 7. Nguyên tắc dữ liệu

1. **Không bịa số liệu.** Thiếu dữ liệu ⇒ `null`, không thay bằng 0 hay giá trị trung tính.
2. **Không dùng synthetic** trên đường public — giữ đúng chính sách
   *Verified Financial Data* của repo.
3. Mỗi chỉ số trên UI **kèm công thức** (hover để xem) để người dùng tự kiểm chứng.
4. Mọi giả định vĩ mô (Rf, ERP, g, số năm) đều hiển thị công khai trong khối
   "Phương pháp luận & giả định".
5. Các cảnh báo (LTM nội suy, giá trị cuối > 80%, FCF âm, Piotroski thiếu tiêu chí…)
   được trả về trong `warnings` và hiển thị trên UI.
