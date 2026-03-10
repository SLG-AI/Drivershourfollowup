"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export interface BreakdownByType {
  label: string;
  actifs: number;
  sorties_temp: number;
  departs: number;
}

export interface BreakdownByDepot {
  depot: string;
  bus: number;
  cam: number;
  total: number;
}

interface Props {
  byType: BreakdownByType[];
  byDepot: BreakdownByDepot[];
}

export function BreakdownChart({ byType, byDepot }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Ventilation des effectifs</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="type">
          <TabsList className="mb-4">
            <TabsTrigger value="type">Par type</TabsTrigger>
            <TabsTrigger value="depot">Par dépôt</TabsTrigger>
          </TabsList>

          <TabsContent value="type">
            {byType.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Pas de données.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byType} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--background))",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="actifs" name="Actifs" fill="hsl(221, 83%, 53%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="sorties_temp" name="Sorties temp." fill="hsl(262, 83%, 58%)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="departs" name="Départs" fill="hsl(0, 84%, 60%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </TabsContent>

          <TabsContent value="depot">
            {byDepot.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Pas de données.</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byDepot} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 120 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="depot" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid hsl(var(--border))",
                      backgroundColor: "hsl(var(--background))",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="bus" name="BUS" fill="hsl(221, 83%, 53%)" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="cam" name="CAM" fill="hsl(45, 93%, 47%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
