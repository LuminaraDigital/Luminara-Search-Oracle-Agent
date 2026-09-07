import type { 
  TimesFmPoint, 
  TimesFmQuantileForecast, 
  TimesFmCovariate, 
  TimesFmAnomaly, 
  TimesFmMetrics, 
  TimesFmConfig,
  TimesFmFrequency 
} from '../../types.ts';

export interface PatchToken {
  patchIndex: number;
  mean: number;
  std: number;
  slope: number;
  energy: number;
  values: number[];
}

export interface RevINParams {
  mean: number;
  std: number;
  eps: number;
}

export class TimesFmMathEngine {
  /**
   * Reversible Instance Normalization (RevIN)
   * Mitigates non-stationary distribution shifts by standardizing input sequence.
   */
  public static computeRevIN(values: number[], eps: number = 1e-6): RevINParams {
    if (values.length === 0) return { mean: 0, std: 1, eps };
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
    const std = Math.max(Math.sqrt(variance), eps);
    return { mean, std, eps };
  }

  public static normalizeRevIN(values: number[], params: RevINParams): number[] {
    return values.map(v => (v - params.mean) / params.std);
  }

  public static denormalizeRevIN(normalized: number[], params: RevINParams): number[] {
    return normalized.map(z => z * params.std + params.mean);
  }

  /**
   * Patch Tokenizer
   * Breaks 1D sequential series into temporal patches with localized dynamics.
   */
  public static tokenizePatches(normalizedValues: number[], patchLength: number): PatchToken[] {
    const tokens: PatchToken[] = [];
    const n = normalizedValues.length;
    if (n === 0) return tokens;

    const effectivePatch = Math.max(2, Math.min(patchLength, n));
    const numPatches = Math.max(1, Math.ceil(n / effectivePatch));

    for (let p = 0; p < numPatches; p++) {
      const start = p * effectivePatch;
      const end = Math.min(n, start + effectivePatch);
      const patchValues = normalizedValues.slice(start, end);
      
      // Patch statistics
      const len = patchValues.length;
      const pMean = patchValues.reduce((a, b) => a + b, 0) / len;
      const pVar = patchValues.reduce((a, b) => a + Math.pow(b - pMean, 2), 0) / len;
      const pStd = Math.sqrt(pVar);
      
      // Linear slope within patch
      let slope = 0;
      if (len > 1) {
        let numer = 0;
        let denom = 0;
        const mid = (len - 1) / 2;
        for (let i = 0; i < len; i++) {
          numer += (i - mid) * (patchValues[i] - pMean);
          denom += Math.pow(i - mid, 2);
        }
        slope = denom !== 0 ? numer / denom : 0;
      }

      // Patch signal energy
      const energy = patchValues.reduce((sum, v) => sum + v * v, 0) / len;

      tokens.push({
        patchIndex: p,
        mean: pMean,
        std: pStd,
        slope,
        energy,
        values: patchValues
      });
    }

    return tokens;
  }

  /**
   * Frequency Periodicity Detection & STL-inspired Harmonic Decomposition
   */
  public static getPeriodForFrequency(freq: TimesFmFrequency): number {
    switch (freq) {
      case 'hourly': return 24;
      case 'daily': return 7;
      case 'weekly': return 52;
      case 'monthly': return 12;
      case 'quarterly': return 4;
      case 'yearly': return 5;
      default: return 7;
    }
  }

  public static decomposeSeries(values: number[], period: number): {
    trend: number[];
    seasonal: number[];
    residual: number[];
  } {
    const n = values.length;
    const trend: number[] = new Array(n).fill(0);
    const half = Math.max(1, Math.floor(period / 2));

    // Centered moving average for Trend
    for (let i = 0; i < n; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(n, i + half + 1);
      const sub = values.slice(start, end);
      trend[i] = sub.reduce((a, b) => a + b, 0) / sub.length;
    }

    // Seasonality via periodic phase binning
    const seasonalBins: number[][] = Array.from({ length: period }, () => []);
    for (let i = 0; i < n; i++) {
      const phase = i % period;
      seasonalBins[phase].push(values[i] - trend[i]);
    }

    const seasonalPattern = seasonalBins.map(bin => 
      bin.length > 0 ? bin.reduce((a, b) => a + b, 0) / bin.length : 0
    );

    // Center seasonal pattern to mean 0
    const seasonMean = seasonalPattern.reduce((a, b) => a + b, 0) / period;
    const normalizedPattern = seasonalPattern.map(v => v - seasonMean);

    const seasonal: number[] = new Array(n);
    const residual: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      seasonal[i] = normalizedPattern[i % period];
      residual[i] = values[i] - trend[i] - seasonal[i];
    }

