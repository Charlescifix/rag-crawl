import type { LucideIcon } from 'lucide-react';

type MetricCardProps = {
  label: string;
  value: string;
  change: string;
  icon: LucideIcon;
  tone?: 'default' | 'good' | 'warn' | 'danger';
};

export function MetricCard({ label, value, change, icon: Icon, tone = 'default' }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__top">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{change}</small>
    </article>
  );
}
