import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';

interface ThroughputChartProps {
  data: any[];
}

export default function ThroughputChart({ data }: ThroughputChartProps) {
  // If we don't have historical points, just mock a small curve with the single metric we have
  // In a real app with timeseries data, we'd pass an array of { time, count } points.
  const chartData = data.length > 0 ? data : [
    { name: '10m ago', jobs: 0 },
    { name: '8m ago', jobs: 5 },
    { name: '6m ago', jobs: 12 },
    { name: '4m ago', jobs: 20 },
    { name: '2m ago', jobs: 18 },
    { name: 'Now', jobs: 25 },
  ];

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="colorJobs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Area 
            type="monotone" 
            dataKey="jobs" 
            stroke="#3b82f6" 
            strokeWidth={2}
            fillOpacity={1} 
            fill="url(#colorJobs)" 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
