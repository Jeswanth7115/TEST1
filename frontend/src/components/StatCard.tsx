interface StatCardProps {
  title: string;
  value: number | string;
  icon?: React.ReactNode;
  trend?: string;
  colorClass?: string;
}

export default function StatCard({ title, value, icon, trend, colorClass = 'text-slate-900' }: StatCardProps) {
  return (
    <div className="overflow-hidden rounded-xl bg-white px-4 py-5 shadow-sm ring-1 ring-slate-900/5 sm:p-6">
      <div className="flex items-center">
        {icon && <div className="mr-3">{icon}</div>}
        <dt className="truncate text-sm font-medium text-slate-500">{title}</dt>
      </div>
      <dd className={`mt-2 text-3xl font-semibold tracking-tight ${colorClass}`}>
        {value}
      </dd>
      {trend && (
        <div className="mt-2 text-sm text-slate-500">
          {trend}
        </div>
      )}
    </div>
  );
}
