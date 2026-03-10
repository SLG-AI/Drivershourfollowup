"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Users, UserMinus, TrendingDown, Activity, Target } from "lucide-react";

export interface WpDashboardStats {
  effectif_brut: number;
  effectif_net: number;
  bus_count: number;
  cam_count: number;
  headcount: number;
  taux_absenteisme: number;
  etp_total: number;
  departs_prevus: number;
  sorties_temporaires: number;
  gap_vs_cible: number | null;
  target_total: number | null;
}

export function WpKpiCards({ stats }: { stats: WpDashboardStats }) {
  const gapColor = stats.gap_vs_cible === null
    ? "text-muted-foreground"
    : stats.gap_vs_cible >= 0
      ? "text-emerald-600"
      : "text-red-600";

  const gapLabel = stats.gap_vs_cible === null
    ? "Pas de cible définie"
    : stats.gap_vs_cible >= 0
      ? `+${stats.gap_vs_cible} surplus`
      : `${stats.gap_vs_cible} déficit`;

  const cards = [
    {
      title: "Effectif sous contrat (ETP)",
      value: stats.effectif_brut,
      description: `${stats.bus_count} BUS / ${stats.cam_count} CAM — ${stats.headcount} pers.`,
      icon: Users,
      iconColor: "text-blue-600",
      iconBg: "bg-blue-50",
    },
    {
      title: "Effectif disponible net (ETP)",
      value: stats.effectif_net,
      description: `${stats.sorties_temporaires} ETP en sortie(s) temporaire(s)`,
      icon: UserMinus,
      iconColor: "text-indigo-600",
      iconBg: "bg-indigo-50",
    },
    {
      title: "Taux d'absentéisme",
      value: `${stats.taux_absenteisme.toFixed(1)}%`,
      description: "(effectif net - effectif réel) / effectif net",
      icon: Activity,
      iconColor: stats.taux_absenteisme > 8 ? "text-red-600" : stats.taux_absenteisme > 5 ? "text-amber-600" : "text-emerald-600",
      iconBg: stats.taux_absenteisme > 8 ? "bg-red-50" : stats.taux_absenteisme > 5 ? "bg-amber-50" : "bg-emerald-50",
    },
    {
      title: "Départs prévisibles",
      value: stats.departs_prevus,
      description: "Sorties identifiées (définitives + temporaires)",
      icon: TrendingDown,
      iconColor: "text-amber-600",
      iconBg: "bg-amber-50",
    },
    {
      title: "Gap vs cible",
      value: stats.gap_vs_cible !== null ? Math.abs(stats.gap_vs_cible) : "-",
      description: gapLabel,
      icon: Target,
      iconColor: gapColor,
      iconBg: stats.gap_vs_cible === null ? "bg-gray-50" : stats.gap_vs_cible >= 0 ? "bg-emerald-50" : "bg-red-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.description}
                </p>
              </div>
              <div className={`rounded-lg p-2 ${card.iconBg}`}>
                <card.icon className={`h-5 w-5 ${card.iconColor}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
