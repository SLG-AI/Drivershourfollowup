"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface PeriodData {
  periodLabel: string;
  overtimePay: number;
  positiveEnd: number;
  missingEnd: number;
}

export function PeriodComparisonChart({ data }: { data: PeriodData[] }) {
  if (data.length === 0) return null;

  const chartData = data.map((d) => ({
    name: d.periodLabel,
    "Heures payées": Number(d.overtimePay.toFixed(2)),
    "Heures positives fin": Number(d.positiveEnd.toFixed(2)),
    "Heures manquantes fin": Number(d.missingEnd.toFixed(2)),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comparaison par période</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={chartData}
            margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip
              formatter={(value) => [`${Number(value).toFixed(2)}h`]}
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid var(--border)",
              }}
            />
            <Legend />
            <Bar dataKey="Heures payées" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Heures positives fin" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Heures manquantes fin" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
