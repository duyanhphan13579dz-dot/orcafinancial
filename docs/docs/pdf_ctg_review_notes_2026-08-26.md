# CTG PDF review notes

Source: `/home/ubuntu/upload/CTG_BAO_CAO_PHAN_TICH.pdf`
Reviewed pages: 1-8 via visual page render on 2026-08-26.

## Key visual findings

1. **Trang 1** hiển thị được bìa và khối kết luận điều hành, nhưng phần typography còn thô, mật độ nội dung thấp, chưa đạt chuẩn báo cáo phân tích chuyên nghiệp.
2. **Trang 2** bị **lỗi dàn trang nghiêm trọng**: tiêu đề mục `3. PHÂN TÍCH KỸ THUẬT` chồng lên cuối trang; bảng và chữ quá sát nhau; hierarchy yếu; phần đầu trang chứa quá nhiều nội dung nén trong một trang.
3. **Trang 3** tiếp tục lỗi bố cục: tiêu đề `5. RỦI RO, CATALYST VÀ KẾ HOẠCH THEO DÕI` bị đẩy sang mép phải, xuống giữa trang; flow văn bản gãy; nội dung giữa các section không kiểm soát page-break.
4. **Trang 4** có nội dung nhưng vẫn rất sơ sài, chủ yếu là disclosure; chưa có bảng biểu sâu, chưa có chart snapshot kỹ thuật, chưa có cấu trúc analyst-grade.
5. **Trang 5-8** gần như **trắng hoàn toàn**, chỉ còn header/footer nhỏ như `ORCA FINANCIAL · CTG · BÁO CÁO PHÂN TÍCH` hoặc số trang (`Trang 1/4`, `Trang 2/4`). Điều này cho thấy logic buffered pages / footer pagination hiện tại đang làm phát sinh các trang rỗng hoặc render duplicate page ranges.
6. Tổng thể file 12 trang nhưng phần nội dung thực tế chỉ khoảng 4 trang đầu; các trang sau không có giá trị sử dụng.
7. Font tiếng Việt hiện đã đọc được ở file này, nhưng cảm giác trình bày vẫn thiếu ổn định; cần chuyển sang layout engine kiểm soát typography/page-break tốt hơn.

## Content gaps versus user requirement

1. Thiếu phần **giới thiệu doanh nghiệp** đủ chiều sâu.
2. Thiếu phần **hào kinh tế (moat)** được viết thành luận điểm rõ ràng.
3. Thiếu phần **chuỗi giá trị doanh nghiệp** theo cấu trúc input → process → output.
4. Thiếu phần **so sánh kết quả kinh doanh nhiều kỳ** và nhận xét biến động.
5. Thiếu bộ **chỉ số sức khỏe tài chính** đầy đủ: doanh thu, lợi nhuận, biên lợi nhuận, dòng tiền, ROA, ROE, ROS, EBITDA, nợ/VCSH.
6. Thiếu phần **định giá hiện tại** theo P/E, P/B ở dạng giải thích rõ ràng.
7. Thiếu phần **dự phóng kết quả kinh doanh** đủ chi tiết cho doanh thu, lợi nhuận, định giá.
8. Thiếu **snapshot chart kỹ thuật** tại thời điểm xuất báo cáo.
9. Thiếu phần **vĩ mô trong nước/quốc tế** tác động đến cổ phiếu.
10. Thiếu phần **đánh giá theo chu kỳ ngành và chu kỳ kinh tế**.
11. Thiếu một **kết luận cuối cùng cô đọng một dòng** về trạng thái cổ phiếu.

## Initial remediation direction

- Ưu tiên thay report builder hiện tại bằng cấu trúc mới kiểm soát page-break tốt hơn.
- Tách riêng cover, executive summary, company overview, value chain, moat, financial review, valuation/forecast, technical snapshot, macro impact, cycle view, conclusion.
- Sinh chart snapshot như asset riêng rồi nhúng vào PDF.
- Nếu PDFKit tiếp tục khó kiểm soát page flow, cân nhắc chuyển report generation sang Typst hoặc HTML-to-PDF chuyên cho tài liệu dài.

## Additional page-end findings

8. **Trang 9-12** xác nhận tình trạng các **trang trắng lặp lại**; chỉ còn header/footer hoặc số trang `Trang 3/4`, `Trang 4/4`. Đây gần như chắc chắn là lỗi logic pagination/footer với `bufferedPageRange()` hoặc quy trình addPage không đồng bộ với nội dung thực.
9. Footer đang đếm `Trang 1/4 ... Trang 4/4` trong khi file vật lý có **12 trang**, cho thấy cơ chế đánh số trang chỉ nhận một dải page-range nội dung, nhưng tài liệu cuối cùng lại còn các trang trắng ngoài dải đó.
10. Mức độ hỏng layout là **structural**, không chỉ do nội dung ngắn. Cần thay đổi engine hoặc ít nhất thay toàn bộ flow page composition hiện tại.

