"use client";

import { useDashboardSummary } from "./use-dashboard-summary";
import { CalibrationMatrix } from "./calibration-matrix";
import { CalibrationLocked } from "./calibration-locked";
import { PredictionAccuracy } from "./prediction-accuracy";
import { PredictionAccuracyLocked } from "./prediction-accuracy-locked";
import { BiggestMisses } from "./biggest-misses";

/** 复盘实验室「预测与校准」区块：自取数，loading 时不渲染，出错时只显示一行提示。 */
export function PredictionPanel() {
  const { data, loading, error } = useDashboardSummary();

  if (loading) return null;
  if (error) return <small className="panel-fetch-error">预测与校准加载失败：{error}</small>;
  if (!data) return null;

  return (
    <section className="panel prediction-panel">
      <header className="panel-heading">
        <div><span className="eyebrow">PREDICTION &amp; CALIBRATION</span><h2>预测与校准</h2></div>
      </header>
      <div className="prediction-panel-body">
        {data.calibration
          ? <CalibrationMatrix data={data.calibration} />
          : <CalibrationLocked sampleCount={data.stats.retroedCount} />}
        {data.predictionAccuracy
          ? <PredictionAccuracy data={data.predictionAccuracy} />
          : <PredictionAccuracyLocked />}
        <BiggestMisses items={data.biggestMisses} />
      </div>
    </section>
  );
}
