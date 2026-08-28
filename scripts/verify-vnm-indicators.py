import json, math
from pathlib import Path

p = Path('artifacts/vnm-real-market-audit.json')
data = json.loads(p.read_text())
closes = [float(x['close']) for x in data['bars']]
volumes = [float(x['volume']) for x in data['bars']]
expected = data['indicators']

def sma(values, period):
    return sum(values[-period:]) / period

def ema_series(values, period):
    k = 2 / (period + 1)
    out = [values[0]]
    for value in values[1:]:
        out.append(value * k + out[-1] * (1 - k))
    return out

def rsi(values, period=14):
    gains = losses = 0.0
    for i in range(len(values) - period, len(values)):
        diff = values[i] - values[i-1]
        if diff >= 0: gains += diff
        else: losses -= diff
    return 100 if losses == 0 else 100 - 100 / (1 + gains / losses)

def close(a, b, tolerance=1e-9):
    return abs(a - b) <= tolerance * max(1, abs(a), abs(b))

independent = {}
independent['rsi14'] = rsi(closes)
independent['sma20'] = sma(closes, 20)
independent['sma50'] = sma(closes, 50)
mid = independent['sma20']
sd = math.sqrt(sum((x - mid) ** 2 for x in closes[-20:]) / 20)
independent['bollinger'] = {'upper': mid + 2 * sd, 'middle': mid, 'lower': mid - 2 * sd}
macd_line = [a - b for a, b in zip(ema_series(closes, 12), ema_series(closes, 26))]
signal = ema_series(macd_line[-60:], 9)[-1]
independent['macd'] = {'macd': macd_line[-1], 'signal': signal, 'histogram': macd_line[-1] - signal}
independent['volumeVsAvg20'] = volumes[-1] / sma(volumes, 20)
checks = {}
for key in ['rsi14', 'sma20', 'sma50', 'volumeVsAvg20']:
    checks[key] = {'expected': expected[key], 'independent': independent[key], 'match': close(expected[key], independent[key])}
for key in ['upper', 'middle', 'lower']:
    checks[f'bollinger.{key}'] = {'expected': expected['bollinger'][key], 'independent': independent['bollinger'][key], 'match': close(expected['bollinger'][key], independent['bollinger'][key])}
for key in ['macd', 'signal', 'histogram']:
    checks[f'macd.{key}'] = {'expected': expected['macd'][key], 'independent': independent['macd'][key], 'match': close(expected['macd'][key], independent['macd'][key])}
result = {'symbol': data['symbol'], 'source': data['source'], 'retrievedAt': data['retrievedAt'], 'barsAnalyzed': data['barsAnalyzed'], 'allMatch': all(x['match'] for x in checks.values()), 'checks': checks}
Path('artifacts/vnm-indicator-verification.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
