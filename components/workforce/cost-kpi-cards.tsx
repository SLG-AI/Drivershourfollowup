"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Euro, UserMinus, Wallet, Thermometer, Receipt, Percent, Users, CalendarRange, HelpCircle } from "lucide-react";
import Link from "next/link";
import { formatEuros } from "@/lib/utils/format";

export interface CoutsStats {
  /** Paliers du mois affiché (fin de mois), en euros. */
  sous_contrat: number;
  cout_suspendu: number;
  apres_suspension: number;
  cout_perdu_cns: number;
  cout_perdu_injustifiees: number;
  paye: number | undefined;
  cout_perdu_mct: number | undefined;
  disponible: number | undefined;
  /** Moyennes du mois (pondérées par les jours), absentes sans vue Moyenne. */
  sous_contrat_moyen?: number;
  apres_suspension_moyen?: number;
  paye_moyen?: number;
  /** Paie réalisée du mois (Total SECU), null quand le fichier n'a pas de montants. */
  realise: number | null;
  realise_lignes: number;
  coefficient: number;
  /** « calculé sur Mars 2026 (1 380 lignes, périmètre) » ou null si valeur par défaut. */
  coefficient_source: string | null;
  cout_moyen_etp: number;
  brut_plein_temps_moyen: number;
  etp_sous_contrat: number;
  /** Somme des douze mois sous contrat, mesurés et reportés. */
  masse_annuelle: number;
  mois_reportes: number;
  /** Salariés du mois sans salaire connu, valorisés au coût moyen. */
  codes_sans_salaire: number;
  /** Mois affiché (libellé) et mois de la photo de référence salariale. */
  mois_label: string;
  reference_label: string | null;
  /** Masse annuelle avec les scénarios sélectionnés (mois projetés remplacés), absente sans scénario. */
  masse_annuelle_scenario?: number;
}

const euros = (n: number | undefined | null) => (n == null ? "—" : formatEuros(n));
const pct = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

