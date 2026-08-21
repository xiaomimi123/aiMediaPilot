"use client";

import type { WorkStage, DeliveryMode } from "@/lib/cockpit/model";
import { computeStepNodes } from "@/lib/cockpit/stage-stepper";
import { stageLabelFor } from "@/lib/cockpit/platform-stages";

export function StageStepper({ platform, flow, currentStage, activeStage, onSelect, deliveryMode }: {
  platform: string;
  flow: WorkStage[];
  currentStage: string;
  activeStage: WorkStage | "overview";
  onSelect: (stage: WorkStage | "overview") => void;
  deliveryMode?: DeliveryMode;
}) {
  const nodes = computeStepNodes(flow, currentStage as never);
  return <div className="stage-stepper">
    <button type="button" className={`stage-stepper-overview ${activeStage === "overview" ? "active" : ""}`} onClick={() => onSelect("overview")}>概览</button>
    <div className="stage-stepper-track">
      {nodes.map((node, idx) => <div key={node.stage} className="stage-stepper-item-wrap">
        <button
          type="button"
          className={`stage-stepper-node ${node.status} ${activeStage === node.stage ? "active" : ""}`}
          onClick={() => onSelect(node.stage)}
          aria-current={activeStage === node.stage ? "step" : undefined}
        >
          <span className="stage-stepper-dot">{node.status === "done" ? "✓" : ""}</span>
          <span className="stage-stepper-label">{deliveryMode !== 'manual' && deliveryMode !== undefined && node.stage === 'editing' ? '生成成片' : stageLabelFor(platform, node.stage)}</span>
        </button>
        {idx < nodes.length - 1 ? <span className={`stage-stepper-line ${node.status === "done" ? "done" : ""}`} /> : null}
      </div>)}
    </div>
  </div>;
}
