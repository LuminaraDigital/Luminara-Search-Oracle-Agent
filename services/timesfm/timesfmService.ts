import type { 
  TimesFmPoint, 
  TimesFmConfig, 
  TimesFmCovariate, 
  TimesFmForecastResult, 
  BusinessDNA 
} from '../../types';
import { TimesFmMathEngine } from './timesfmEngine';
import { TIMESFM_BENCHMARKS, TIMESFM_DEFAULT_COVARIATES } from '../../constants';
import { geminiService } from '../geminiService';

export class TimesFmService {
  /**
   * Execute TimesFM Foundation Forecast
   */
  public async executeForecast(
    seriesName: string,
    history: TimesFmPoint[],
    config: TimesFmConfig,
    covariates: TimesFmCovariate[] = [],
    mode: 'edge' | 'neural' = 'edge',
    dna?: BusinessDNA | null
  ): Promise<TimesFmForecastResult> {
    if (!history || history.length === 0) {
      throw new Error("No data points available for TimesFM forecast.");
    }

    // Sort chronologically
    const sortedHistory = [...history].sort((a, b) => a.timestamp - b.timestamp);

    // Run core mathematical engine
    const mathResult = TimesFmMathEngine.runForecast(sortedHistory, config, covariates);

    let executiveSummary: string | undefined = undefined;

    if (mode === 'neural') {
      try {
        executiveSummary = await geminiService.generateTimesFMExecutiveBriefing(
          seriesName,
          sortedHistory,
          mathResult.forecast,
          mathResult.anomalies,
          mathResult.metrics,
          covariates,
          dna
        );
      } catch (err) {
        console.warn("Neural executive briefing fallback:", err);
        executiveSummary = this.generateLocalSummary(seriesName, sortedHistory, mathResult.forecast, mathResult.metrics);
      }
    } else {
      executiveSummary = this.generateLocalSummary(seriesName, sortedHistory, mathResult.forecast, mathResult.metrics);
    }

    const result: TimesFmForecastResult = {
      id: `timesfm_${Date.now()}`,
      name: seriesName,
      frequency: config.frequency,
      config,
      history: sortedHistory,
      forecast: mathResult.forecast,
      anomalies: mathResult.anomalies,
      metrics: mathResult.metrics,
      executiveSummary,
      generatedAt: Date.now(),
      executionMode: mode
    };

    return result;
  }

  /**
   * Fast rule-based executive summary for Edge execution
   */
  private generateLocalSummary(
    name: string,
    history: TimesFmPoint[],
    forecast: any[],
    metrics: any
  ): string {
    const lastHist = history[history.length - 1].value;
    const lastForecast = forecast[forecast.length - 1];
    const diffPct = lastHist !== 0 ? Math.round(((lastForecast.p50 - lastHist) / lastHist) * 100) : 0;
    const dir = diffPct >= 0 ? 'growth' : 'contraction';
    const uncertaintySpread = lastForecast.p50 !== 0 
      ? Math.round(((lastForecast.p90 - lastForecast.p10) / lastForecast.p50) * 100)
      : 0;

    return `
### TimesFM Foundation Projection: ${name}
- **Trajectory:** Projected **${diffPct >= 0 ? '+' : ''}${diffPct}% ${dir}** over the next **${forecast.length} steps**, reaching **${lastForecast.p50.toLocaleString()}** (median $p_{50}$).
- **Confidence Interval ($p_{10} \\to p_{90}$):** Range between **${lastForecast.p10.toLocaleString()}** (pessimistic) and **${lastForecast.p90.toLocaleString()}** (optimistic) with an estimated **${uncertaintySpread}% uncertainty cone**.
- **Model Telemetry:** Backtest MAPE is **${metrics.mape}%** with **${metrics.directionalAccuracy}% directional accuracy**. Volatility index benchmarked at **${metrics.volatilityIndex}**.
- **Strategic Recommendation:** Maintain high-frequency entity coverage and schema saturation to capture upside momentum toward $p_{90}$.
`.trim();
  }

  /**
   * Robust Time-Series Parser for CSV, TSV, JSON, and raw numbers
   */
  public parseTimeSeriesData(rawText: string): TimesFmPoint[] {
    const text = rawText.trim();
    if (!text) return [];

    // Attempt JSON parsing
    if (text.startsWith('[') && text.endsWith(']')) {
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((item, idx) => {
            const val = typeof item === 'number' ? item : (item.value ?? item.val ?? item.y ?? 0);
            const ts = item.timestamp ?? item.date ?? (Date.now() - (parsed.length - idx) * 86400000);
            const dateStr = typeof ts === 'string' ? ts : new Date(ts).toISOString().split('T')[0];
            return {
              timestamp: typeof ts === 'number' ? ts : new Date(ts).getTime(),
              dateStr,
              value: Number(val) || 0
            };
          }).filter(p => !isNaN(p.value));
        }
      } catch (e) {
        // Fall through to CSV/lines
      }
    }

    // CSV / TSV / Line parser
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return [];

    // Check if first line is a header
    const firstLine = lines[0];
    const isHeader = /[a-zA-Z]/.test(firstLine);
    const dataLines = isHeader ? lines.slice(1) : lines;

    const points: TimesFmPoint[] = [];
    const oneDay = 86400000;
    const now = Date.now();

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      // Split by comma, tab, or whitespace
      const tokens = line.split(/[,\t]+/).map(t => t.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      
      let dateStr = '';
      let timestamp = 0;
      let val = 0;

      if (tokens.length >= 2) {
        // Try parsing first token as date
        const possibleDate = new Date(tokens[0]);
        if (!isNaN(possibleDate.getTime())) {
          dateStr = tokens[0];
          timestamp = possibleDate.getTime();
          val = parseFloat(tokens[1].replace(/[^0-9.-]/g, ''));
        } else {
          // Maybe second token is date, first is value
          const secondDate = new Date(tokens[1]);
          if (!isNaN(secondDate.getTime())) {
            dateStr = tokens[1];
            timestamp = secondDate.getTime();
            val = parseFloat(tokens[0].replace(/[^0-9.-]/g, ''));
          } else {
            // Both might be numbers or index + number
            val = parseFloat(tokens[tokens.length - 1].replace(/[^0-9.-]/g, ''));
            const calculatedTime = now - (dataLines.length - i) * oneDay;
            timestamp = calculatedTime;
            dateStr = new Date(calculatedTime).toISOString().split('T')[0];
          }
        }
      } else if (tokens.length === 1) {
        val = parseFloat(tokens[0].replace(/[^0-9.-]/g, ''));
        const calculatedTime = now - (dataLines.length - i) * oneDay;
        timestamp = calculatedTime;
        dateStr = new Date(calculatedTime).toISOString().split('T')[0];
      }

      if (!isNaN(val)) {
        points.push({
          timestamp: timestamp || (now - (dataLines.length - i) * oneDay),
          dateStr: dateStr || new Date(now - (dataLines.length - i) * oneDay).toISOString().split('T')[0],
          value: val
        });
      }
    }

    return points;
  }

  /**
   * Get default benchmarks
   */
  public getBenchmarks() {
    return TIMESFM_BENCHMARKS;
  }

  /**
   * Get default covariates
   */
  public getDefaultCovariates(): TimesFmCovariate[] {
    return JSON.parse(JSON.stringify(TIMESFM_DEFAULT_COVARIATES));
  }
}

export const timesfmService = new TimesFmService();