export function CostKpiCards({ stats, lienMethodologie }: { stats: CoutsStats; lienMethodologie: string }) {
  const ecart = stats.realise != null && stats.paye != null ? stats.realise - stats.paye : null;
  const ecartPct = ecart != null && stats.paye ? (ecart / stats.paye) * 100 : null;

  const cards = [
    {
      title: "Coût employeur sous contrat",
      ancre: "cout-sous-contrat",
      value: euros(stats.sous_contrat),
      description: `${stats.etp_sous_contrat.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ETP × ${euros(stats.cout_moyen_etp)} par ETP`,
      average: stats.sous_contrat_moyen != null ? `Moyenne du mois : ${euros(stats.sous_contrat_moyen)}` : null,
      note: stats.codes_sans_salaire > 0 ? `${stats.codes_sans_salaire} salarié${stats.codes_sans_salaire > 1 ? "s" : ""} sans salaire connu, au coût moyen` : null,
      icon: Euro, iconColor: "text-blue-600", iconBg: "bg-blue-50",
    },
    {
      title: "Coût après suspension de contrat",
      ancre: "cout-apres-suspension",
      value: euros(stats.apres_suspension),
      description: `${euros(stats.cout_suspendu)} de contrats suspendus (non payés)`,
      average: stats.apres_suspension_moyen != null ? `Moyenne du mois : ${euros(stats.apres_suspension_moyen)}` : null,
      note: null,
      icon: UserMinus, iconColor: "text-indigo-600", iconBg: "bg-indigo-50",
    },
    {
      title: "Coût payé (après CNS et injustifiées)",
      ancre: "cout-paye",
      value: euros(stats.paye),
      description: `Non payé : CNS ${euros(stats.cout_perdu_cns)} + injustifiées ${euros(stats.cout_perdu_injustifiees)}`,
      average: stats.paye_moyen != null ? `Moyenne du mois : ${euros(stats.paye_moyen)}` : null,
      note: null,
      icon: Wallet, iconColor: "text-yellow-600", iconBg: "bg-yellow-50",
    },
    {
      title: "Coût des absences payées (MCT)",
      ancre: "cout-mct",
      value: euros(stats.cout_perdu_mct),
      description: stats.disponible != null ? `Coût disponible après MCT : ${euros(stats.disponible)}` : "Taux MCT inconnu pour ce mois",
      average: null,
      note: null,
      icon: Thermometer, iconColor: "text-pink-600", iconBg: "bg-pink-50",
    },
    {
      title: "Réalisé du mois (Total SECU)",
      ancre: "cout-realise",
      value: stats.realise != null ? euros(stats.realise) : "—",
      description:
        stats.realise != null
          ? `${stats.realise_lignes.toLocaleString("fr-FR")} lignes de paie${ecart != null ? ` · écart vs payé contractuel ${ecart >= 0 ? "+" : "−"}${euros(Math.abs(ecart))}${ecartPct != null ? ` (${ecartPct >= 0 ? "+" : "−"}${pct(Math.abs(ecartPct))})` : ""}` : ""}`
          : `Aucun montant importé pour ${stats.mois_label}`,
      average: null,
      note: stats.realise == null && stats.realise_lignes > 0 ? `${stats.realise_lignes} lignes présentes mais sans salaire (fichier « sans salaire »)` : null,
      icon: Receipt, iconColor: "text-slate-600", iconBg: "bg-slate-100",
    },
    {
      title: "Coefficient de charges patronales",
      ancre: "coefficient-charges",
      value: stats.coefficient.toLocaleString("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
      description: stats.coefficient_source ?? "Valeur par défaut : aucun mois de statistiques salariales avec montants",
      average: null,
      note: stats.coefficient_source ? null : "À affiner en important des Statistiques rapides avec salaires",
      icon: Percent, iconColor: stats.coefficient_source ? "text-emerald-600" : "text-amber-600", iconBg: stats.coefficient_source ? "bg-emerald-50" : "bg-amber-50",
    },
    {
      title: "Coût moyen par ETP",
      ancre: "cout-moyen-etp",
      value: euros(stats.cout_moyen_etp),
      description: `Brut plein temps moyen ${euros(stats.brut_plein_temps_moyen)} × coefficient`,
      average: null,
      note: stats.reference_label ? `Salaires lus dans le roster de ${stats.reference_label}` : null,
      icon: Users, iconColor: "text-violet-600", iconBg: "bg-violet-50",
    },
    {
      title: "Masse salariale annuelle sous contrat",
      ancre: "masse-annuelle",
      value: euros(stats.masse_annuelle),
      description: "Somme des douze mois, coût employeur contractuel",
      average: null,
      note:
        stats.masse_annuelle_scenario != null
          ? `Avec scénario : ${euros(stats.masse_annuelle_scenario)} (${stats.masse_annuelle_scenario - stats.masse_annuelle >= 0 ? "+" : "−"}${euros(Math.abs(stats.masse_annuelle_scenario - stats.masse_annuelle))})`
          : stats.mois_reportes > 0 ? `${stats.mois_reportes} mois sur 12 reportés (photo ou salaires d'un autre mois)` : null,
      icon: CalendarRange, iconColor: "text-teal-600", iconBg: "bg-teal-50",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{card.description}</p>
                {card.average ? <p className="mt-1 text-xs font-medium text-violet-700">{card.average}</p> : null}
                {card.note ? <p className="mt-1 text-xs font-medium text-amber-600">{card.note}</p> : null}
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <Link
                  href={`${lienMethodologie}#${card.ancre}`}
                  title={`Comment « ${card.title} » est calculé`}
                  aria-label={`Méthodologie de calcul : ${card.title}`}
                  className="rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                >
                  <HelpCircle className="h-4 w-4" />
                </Link>
                <div className={`rounded-lg p-2 ${card.iconBg}`}>
                  <card.icon className={`h-5 w-5 ${card.iconColor}`} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
