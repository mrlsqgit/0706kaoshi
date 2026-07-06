'use client';

interface ProgressBarProps {
  percent: number;
  label?: string;
  showPercent?: boolean;
}

export default function ProgressBar({ percent, label, showPercent = true }: ProgressBarProps) {
  return (
    <div>
      {(label || showPercent) && (
        <div className="flex items-center justify-between mb-2">
          {label && <span className="text-sm text-[#4e5969]">{label}</span>}
          {showPercent && <span className="text-sm font-bold text-[#0fc6c2]">{Math.round(percent)}%</span>}
        </div>
      )}
      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
