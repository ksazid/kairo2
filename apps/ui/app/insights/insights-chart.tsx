"use client";

import { useEffect, useRef } from "react";
import type { InsightPoint } from "../../lib/insights";

export function InsightsChart({ points, compare }: { points: InsightPoint[]; compare: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(bounds.width * ratio));
      canvas.height = Math.max(1, Math.round(bounds.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) return;
      context.scale(ratio, ratio);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const left = 38;
      const right = 14;
      const top = 18;
      const bottom = 29;
      const width = Math.max(1, bounds.width - left - right);
      const height = Math.max(1, bounds.height - top - bottom);
      const max = Math.max(...points.flatMap((point) => [point.current, point.previous]), 1) * 1.18;
      context.font = "9px Inter, system-ui, sans-serif";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let step = 0; step <= 4; step += 1) {
        const y = top + (height * step / 4);
        context.strokeStyle = "#344354";
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(left, y);
        context.lineTo(left + width, y);
        context.stroke();
        context.fillStyle = "#718092";
        context.fillText(String(Math.round(max * (1 - step / 4))), left - 8, y);
      }
      points.forEach((point, index) => {
        const x = left + (width * index / Math.max(1, points.length - 1));
        context.fillStyle = "#718092";
        context.textAlign = index === 0 ? "left" : index === points.length - 1 ? "right" : "center";
        context.textBaseline = "bottom";
        context.fillText(point.label, x, bounds.height - 3);
      });
      const draw = (key: "current" | "previous", color: string, lineWidth: number) => {
        context.beginPath();
        points.forEach((point, index) => {
          const x = left + (width * index / Math.max(1, points.length - 1));
          const y = top + height - ((point[key] / max) * height);
          if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.stroke();
      };
      if (compare) draw("previous", "#c7ed3e", 2.5);
      draw("current", "#a77cff", 3.5);
      points.forEach((point, index) => {
        const x = left + (width * index / Math.max(1, points.length - 1));
        const y = top + height - ((point.current / max) * height);
        context.beginPath();
        context.arc(x, y, 3.5, 0, Math.PI * 2);
        context.fillStyle = "#0b141e";
        context.fill();
        context.strokeStyle = "#b89bff";
        context.lineWidth = 2;
        context.stroke();
      });
    };
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    render();
    return () => observer.disconnect();
  }, [compare, points]);

  return <canvas ref={canvasRef} role="img" aria-label={`Performance trend for ${points.map((point) => point.label).join(", ")}`}/>;
}
