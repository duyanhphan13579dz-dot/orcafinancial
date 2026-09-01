# Audit nguồn dữ liệu công khai (VnDirect/Vietstock/Binance/Biquote)

## Kết luận sơ bộ

Nguồn công khai có thể dùng để lấy **dữ liệu giao dịch khối ngoại theo ngày/phiên**, nhưng chưa xác nhận được nguồn miễn phí nào cung cấp **sổ lệnh HOSE/HNX/UPCoM real-time** một cách ổn định và hợp lệ.

## Nguồn đã kiểm tra

| Nguồn | Dữ liệu quan sát được | Đánh giá |
|---|---|---|
| iTick Stock Depth | Tài liệu mô tả 5 hoặc 10 mức bid/ask, giá, khối lượng và số lệnh; ví dụ tài liệu đang minh họa region Hong Kong. | Có khả năng là nguồn thay thế trả phí/API key; tài liệu chưa chứng minh mã Việt Nam được hỗ trợ. Không nên coi là nguồn công khai miễn phí cho cổ phiếu Việt Nam khi chưa kiểm tra gói và coverage. |
| FiinGroup API Datafeed – HOSE Stock V2 | Có `ForeignBuyValueMatched`, `ForeignSellValueMatched`, `ForeignBuyValueDeal`, `ForeignSellValueDeal`, tổng mua/bán và các trường giá/khối lượng. | Phù hợp cho khối ngoại và dữ liệu giao dịch HOSE; là API Datafeed cần quyền truy cập, không phải endpoint công khai không xác thực. |
| SSI FastConnect / ssi-sdk | Có tài liệu về REST/WebSocket cho dữ liệu giao dịch và bid/ask HOSE/HNX/UPCoM. | Có thể là phương án thương mại/đối tác, cần tài khoản và quyền dữ liệu; không nên tự động gọi nếu chưa có credential/quyền hợp lệ. |
| HNX/HOSE web | Có thông tin chỉ số và giao dịch công khai ở mức trang web. | Phù hợp tham khảo/EOD; chưa xác nhận Level-2 order book public ổn định. |

## Quy tắc tích hợp

Không lấy HTML bảng điện của bên thứ ba để giả lập dữ liệu live. Adapter chỉ đánh dấu `live` khi nguồn trả timestamp và dữ liệu bid/ask hoặc foreign flow hợp lệ; nếu thiếu quyền hoặc chỉ có EOD thì hiển thị `delayed`/`unavailable` và nêu rõ nguồn.

## Nguồn tham khảo

1. https://docs.itick.org/en/rest-api/stocks/stock-depth
2. https://datafeed.fiingroup.vn/api-giao-dich/co-phieu/co-phieu/hose-stock-v2
3. https://guide.ssi.com.vn/ssi-products/fastconnect-data/api-specs
4. https://www.hnx.vn/
