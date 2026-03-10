"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from "recharts";

export interface GapDataPoint {
  month: string;
  effectif_net: number;
  target: number;
  gap: number;
}

interface Props {
  data: GapDataPoint[];
}

export function GapAnalysisChart({ data }: Props) {
  if (data.length === 0 || !data.some((d) => d.target > 0)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gap Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Définissez des besoins cibles pour visualiser le gap.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Custom area data: split gap into surplus and deficit
  const chartData = data.map((d) => ({
    month: d.month,
    effectif_net: d.effectif_net,
    target: d.target,
    surplus: d.gap > 0 ? d.gap : 0,
    deficit: d.gap < 0 ? d.gap : 0,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Gap Analysis — Effectif net vs Cible</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--background))",
              }}
              formatter={(value, name) => {
                const labels: Record<string, string> = {
                  effectif_net: "Effectif net",
                  target: "Cible",
                  surplus: "Surplus",
                  deficit: "Déficit",
                };
                return [value, labels[String(name)] || String(name)];
              }}
            />
            <Legend
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  effectif_net: "Effectif net",
                  target: "Cible",
                  surplus: "Surplus",
                  deficit: "Déficit",
                };
                return labels[value] || value;
              }}
            />
            <Area
              type="monotone"
              dataKey="surplus"
              fill="hsl(142, 71%, 45%)"
              fillOpacity={0.3}
              stroke="hsl(142, 71%, 45%)"
              strokeWidth={0}
            />
            <Area
              type="monotone"
              dataKey="deficit"
              fill="hsl(0, 84%, 60%)"
              fillOpacity={0.3}
              stroke="hsl(0, 84%, 60%)"
              strokeWidth={0}
            />
            <ReferenceLine y={data[0]?.target} stroke="hsl(0, 84%, 60%)" strokeDasharray="8 4" />
            <Area
              type="monotone"
              dataKey="effectif_net"
              fill="hsl(262, 83%, 58%)"
              fillOpacity={0.1}
              stroke="hsl(262, 83%, 58%)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