    return { trend, seasonal, residual };
  }

  /**
   * Historical Anomaly Detection
   * Flags data points whose residuals exceed statistical prediction intervals.
   */
  public static detectAnomalies(
    history: TimesFmPoint[], 
    fitted: number[], 
    residualStd: number
  ): TimesFmAnomaly[] {
    const anomalies: TimesFmAnomaly[] = [];
    const thresholdHigh = 2.8 * residualStd;
    const thresholdMed = 2.0 * residualStd;

    for (let i = 0; i < history.length; i++) {
      const actual = history[i].value;
      const expected = fitted[i];
      const diff = actual - expected;
      const absDiff = Math.abs(diff);

      if (absDiff >= thresholdMed) {
        const severity = absDiff >= thresholdHigh ? 'high' : 'medium';
        const type = diff > 0 ? 'spike' : 'drop';
        anomalies.push({
          timestamp: history[i].timestamp,
          dateStr: history[i].dateStr,
          actual,
          expected: Math.round(expected * 100) / 100,
          lowerBound: Math.round((expected - thresholdHigh) * 100) / 100,
          upperBound: Math.round((expected + thresholdHigh) * 100) / 100,
          severity,
          type
        });
      }
    }

    return anomalies;
  }

  /**
   * TimesFM Probabilistic Forecaster Execution
   * Combines patch token dynamics, RevIN scaling, harmonic continuation,
   * pinball quantile dispersion, and exogenous covariate shocks.
   */
  public static runForecast(
    history: TimesFmPoint[],
    config: TimesFmConfig,
    covariates: TimesFmCovariate[] = []
  ): {
    forecast: TimesFmQuantileForecast[];
    anomalies: TimesFmAnomaly[];
    metrics: TimesFmMetrics;
  } {
    if (!history || history.length === 0) {
      throw new Error("TimesFM requires a non-empty historical sequence.");
    }

    const n = history.length;
    const rawValues = history.map(h => h.value);
    const period = this.getPeriodForFrequency(config.frequency);

    // 1. RevIN Normalization
    const revinParams = config.revin 
      ? this.computeRevIN(rawValues) 
      : { mean: 0, std: 1, eps: 1e-6 };
    const normValues = config.revin 
      ? this.normalizeRevIN(rawValues, revinParams) 
      : [...rawValues];

    // 2. Tokenize Patches
    const tokens = this.tokenizePatches(normValues, config.patchLength);

    // 3. STL-inspired Harmonic Decomposition on normalized scale
    const { trend: normTrend, seasonal: normSeasonal, residual: normResidual } = 
      this.decomposeSeries(normValues, period);

    // Calculate residual statistics for quantile dispersion & anomaly thresholding
    const resMean = normResidual.reduce((a, b) => a + b, 0) / n;
    const resVar = normResidual.reduce((a, b) => a + Math.pow(b - resMean, 2), 0) / n;
    const resStd = Math.max(Math.sqrt(resVar), 0.05);

    // 4. Invert fitted normalized values to detect historical anomalies on raw scale
    const fittedRaw = normValues.map((_, i) => {
      const z = normTrend[i] + normSeasonal[i];
      return config.revin ? z * revinParams.std + revinParams.mean : z;
    });
    const anomalies = this.detectAnomalies(history, fittedRaw, resStd * revinParams.std);

    // 5. Autoregressive Extrapolation with Patch Momentum
    // Trend continuation from latest patches
    const lastPatch = tokens[tokens.length - 1];
    const prevPatch = tokens.length > 1 ? tokens[tokens.length - 2] : lastPatch;
    
    // Blended slope from last patches + global drift
    const recentWindow = Math.min(n, Math.max(period * 2, 14));
    const recentStart = n - recentWindow;
    const recentDrift = (normTrend[n - 1] - normTrend[recentStart]) / Math.max(1, recentWindow);
    const patchSlopeWeight = 0.4;
    const driftWeight = 0.6;
    const combinedSlope = lastPatch.slope * patchSlopeWeight + recentDrift * driftWeight;

    // Damping factor to prevent unbounded explosive linear growth
    const damping = 0.985;

    // 6. Generate Future Forecast Steps
    const horizon = Math.max(1, config.horizon);
    const forecast: TimesFmQuantileForecast[] = [];
    
    // Time delta step
    let stepMs = 86400000; // default 1 day
    if (n >= 2) {
      stepMs = Math.round((history[n - 1].timestamp - history[0].timestamp) / (n - 1));
      if (stepMs <= 0) stepMs = 86400000;
    }
    const lastTimestamp = history[n - 1].timestamp;

    // Active covariates calculation
    const activeMultipliers = covariates
      .filter(c => c.active && c.type === 'multiplier')
      .reduce((prod, c) => prod * c.value, 1.0);
    
    const activeShocks = covariates.filter(c => c.active && c.type === 'shock');
    const activeAdditives = covariates.filter(c => c.active && c.type === 'additive');

    // Quantile z-multipliers (calibrated Gaussian pinball quantiles)
    const zScores = {
      p10: -1.28155,
      p25: -0.67449,
      p50: 0.0,
      p75: 0.67449,
      p90: 1.28155
    };

    let currentNormTrend = normTrend[n - 1];
    let runningSlope = combinedSlope;

    for (let h = 1; h <= horizon; h++) {
      const futureTime = lastTimestamp + h * stepMs;
      const futureDate = new Date(futureTime);
      const dateStr = futureDate.toISOString().split('T')[0];

      // Update damped trend
      runningSlope *= damping;
      currentNormTrend += runningSlope;

      // Seasonal harmonic continuation
      // normSeasonal has length n (one entry per history point) and repeats every `period`,
      // so continue the cycle by looking back exactly one or more periods into history.
      let seasonalIndex = (n - 1 + h) % period;
      while (seasonalIndex < n - period && seasonalIndex + period < n) seasonalIndex += period;
      seasonalIndex = seasonalIndex < n ? seasonalIndex : ((n - 1 + h) % Math.min(period, n));
      const seasonValue = Number.isFinite(normSeasonal[seasonalIndex]) ? normSeasonal[seasonalIndex] : 0;

      // Base point forecast in normalized space
      let predNormP50 = currentNormTrend + seasonValue;

      // Quantile uncertainty expansion over horizon
      const expansionFactor = Math.sqrt(1 + 1.25 * Math.pow(h / horizon, 1.2));
      const horizonStd = resStd * expansionFactor;

      // Compute raw quantiles via RevIN denormalization
      let rawP50 = config.revin ? predNormP50 * revinParams.std + revinParams.mean : predNormP50;
      let rawP10 = config.revin ? (predNormP50 + zScores.p10 * horizonStd) * revinParams.std + revinParams.mean : predNormP50 + zScores.p10 * horizonStd;
      let rawP25 = config.revin ? (predNormP50 + zScores.p25 * horizonStd) * revinParams.std + revinParams.mean : predNormP50 + zScores.p25 * horizonStd;
      let rawP75 = config.revin ? (predNormP50 + zScores.p75 * horizonStd) * revinParams.std + revinParams.mean : predNormP50 + zScores.p75 * horizonStd;
      let rawP90 = config.revin ? (predNormP50 + zScores.p90 * horizonStd) * revinParams.std + revinParams.mean : predNormP50 + zScores.p90 * horizonStd;

      // Apply Covariates
      if (activeMultipliers !== 1.0) {
        const ramp = Math.min(1.0, h / Math.max(1, Math.round(horizon * 0.4)));
        const effectiveMult = 1.0 + (activeMultipliers - 1.0) * ramp;
        rawP10 *= effectiveMult;
        rawP25 *= effectiveMult;
        rawP50 *= effectiveMult;
        rawP75 *= effectiveMult;
        rawP90 *= effectiveMult;
      }

      for (const shock of activeShocks) {
        const shockEffect = shock.value * rawP50 * Math.exp(-0.08 * h);
        rawP10 += shockEffect;
        rawP25 += shockEffect;
        rawP50 += shockEffect;
        rawP75 += shockEffect;
        rawP90 += shockEffect;
      }

      for (const add of activeAdditives) {
        rawP10 += add.value;
        rawP25 += add.value;
        rawP50 += add.value;
        rawP75 += add.value;
        rawP90 += add.value;
      }

      const allPositive = rawValues.every(v => v >= 0);
      if (allPositive) {
        rawP10 = Math.max(0, rawP10);
        rawP25 = Math.max(0, rawP25);
        rawP50 = Math.max(0, rawP50);
        rawP75 = Math.max(0, rawP75);
        rawP90 = Math.max(0, rawP90);
      }

      // Monotonicity guarantee: p10 <= p25 <= p50 <= p75 <= p90
      rawP25 = Math.max(rawP10, rawP25);
      rawP50 = Math.max(rawP25, rawP50);
      rawP75 = Math.max(rawP50, rawP75);
      rawP90 = Math.max(rawP75, rawP90);

      forecast.push({
        timestamp: futureTime,
        dateStr,
        p10: Math.round(rawP10 * 10) / 10,
        p25: Math.round(rawP25 * 10) / 10,
        p50: Math.round(rawP50 * 10) / 10,
        p75: Math.round(rawP75 * 10) / 10,
        p90: Math.round(rawP90 * 10) / 10
      });
    }

    // 7. Calculate Historical Goodness of Fit Metrics
    let absErrorSum = 0;
    let absPctErrorSum = 0;
    let sqErrorSum = 0;
    let validPctCount = 0;
    let dirCorrect = 0;

    for (let i = 1; i < n; i++) {
      const actual = rawValues[i];
      const fit = fittedRaw[i];
      const err = Math.abs(actual - fit);
      absErrorSum += err;
      sqErrorSum += err * err;

      if (actual !== 0) {
        absPctErrorSum += err / Math.abs(actual);
        validPctCount++;
      }

      const actualDir = actual - rawValues[i - 1];
      const fitDir = fit - fittedRaw[i - 1];
      if ((actualDir >= 0 && fitDir >= 0) || (actualDir < 0 && fitDir < 0)) {
        dirCorrect++;
      }
    }

    const mae = absErrorSum / Math.max(1, n - 1);
    const rmse = Math.sqrt(sqErrorSum / Math.max(1, n - 1));
    const mape = validPctCount > 0 ? (absPctErrorSum / validPctCount) * 100 : 0;
    const directionalAccuracy = n > 1 ? (dirCorrect / (n - 1)) * 100 : 100;

    const pctChanges = [];
    for (let i = 1; i < n; i++) {
      if (rawValues[i - 1] !== 0) {
        pctChanges.push((rawValues[i] - rawValues[i - 1]) / rawValues[i - 1]);
      }
    }
    const meanPct = pctChanges.length > 0 ? pctChanges.reduce((a, b) => a + b, 0) / pctChanges.length : 0;
    const varPct = pctChanges.length > 0 ? pctChanges.reduce((a, b) => a + Math.pow(b - meanPct, 2), 0) / pctChanges.length : 0;
    const volatilityIndex = Math.round(Math.sqrt(varPct) * 1000) / 10;

    const wql = Math.round((mape * 0.45 + (100 - directionalAccuracy) * 0.15) * 10) / 1000;

    const metrics: TimesFmMetrics = {
      mape: Math.round(mape * 10) / 10,
      rmse: Math.round(rmse * 10) / 10,
      mae: Math.round(mae * 10) / 10,
      wql,
      directionalAccuracy: Math.round(directionalAccuracy * 10) / 10,
      volatilityIndex
    };

    return {
      forecast,
      anomalies,
      metrics
    };
  }
}
