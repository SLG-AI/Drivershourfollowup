"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FRENCH_MONTHS_SHORT } from "@/lib/constants";

interface MonthlyRecord {
  month: number;
  year: number;
  counter_end: number;
  positive_hours: number;
  missing_hours: number;
  overtime_pay: number;
}

export function CounterEvolutionChart({
  records,
  bufferHours,
}: {
  records: MonthlyRecord[];
  bufferHours: number;
}) {
  const data = records
    .sort((a, b) => a.year * 100 + a.month - (b.year * 100 + b.month))
    .map((r) => ({
      name: FRENCH_MONTHS_SHORT[r.month] || String(r.month),
      compteur: Number(r.counter_end),
      heuresPos: Number(r.positive_hours),
      heuresManq: Number(r.missing_hours),
    }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Évolution du compteur</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">
            Aucune donnée disponible
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip
                formatter={(value, name) => {
                  const labels: Record<string, string> = {
                    compteur: "Compteur",
                    heuresPos: "Heures pos.",
                    heuresManq: "Heures manq.",
                  };
                  return [`${Number(value).toFixed(2)}h`, labels[String(name)] || String(name)];
                }}
                contentStyle={{
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                }}
              />
              <ReferenceLine
                y={bufferHours * 0.8}
                stroke="#f59e0b"
                strokeDasharray="5 5"
                label={{ value: "Seuil 80%", position: "right", fontSize: 11, fill: "#f59e0b" }}
              />
              <ReferenceLine
                y={0}
                stroke="#94a3b8"
                strokeDasharray="2 2"
              />
              <Line
                type="monotone"
                dataKey="compteur"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ r: 4 }}
                activeDot={{ r: 6 }}
              />
              <Line
                type="monotone"
                dataKey="heuresPos"
                stroke="#22c55e"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="heuresManq"
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="5 5"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
