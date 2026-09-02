"use client";

/**
 * Bảng "Báo cáo tài chính nguồn" trên tab Cơ bản.
 *
 * Hiển thị đúng các dòng trên BCTC đã công bố (đã đưa về số riêng quý) để
 * người đọc đối chiếu được mọi chỉ số ở 3 khối phân tích phía dưới:
 * hiệu suất kinh doanh · sức khỏe tài chính · định giá.
 *
 * Quy ước hiển thị:
 *  • Thiếu dữ liệu → "—" (không bao giờ thay bằng 0).
 *  • Số riêng quý được TÁCH từ luỹ kế → đánh dấu "≈" và ghi chú ở đầu bảng.
 *  • Cột LTM tô nền riêng vì đó là cửa sổ engine thực sự dùng để tính.
 */

import { useState } from "react";
import { fmt } from "@/components/business-performance";
import type {
  StatementBalanceBlock,
  StatementLtmBlock,
  StatementSource,
  StatementSourceRow,
} from "@/lib/fundamental-source";

export interface StatementSourceVM extends StatementSource {}

const CYAN = "#00d4ff";
const AMBER = "#fbbf24";
const VIOLET = "#a78bfa";

/* ──────────────────────────────────────────────────────────── */

type LineItem = {
  key: string;
  label: string;
  /** Lấy giá trị từ một kỳ báo cáo. */
  pick: (row: StatementSourceRow) => number | null;
  digits?: number;
  /** true ⇒ dòng là "dòng tiền ra" theo bản chất (capex) — hiển thị độ lớn. */
  note?: string;
};

const INCOME_LINES: LineItem[] = [
  { key: "revenue", label: "Doanh thu thuần", pick: (r) => r.revenue },
  { key: "cogs", label: "Giá vốn hàng bán", pick: (r) => r.costOfGoodsSold },
  { key: "gross", label: "Lợi nhuận gộp", pick: (r) => r.grossProfit },
  { key: "ebitda", label: "EBITDA", pick: (r) => r.ebitda },
  { key: "ebit", label: "LN hoạt động (EBIT)", pick: (r) => r.operatingIncome },
  { key: "ni", label: "LN sau thuế", pick: (r) => r.netIncome },
  { key: "eps", label: "EPS", pick: (r) => r.eps, digits: 3, note: "nghìn VND/cổ phiếu" },
];

const CASHFLOW_LINES: LineItem[] = [
  { key: "ocf", label: "Dòng tiền kinh doanh", pick: (r) => r.operatingCashFlow },
  { key: "capex", label: "Chi đầu tư (capex)", pick: (r) => r.capex, note: "hiển thị độ lớn" },
  { key: "fcf", label: "Dòng tiền tự do (FCF)", pick: (r) => r.freeCashFlow, note: "OCF − capex" },
];

const BALANCE_LINES: LineItem[] = [
  { key: "ta", label: "Tổng tài sản", pick: (r) => r.totalAssets },
  { key: "eq", label: "Vốn chủ sở hữu", pick: (r) => r.equity },
  { key: "cash", label: "Tiền & tương đương tiền", pick: (r) => r.cashAndEquivalents },
  { key: "ibd", label: "Nợ vay chịu lãi", pick: (r) => r.interestBearingDebt },
  { key: "inv", label: "Hàng tồn kho", pick: (r) => r.inventory },
  { key: "rec", label: "Phải thu khách hàng", pick: (r) => r.receivables },
];

function Section({ title, accent, hint }: { title: string; accent: string; hint?: string }) {
  return (
    <tr>
      <th
        colSpan={99}
        className="sticky left-0 bg-[#0A2540] px-2 pt-3 pb-1 text-left font-mono text-[10px] tracking-[0.2em] uppercase"
        style={{ color: accent }}
      >
        {title}
        {hint ? <span className="ml-2 normal-case tracking-normal text-slate-500">{hint}</span> : null}
      </th>
    </tr>
  );
}

