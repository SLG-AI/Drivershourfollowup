"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DistributionData {
  bucket: string;
  count: number;
}

const BUCKET_COLORS: Record<string, string> = {
  "< -10h": "#6366f1",
  "-10h à 0h": "#3b82f6",
  "0h à 5h": "#22c55e",
  "5h à 10h": "#eab308",
  "10h à 15h": "#f97316",
  "> 15h": "#ef4444",
};

export function CounterDistributionChart({
  data,
}: {
  data: DistributionData[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Distribution des compteurs</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Aucune donnée disponible
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="bucket" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip
                formatter={(value) => [`${value} conducteurs`, "Nombre"]}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {data.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={BUCKET_COLORS[entry.bucket] || "#6366f1"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
