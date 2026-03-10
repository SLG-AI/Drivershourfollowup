"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

export interface HeadcountDataPoint {
  month: string;
  effectif_brut: number;
  effectif_net: number;
  is_projection: boolean;
  target?: number;
}

interface Props {
  data: HeadcountDataPoint[];
  title?: string;
}

export function HeadcountEvolutionChart({ data, title = "Évolution des effectifs" }: Props) {
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">
            Importez des données pour visualiser l&apos;évolution des effectifs.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Find the boundary between real and projected data
  const projectionStartIndex = data.findIndex((d) => d.is_projection);
  const hasTarget = data.some((d) => d.target != null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <Tooltip
              contentStyle={{
                borderRadius: "8px",
                border: "1px solid hsl(var(--border))",
                backgroundColor: "hsl(var(--background))",
              }}
              formatter={(value, name) => {
                const labels: Record<string, string> = {
                  effectif_brut: "Effectif brut",
                  effectif_net: "Effectif net",
                  target: "Cible",
                };
                return [value ?? 0, labels[String(name)] || String(name)];
              }}
            />
            <Legend
              formatter={(value: string) => {
                const labels: Record<string, string> = {
                  effectif_brut: "Effectif brut",
                  effectif_net: "Effectif net",
                  target: "Cible",
                };
                return labels[value] || value;
              }}
            />
            <Line
              type="monotone"
              dataKey="effectif_brut"
              stroke="hsl(221, 83%, 53%)"
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              dataKey="effectif_net"
              stroke="hsl(262, 83%, 58%)"
              strokeWidth={2}
              dot={{ r: 3 }}
              strokeDasharray={projectionStartIndex >= 0 ? undefined : undefined}
            />
            {hasTarget && (
              <Line
                type="monotone"
                dataKey="target"
                stroke="hsl(0, 84%, 60%)"
                strokeWidth={2}
                strokeDasharray="8 4"
                dot={false}
              />
            )}
            {projectionStartIndex > 0 && (
              <ReferenceLine
                x={data[projectionStartIndex].month}
                stroke="hsl(var(--muted-foreground))"
                strokeDasharray="4 4"
                label={{ value: "Projection", position: "top", fontSize: 11 }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
