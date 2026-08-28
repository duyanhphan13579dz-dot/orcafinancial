# Financial LLM Training Playbook

## Kết luận triển khai

Repository hiện đang dùng **LLM inference qua Groq**, không có pipeline fine-tuning hoặc trọng số model riêng trong mã nguồn. Vì vậy, bước nâng chất lượng an toàn nhất ở thời điểm này là huấn luyện theo nghĩa vận hành: chuẩn hóa dữ liệu đầu vào, khóa prompt theo hợp đồng, tạo quality gate có thể đo lường, lưu output kèm model/provenance và xây regression set từ các case đã được con người duyệt. Việc fine-tune trọng số chỉ nên thực hiện sau khi có dataset vàng đủ lớn, có nhãn nhất quán và một backend hỗ trợ fine-tuning riêng; không nên gọi prompt hiện tại là “đã fine-tune”.

Pipeline sau thay đổi là:

`raw document → normalized facts → accepted + verified → LLM JSON → grounding quality gate → persist valid output → offline regression evaluation`.

Quality gate nằm tại `src/lib/financial-llm-quality.ts` và được gọi trong `src/lib/financial-llm.ts`. Nếu output có số không khớp facts, kỳ không tồn tại, giá trị không phải số, hoặc cân đối kế toán không khớp, output bị từ chối và không được lưu với trạng thái `valid`.

## Những thay đổi đã thực hiện

| Hạng mục | Trạng thái | Ý nghĩa |
| --- | --- | --- |
| Prompt finance có tính tái lập | Đã triển khai | Model chỉ được sao chép số, kỳ, đơn vị và phạm vi từ normalized facts; không nội suy hoặc dùng kiến thức ngoài |
| Chọn finance lane | Đã triển khai | LLM call dùng `purpose: "finance"`, JSON mode, temperature thấp và reasoning thấp |
| Kiểm tra grounding | Đã triển khai | Chart và ba bảng tài chính được đối chiếu từng giá trị với facts |
| Kiểm tra cân đối | Đã triển khai | Kiểm tra `totalAssets = totalLiabilities + equity` khi đủ trường |
| Version hóa quality gate | Đã triển khai | Quality version nằm trong input fingerprint, khiến cache cũ tự động không còn được tin cậy |
| Regression CLI | Đã triển khai | `npm run llm:evaluate -- path/to/cases.jsonl` cho validity rate, điểm trung bình và nhóm lỗi |
| Fine-tuning trọng số | Chưa triển khai | Cần dataset vàng, quyền fine-tune và quy trình đánh giá độc lập trước khi thực hiện |

## Cách xây dataset vàng

Mỗi dòng JSONL nên đại diện cho một lần inference với `type`, `facts` và `output`. `facts` phải là bản snapshot đã được chấp nhận và xác minh, không dùng dữ liệu synthetic chưa gắn nhãn. `output` là kết quả đã được analyst kiểm duyệt. Dataset nên được chia theo symbol, nguồn dữ liệu, kỳ báo cáo, loại báo cáo (`basic`/`financials`) và các tình huống thiếu trường để tránh việc model chỉ học một mẫu cố định.

Một case tốt cần giữ nguyên các trường provenance ngoài phần output, chẳng hạn `sourceDocumentIds`, `source`, `reportScope`, `currency`, `unit`, `periodEnd` và phiên bản parser. Những trường này giúp phân tích lỗi do model với lỗi do ingestion. Tuyệt đối không trộn consolidated và parent trong cùng một case nếu báo cáo không yêu cầu điều đó.

## Tiêu chí chấm bắt buộc

| Nhóm tiêu chí | Cách đo | Ngưỡng phát hành đề xuất |
| --- | --- | --- |
| JSON contract | Parse được và đủ key | 100% |
| Numerical grounding | Mọi số trong chart/bảng khớp normalized facts | 100% |
| Period integrity | Không có kỳ ngoài input, không dùng kỳ tương lai | 100% |
| Statement integrity | Cân đối kế toán khớp khi đủ dữ liệu | 100% trên các case có đủ trường |
| Missing-data honesty | Không điền số đoán khi source thiếu | 100% case thiếu dữ liệu |
| Reproducibility | Cùng input và prompt version cho kết quả cùng cấu trúc | Theo dõi trước/sau mỗi thay đổi |
| Human usefulness | Analyst chấm độ rõ ràng, đúng ngữ cảnh và không lặp | Đánh giá mù trên sample holdout |

Các lỗi grounding, period và statement integrity là lỗi chặn phát hành. Điểm trung bình không được dùng để bù cho một lỗi số liệu nghiêm trọng.

## Quy trình cải thiện theo vòng lặp

Đầu tiên, chạy model hiện tại trên một tập holdout chưa dùng để viết prompt. Tiếp theo, chạy `npm run llm:evaluate -- cases.jsonl` và phân loại lỗi theo `ungrounded_number`, `unknown_period`, `balance_mismatch`, `invalid_statement_value` và lỗi schema. Sau đó, sửa một yếu tố mỗi lần: prompt, schema, model hoặc nguồn dữ liệu. Mỗi thay đổi phải chạy lại cùng holdout và một tập regression cố định; chỉ chấp nhận thay đổi khi không làm giảm numerical grounding hoặc period integrity.

Những lỗi lặp lại ở cách diễn đạt nên giải quyết bằng prompt, output schema hoặc hậu xử lý có kiểm soát trước khi cân nhắc fine-tuning. Fine-tuning chỉ phù hợp cho lỗi phong cách, bố cục và quy tắc diễn đạt ổn định; nó không thể thay thế quality gate hoặc sửa dữ liệu nguồn sai. Số liệu tài chính vẫn phải được kiểm chứng bằng code và provenance.

## Vận hành production

Output hợp lệ được cache theo fingerprint có bao gồm `FINANCIAL_LLM_QUALITY_VERSION`. Khi quality gate thay đổi, fingerprint thay đổi và output cũ được tạo lại. Nếu quality gate từ chối output, endpoint nội bộ phải trả lỗi cho symbol/type tương ứng để job log và vận hành thấy failure, thay vì âm thầm lưu nội dung không đáng tin.

Bản báo cáo nên hiển thị model, thời điểm tạo, nguồn, kỳ, đơn vị và tình trạng dữ liệu. Các giá trị estimate hoặc degraded phải được gắn nhãn rõ ràng và không được gọi là actual. Quality score là tín hiệu vận hành, không phải bằng chứng rằng số liệu đã được kiểm toán.

## Lệnh kiểm tra

```bash
npm test
npm run typecheck
npm run llm:evaluate -- path/to/cases.jsonl
```

File đánh giá offline không gọi provider LLM. Nó dùng đúng quality gate production để bảo đảm tiêu chí trong regression test và runtime không bị lệch nhau.
