export type ForexCategory = "usd_cross" | "vnd_pair" | "gold" | "oil" | "index";
export interface ForexPairDef {
  symbol: string; name: string; category: ForexCategory; baseCurrency: string; quoteCurrency: string;
  yahooSymbol?: string;
  derived?: { op: "multiply" | "divide"; left: string; right: string };
}

export const FOREX_PAIRS: ForexPairDef[] = [
  { symbol:"EURUSD",name:"EUR/USD",category:"usd_cross",baseCurrency:"EUR",quoteCurrency:"USD",yahooSymbol:"EURUSD=X" },
  { symbol:"GBPUSD",name:"GBP/USD",category:"usd_cross",baseCurrency:"GBP",quoteCurrency:"USD",yahooSymbol:"GBPUSD=X" },
  {symbol:"USDJPY",name:"USD/JPY",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"JPY",yahooSymbol:"JPY=X" },
  {symbol:"AUDUSD",name:"AUD/USD",category:"usd_cross",baseCurrency:"AUD",quoteCurrency:"USD",yahooSymbol:"AUDUSD=X" },
  {symbol:"USDCAD",name:"USD/CAD",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"CAD",yahooSymbol:"CAD=X" },
  {symbol:"USDCHF",name:"USD/CHF",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"CHF",yahooSymbol:"CHF=X" },
  {symbol:"USDSGD",name:"USD/SGD",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"SGD",yahooSymbol:"SGD=X" },
  {symbol:"USDHKD",name:"USD/HKD",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"HKD",yahooSymbol:"HKD=X" },
  {symbol:"USDCNY",name:"USD/CNY",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"CNY",yahooSymbol:"CNY=X" },
  {symbol:"USDTHB",name:"USD/THB",category:"usd_cross",baseCurrency:"USD",quoteCurrency:"THB",yahooSymbol:"THB=X" },
  {symbol:"USDVND",name:"USD/VND",category:"vnd_pair",baseCurrency:"USD",quoteCurrency:"VND",yahooSymbol:"VND=X" },
  {symbol:"EURVND",name:"EUR/VND",category:"vnd_pair",baseCurrency:"EUR",quoteCurrency:"VND",derived:{op:"multiply",left:"EURUSD",right:"USDVND"} },
  {symbol:"GBPVND",name:"GBP/VND",category:"vnd_pair",baseCurrency:"GBP",quoteCurrency:"VND",derived:{op:"multiply",left:"GBPUSD",right:"USDVND"} },
  {symbol:"JPYVND",name:"JPY/VND",category:"vnd_pair",baseCurrency:"JPY",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDJPY"} },
  {symbol:"AUDVND",name:"AUD/VND",category:"vnd_pair",baseCurrency:"AUD",quoteCurrency:"VND",derived:{op:"multiply",left:"AUDUSD",right:"USDVND"} },
  {symbol:"CADVND",name:"CAD/VND",category:"vnd_pair",baseCurrency:"CAD",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDCAD"} },
  {symbol:"CHFVND",name:"CHF/VND",category:"vnd_pair",baseCurrency:"CHF",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDCHF"} },
  {symbol:"SGDVND",name:"SGD/VND",category:"vnd_pair",baseCurrency:"SGD",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDSGD"} },
  {symbol:"HKDVND",name:"HKD/VND",category:"vnd_pair",baseCurrency:"HKD",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDHKD"} },
  {symbol:"CNYVND",name:"CNY/VND",category:"vnd_pair",baseCurrency:"CNY",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDCNY"} },
  {symbol:"THBVND",name:"THB/VND",category:"vnd_pair",baseCurrency:"THB",quoteCurrency:"VND",derived:{op:"divide",left:"USDVND",right:"USDTHB"} },
  {symbol:"XAUUSD",name:"XAU/USD",category:"gold",baseCurrency:"XAU",quoteCurrency:"USD",yahooSymbol:"GC=F" },
  {symbol:"XAUVND",name:"XAU/VND",category:"gold",baseCurrency:"XAU",quoteCurrency:"VND",derived:{op:"multiply",left:"XAUUSD",right:"USDVND"} },
  {symbol:"BRENTUSD",name:"Brent/USD",category:"oil",baseCurrency:"BRENT",quoteCurrency:"USD",yahooSymbol:"BZ=F" },
  {symbol:"WTIUSD",name:"WTI/USD",category:"oil",baseCurrency:"WTI",quoteCurrency:"USD",yahooSymbol:"CL=F" },
  {symbol:"DXY",name:"US Dollar Index",category:"index",baseCurrency:"DXY",quoteCurrency:"INDEX",yahooSymbol:"DX-Y.NYB" },
];
export const FOREX_BY_SYMBOL = new Map(FOREX_PAIRS.map((p) => [p.symbol, p]));