function LineRow({
  line,
  rows,
  ltm,
  ltmValue,
}: {
  line: LineItem;
  rows: StatementSourceRow[];
  ltm: StatementLtmBlock | null;
  ltmValue: number | null;
}) {
  const digits = line.digits ?? 1;
  return (
    <tr className="border-t border-[#12294a]/70 hover:bg-[#0e2f52]/40">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-[#0A2540] px-2 py-1.5 text-left text-[11px] font-normal text-slate-400 whitespace-nowrap"
        title={line.note ? `${line.label} — ${line.note}` : line.label}
      >
        {line.label}
        {line.note ? <span className="ml-1 text-[9px] text-slate-600">*</span> : null}
      </th>
      <td className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-cyan-200 bg-cyan-500/[0.06]">
        {ltm ? fmt(ltmValue, digits) : "—"}
      </td>
      {rows.map((row) => (
        <td
          key={row.period}
          className="px-2 py-1.5 text-right font-mono text-[11px] tabular-nums text-slate-200 whitespace-nowrap"
          title={`${row.displayPeriodVi}${row.derivedFromCumulative ? " · số riêng quý tách từ luỹ kế" : ""}`}
        >
          {fmt(line.pick(row), digits)}
          {row.derivedFromCumulative && line.pick(row) !== null ? (
            <span className="ml-0.5 text-[9px] text-amber-500">≈</span>
          ) : null}
        </td>
      ))}
    </tr>
  );
}

/* ──────────────────────────────────────────────────────────── */

function LtmSummary({ ltm, unit }: { ltm: StatementLtmBlock; unit: string }) {
  const cells: Array<[string, number | null, number?]> = [
    ["Doanh thu", ltm.revenue],
    ["LN gộp", ltm.grossProfit],
    ["EBITDA", ltm.ebitda],
    ["LN sau thuế", ltm.netIncome],
    ["Dòng tiền kinh doanh", ltm.operatingCashFlow],
    ["Capex", ltm.capex],
    ["FCF", ltm.freeCashFlow],
    ["EPS (nghìn VND)", ltm.eps, 3],
  ];
  return (
    <div className="panel p-4 reveal">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: CYAN }}>
          Cửa sổ LTM — nền của mọi chỉ số
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          {ltm.periodEndVi} · {ltm.methodLabel} · {ltm.quartersUsed}/4 quý
          {ltm.annualized ? " · nội suy" : ""}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
        {cells.map(([label, value, digits]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-[#12294a]/60 pb-1">
            <span className="text-[11px] text-slate-500 truncate">{label}</span>
            <span className="font-mono text-[12px] tabular-nums text-slate-100">
              {fmt(value, digits ?? 1)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 font-mono text-[10px] text-slate-600">
        Đơn vị {unit} (EPS: nghìn VND). LTM kỳ trước: doanh thu {fmt(ltm.previousRevenue)} · LN sau thuế{" "}
        {fmt(ltm.previousNetIncome)}.
      </div>
    </div>
  );
}

function BalanceSummary({ balances, unit }: { balances: StatementBalanceBlock; unit: string }) {
  const cells: Array<[string, number | null]> = [
    ["VCSH bình quân", balances.equity],
    ["Tổng tài sản bình quân", balances.totalAssets],
    ["Tồn kho bình quân", balances.inventory],
    ["Phải thu bình quân", balances.receivables],
    ["Phải trả bình quân", balances.payables],
    ["TSCĐ bình quân", balances.fixedAssets],
    ["Nợ vay chịu lãi", balances.interestBearingDebt],
    ["Vốn đầu tư (IC)", balances.investedCapital],
  ];
  return (
    <div className="panel p-4 reveal">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: VIOLET }}>
          Số dư bình quân dùng làm mẫu số
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          {balances.closingOnly ? "chỉ có số cuối kỳ" : "bình quân đầu kỳ / cuối kỳ LTM"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 md:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2 border-b border-[#12294a]/60 pb-1">
            <span className="text-[11px] text-slate-500 truncate">{label}</span>
            <span className="font-mono text-[12px] tabular-nums text-slate-100">{fmt(value)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        ROE = LN ròng LTM ÷ VCSH bình quân · ROA = LN ròng LTM ÷ Tổng tài sản bình quân · ROIC = NOPAT ÷ Vốn đầu tư
        bình quân. Đơn vị {unit}.
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */

const LTM_PICKERS: Record<string, (ltm: StatementLtmBlock) => number | null> = {
  revenue: (l) => l.revenue,
  gross: (l) => l.grossProfit,
  ebitda: (l) => l.ebitda,
  ebit: (l) => l.operatingIncome,
  ni: (l) => l.netIncome,
  eps: (l) => l.eps,
  ocf: (l) => l.operatingCashFlow,
  capex: (l) => l.capex,
  fcf: (l) => l.freeCashFlow,
};

function EmptyState({ symbol }: { symbol: string | null }) {
  return (
    <div className="panel p-4 reveal">
      <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-2" style={{ color: CYAN }}>
        Báo cáo tài chính nguồn
      </div>
      <p className="text-sm text-slate-400">
        Chưa có báo cáo tài chính đã xác minh
        {symbol ? ` cho ${symbol}` : ""}. Hệ thống không hiển thị số ước lượng.
      </p>
    </div>
  );
}

export function StatementSourceCard({ statement }: { statement: StatementSourceVM | null }) {
  const [maxColumns, setMaxColumns] = useState(8);

  if (!statement || statement.rows.length === 0) {
    return <EmptyState symbol={statement?.symbol ?? null} />;
  }

  const rows = statement.rows.slice(0, maxColumns);
  const hidden = statement.rows.length - rows.length;

  return (
    <div className="space-y-4">
      <div className="panel p-4 bg-gradient-to-br from-[#0a1d33] to-[#0A2540] reveal">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-3xl">
            <div className="font-mono text-[10px] tracking-[0.25em] uppercase mb-2" style={{ color: CYAN }}>
              Báo cáo tài chính nguồn · {statement.symbol}
            </div>
            <p className="text-slate-200 text-sm leading-relaxed font-display">
              {statement.periodCount} kỳ báo cáo, mới nhất {statement.latestPeriod}. Toàn bộ chỉ số hiệu suất, sức
              khỏe tài chính và định giá bên dưới được tính trực tiếp từ các con số này.
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-mono text-slate-400">
              <span className="rounded bg-slate-800/70 px-2 py-0.5">Đơn vị: {statement.unit}</span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">Dạng BCTC: {statement.basisLabel}</span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">Nguồn: {statement.source}</span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">
                {statement.providerBacked ? "đã xác minh qua nhà cung cấp" : "chưa có nhà cung cấp xác minh"}
              </span>
              <span className="rounded bg-slate-800/70 px-2 py-0.5">
                Nạp lúc {new Date(statement.loadedAt).toLocaleString("vi-VN")}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] tracking-[0.3em] text-slate-500">KỲ MỚI NHẤT</div>
            <div className="font-display text-3xl font-extrabold text-white">{statement.latestPeriod}</div>
          </div>
        </div>
      </div>

      {statement.warnings.length > 0 ? (
        <div className="panel p-3 border-l-2" style={{ borderColor: AMBER }}>
          <div className="font-mono text-[10px] tracking-[0.2em] uppercase mb-1.5" style={{ color: AMBER }}>
            Lưu ý về dữ liệu
          </div>
          <ul className="space-y-1">
            {statement.warnings.map((warning) => (
              <li key={warning} className="text-[11px] text-slate-400 leading-relaxed">
                • {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="panel p-4 reveal overflow-hidden">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: CYAN }}>
            Số liệu từng kỳ · {statement.unit}
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            ≈ = số riêng quý được tách từ BCTC luỹ kế · cuộn ngang để xem các kỳ trước
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-[#0A2540] px-2 py-2 text-left font-mono text-[10px] tracking-[0.2em] uppercase text-slate-500">
                  Chỉ tiêu
                </th>
                <th
                  className="px-2 py-2 text-right font-mono text-[10px] tracking-[0.2em] uppercase bg-cyan-500/[0.08]"
                  style={{ color: CYAN }}
                  title="Tổng 12 tháng gần nhất — cửa sổ engine dùng để tính"
                >
                  LTM
                </th>
                {rows.map((row) => (
                  <th
                    key={row.period}
                    className="px-2 py-2 text-right font-mono text-[10px] uppercase text-slate-400 whitespace-nowrap"
                    title={row.displayPeriodVi}
                  >
                    {row.shortTag}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Section title="Kết quả kinh doanh" accent={CYAN} hint="số riêng quý" />
              {INCOME_LINES.map((line) => (
                <LineRow
                  key={line.key}
                  line={line}
                  rows={rows}
                  ltm={statement.ltm}
                  ltmValue={statement.ltm ? (LTM_PICKERS[line.key]?.(statement.ltm) ?? null) : null}
                />
              ))}

              <Section title="Lưu chuyển tiền tệ" accent={CYAN} hint="số riêng quý" />
              {CASHFLOW_LINES.map((line) => (
                <LineRow
                  key={line.key}
                  line={line}
                  rows={rows}
                  ltm={statement.ltm}
                  ltmValue={statement.ltm ? (LTM_PICKERS[line.key]?.(statement.ltm) ?? null) : null}
                />
              ))}

              <Section title="Bảng cân đối kế toán" accent={VIOLET} hint="số dư cuối kỳ" />
              {BALANCE_LINES.map((line) => (
                <LineRow key={line.key} line={line} rows={rows} ltm={null} ltmValue={null} />
              ))}
            </tbody>
          </table>
        </div>

        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => setMaxColumns(statement.rows.length)}
            className="mt-3 rounded border border-[#1a3558] px-3 py-1 font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 hover:text-cyan-300 hover:border-cyan-500/50 transition"
          >
            Hiện thêm {hidden} kỳ trước
          </button>
        ) : null}
      </div>

      {statement.ltm ? <LtmSummary ltm={statement.ltm} unit={statement.unit} /> : null}
      <BalanceSummary balances={statement.balances} unit={statement.unit} />
    </div>
  );
}