## Findings from regenerated `CTG-new-report.pdf`

Reviewed file: `/home/ubuntu/work/CTG-new-report.pdf`
Pages rendered: 1-5 of total 6 pages.

1. Tiến bộ: file mới **không còn 12 trang rỗng**, giảm còn 6 trang; chart snapshot kỹ thuật đã xuất hiện; footer đếm trang thống nhất hơn.
2. Tuy vậy, bố cục vẫn **chưa đạt chuẩn**:
   - Nhiều section title ở trang 2-5 bị đẩy sang cột phải hoặc chèn giữa bảng/đoạn văn.
   - Các bảng dài vẫn khiến nội dung sau đó chồng lấn hoặc bị ép vào phần cuối trang.
   - Không có cơ chế page-break theo block; table helper hiện vẫn không đủ thông minh cho long-form report.
3. Font tiếng Việt đã đọc được, nhưng typography còn thô, line spacing và hierarchy yếu; chưa có phong cách analyst-grade.
4. Nội dung đã nhiều hơn nhưng vẫn còn thiếu một số thành phần theo yêu cầu người dùng:
   - Giới thiệu doanh nghiệp còn ngắn.
   - Hào kinh tế chưa được viết thành narrative riêng mạch lạc.
   - Chuỗi giá trị mới ở mức template ngành, chưa gắn rõ hơn với công ty.
   - Chưa có phần so sánh năm trước/quý trước dưới dạng commentary sâu.
   - Chưa có macro trong nước/quốc tế được diễn giải thành luận điểm rõ.
   - Kết luận cuối cùng chưa chốt bằng một dòng recommendation-style ngắn gọn.
5. Kết luận kỹ thuật: **PDFKit layout hiện tại không phù hợp cho báo cáo dài nhiều bảng + chart + narrative** nếu không viết lại hẳn page-composer. Hướng hợp lý hơn là chuyển report generation sang một engine kiểm soát typography và page flow tốt hơn, ưu tiên Typst.

## Findings from `VNM-report-final-redesign.pdf`

Reviewed pages: 4-7 visually and full text extraction.

Bản sửa PDFKit đã cải thiện một phần nhưng vẫn chưa đạt yêu cầu sản xuất. Vẫn còn một trang gần như trắng hoàn toàn, chỉ có dòng `Drawdown tối đa`, cho thấy có block bị chia trang sai sau section kỹ thuật. Section `8. Cross-module, Hào kinh tế và Investment Thesis` vẫn bị tràn xuống chân trang rồi nối tiếp ở trang sau theo cách thiếu kiểm soát. Footer không còn nhân bản 12 trang như bản cũ, nhưng cấu trúc page-flow vẫn không ổn định cho báo cáo dài.

Kết luận kỹ thuật hiện tại là: có thể tiếp tục vá PDFKit, nhưng chi phí sửa sẽ tăng nhanh và khó bảo đảm ổn định khi nội dung từng mã cổ phiếu dài/ngắn khác nhau. Hướng phù hợp hơn là chuyển report stock sang một engine dàn trang có page-break và typography tốt hơn, ưu tiên Typst hoặc HTML-to-PDF với template báo cáo cố định.

## Latest visual findings after additional pagination tuning

Bản `VNM-report-final-redesign-3.pdf` vẫn còn hai lỗi cấu trúc. Thứ nhất, có một trang gần trắng chỉ còn dòng `Drawdown tối đa`, chứng tỏ section kỹ thuật vẫn bị tách block sai. Thứ hai, phần `Cross-module, Hào kinh tế và Investment Thesis` vẫn chạm sát footer ở cuối trang. Do đó, hướng tiếp tục vá `PDFKit` không còn hiệu quả về chi phí và độ ổn định. Cần chuyển báo cáo stock sang một hệ dựng PDF có page-break cấp tài liệu, typography tốt hơn và hỗ trợ bảng/đoạn dài ổn định hơn.

## Fresh visual verification

`VNM-report-final-redesign-fresh.pdf` was generated after restarting the dev server, so it used the latest code rather than the old in-memory cached payload. The rendered pages 1-5 show the new typography, readable Vietnamese font, financial tables, valuation table, and technical price chart. Page 1 is a clean cover; page 2 contains company overview, value chain and financial quarter comparison; page 3 contains financial health and technical chart; page 4 contains technical continuation, valuation and forecast; page 5 contains risk and cross-module/thesis content. Text extraction reports every page has meaningful content (no near-empty page): page character counts were 474, 2892, 1947, 1872, 2657, 1103, and 2256 for pages 1-7. The first report drafts were stale because the endpoint cache key ignored query parameters; restarting the server was required for a fresh smoke test.
