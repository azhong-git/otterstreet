import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from "lightweight-charts";
import { api, type BarInterval, type StoredSignal } from "./api";

const INTERVALS: BarInterval[] = ["1m", "5m", "15m", "1h", "1d"];

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** GEX levels pulled from the most recent gex signal for this ticker. */
function gexLevels(signals: StoredSignal[]): { callWall?: number; putWall?: number; gammaFlip?: number } {
  const sig = signals.find((s) => s.skillId === "gex" && s.data);
  const d = sig?.data as Record<string, unknown> | undefined;
  return {
    callWall: typeof d?.callWall === "number" ? d.callWall : undefined,
    putWall: typeof d?.putWall === "number" ? d.putWall : undefined,
    gammaFlip: typeof d?.gammaFlip === "number" ? d.gammaFlip : undefined,
  };
}

export function TickerChart({ symbol, signals }: { symbol: string; signals: StoredSignal[] }) {
  const [interval, setIntervalState] = useState<BarInterval>("1d");
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

  // Create the chart once.
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height: 320,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: css("--muted"),
      },
      grid: {
        vertLines: { color: css("--border") },
        horzLines: { color: css("--border") },
      },
      timeScale: { timeVisible: true, borderColor: css("--border") },
      rightPriceScale: { borderColor: css("--border") },
      crosshair: { mode: 0 },
    });
    const series = chart.addCandlestickSeries({
      upColor: css("--bullish"),
      downColor: css("--bearish"),
      wickUpColor: css("--bullish"),
      wickDownColor: css("--bearish"),
      borderVisible: false,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => chart.applyOptions({ width: containerRef.current!.clientWidth });
    onResize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  // Load bars whenever the symbol or interval changes.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setEmpty(false);
    api
      .bars(symbol, interval)
      .then((bars) => {
        if (cancelled || !seriesRef.current) return;
        if (bars.length === 0) {
          setEmpty(true);
          seriesRef.current.setData([]);
          return;
        }
        seriesRef.current.setData(
          bars.map((b) => ({
            time: Math.floor(new Date(b.time).getTime() / 1000) as UTCTimestamp,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          })),
        );
        chartRef.current?.timeScale().fitContent();
        applyLevels();
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval]);

  // Redraw GEX level lines when signals update.
  useEffect(() => {
    applyLevels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signals]);

  function applyLevels() {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of linesRef.current) series.removePriceLine(line);
    linesRef.current = [];
    const { callWall, putWall, gammaFlip } = gexLevels(signals);
    const add = (price: number | undefined, color: string, title: string) => {
      if (price === undefined) return;
      linesRef.current.push(
        series.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }),
      );
    };
    add(callWall, css("--bearish"), "call wall");
    add(putWall, css("--bullish"), "put wall");
    add(gammaFlip, css("--muted"), "γ flip");
  }

  return (
    <div className="chart">
      <div className="chart-toolbar">
        <div className="intervals">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              className={iv === interval ? "active" : ""}
              onClick={() => setIntervalState(iv)}
            >
              {iv}
            </button>
          ))}
        </div>
        <span className="chart-hint">15-min delayed · call/put walls from GEX overlaid</span>
      </div>
      <div ref={containerRef} className="chart-canvas" />
      {error && <p className="status error">Chart: {error}</p>}
      {empty && !error && (
        <p className="status info">No {interval} bars returned for this ticker.</p>
      )}
    </div>
  );
}
