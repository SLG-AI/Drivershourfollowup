import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { rangPeriode, resolveRosterPeriod } from "@/lib/utils/roster-period";
import { ajouterPhotoSiAbsente, indexerPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { AUCUNE_VALEUR, lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { computeRosterMovements, reclassifierSortiesTemporaires, sortiesConstateesSur } from "@/lib/utils/wp-movements";
import { construireCourbeEffectifs, type MoisAnnee } from "@/lib/utils/wp-courbe-effectifs";
import { construireCourbeCouts } from "@/lib/utils/wp-courbe-couts";
import { calculerCoefficientCharges, construireSourceSalaires, type SalarieCout } from "@/lib/utils/wp-couts";
import { estActifLe } from "@/lib/utils/wp-effectif-moyen";
import { etpDe } from "@/lib/utils/wp-paliers";
import { horsWeekEnd, lastDayOfMonth } from "@/lib/utils/wp-calculations";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import { formatEuros } from "@/lib/utils/format";
import { HeadcountEvolutionChart } from "@/components/workforce/headcount-evolution-chart";
import { CostKpiCards, type CoutsStats } from "@/components/workforce/cost-kpi-cards";
import { pasAxeEuros, SERIES_COUTS } from "@/components/workforce/cost-series";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Upload } from "lucide-react";

const MONTH_LABELS: Record<number, string> = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril",
  5: "Mai", 6: "Juin", 7: "Juillet", 8: "Août",
  9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

interface Props {
  searchParams: Promise<{ year?: string; month?: string; fonctions?: string; cc?: string; depots?: string; equipes?: string; contrats?: string; employee?: string }>;
}

/**
 * Page Coûts : la courbe d'évolution des effectifs, en euros. Même chargement
 * et mêmes photos par mois que le tableau de bord ; les paliers ETP viennent
 * de `construireCourbeEffectifs`, leur valorisation de `construireCourbeCouts`.
 */
export default async function WorkforceCoutsPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const selectedYear = params.year ? parseInt(params.year) : now.getFullYear();
  const selectedMonth = params.month ? parseInt(params.month) : now.getMonth() + 1;
  const filtres = lireFiltresWorkforce(params);
  const refDate = lastDayOfMonth(selectedYear, selectedMonth);
  const moisLabel = `${MONTH_LABELS[selectedMonth]} ${selectedYear}`;

  const qsMethodologie = new URLSearchParams();
  (["year", "month", "fonctions", "cc", "depots", "equipes", "contrats", "employee"] as const).forEach((k) => {
    const v = params[k];
    if (v) qsMethodologie.set(k, v);
  });
  const lienMethodologie = `/workforce/methodologie${qsMethodologie.size ? `?${qsMethodologie}` : ""}`;

  const { count: employeeCount } = await supabase.from("wp_employees").select("*", { count: "exact", head: true });
  if (!employeeCount) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Coûts</h1>
          <p className="text-muted-foreground">Masse salariale et projection des coûts.</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">Importez vos fichiers RH pour commencer.</p>
          <Button asChild className="mt-4">
            <Link href="/workforce/import"><Upload className="mr-2 h-4 w-4" />Importer des données</Link>
          </Button>
        </div>
      </div>
    );
  }

  const { periode: rosterPeriode, exacte: rosterPeriodeExacte } = await resolveRosterPeriod(supabase, selectedMonth, selectedYear);
  const anneeFuture = selectedYear > now.getFullYear();
  const colonnesPhoto = "code_salarie, mois, annee, date_entree, date_sortie, date_debut_sortie_temporaire, date_fin_sortie_temporaire, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_fonction, centre_cout, description_service, description_equipe, type_contrat, brut_indice";

  const [employees, absences, salaryStats, absencesMct, absencesInjustifiees, mouvementsSirh, photosAnnee, absencesAnneePrec, mctAnneePrec, injAnneePrec, periodeReference, dernierMoisStats] = await Promise.all([
    fetchAll(supabase.from("wp_employees").select("*").eq("mois", rosterPeriode?.mois ?? -1).eq("annee", rosterPeriode?.annee ?? -1)),
    fetchAll(supabase.from("wp_absences").select("*").eq("annee", selectedYear)).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, date_sortie, total_brut, brut_base, supplements, cout_total_secu").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_mct").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_absences_injustifiees").select("*").eq("annee", selectedYear)),
    fetchAll(supabase.from("wp_mouvements").select("code_salarie, type, date_sortie, motif_sortie, mois, annee").in("annee", [selectedYear, selectedYear - 1]).in("type", ["sortie", "sortie_temporaire"])),
    // Toutes les photos de l'année, AVEC le brut indice : chaque mois se lit dans sa photo
    fetchAll(supabase.from("wp_employees").select(colonnesPhoto).eq("annee", selectedYear)),
    anneeFuture ? fetchAll(supabase.from("wp_absences").select("code_salarie, mois, pct_absenteisme, hrs_maladie").eq("annee", selectedYear - 1)).then(plafonnerTauxCns) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_mct").select("code_salarie, mois, date_absence, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
    anneeFuture ? fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, mois, duree_hrs").eq("annee", selectedYear - 1)) : Promise.resolve([] as Record<string, unknown>[]),
    // Photo de référence salariale : la plus récente qui porte un brut indice
    supabase.from("wp_employees").select("mois, annee").gt("brut_indice", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
    // Dernier mois de statistiques salariales avec montants, pour le coefficient de charges
    supabase.from("wp_salary_stats").select("mois, annee").gt("total_brut", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const periodeRef: MoisAnnee | null = periodeReference.data ? { mois: Number(periodeReference.data.mois), annee: Number(periodeReference.data.annee) } : null;
  const [photoReference, statsCoefficient] = await Promise.all([
    periodeRef
      ? fetchAll(supabase.from("wp_employees").select(colonnesPhoto).eq("mois", periodeRef.mois).eq("annee", periodeRef.annee))
      : Promise.resolve(null),
    dernierMoisStats.data && Number(dernierMoisStats.data.annee) !== selectedYear
      ? fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, total_brut, cout_total_secu").eq("mois", dernierMoisStats.data.mois).eq("annee", dernierMoisStats.data.annee))
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  // ---- Filtres, reclassification, photos par mois : mêmes règles que le tableau de bord
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passeLesFiltres = (e: any) => filtres.passe(e);
  const allEmployees = employees.filter(passeLesFiltres);
  const employeeCodes = new Set<string>(allEmployees.map((e) => String(e.code_salarie)));
  const allAbsences = absences.filter((a) => employeeCodes.has(String(a.code_salarie)));
  const mctHorsWeekEnd = horsWeekEnd(absencesMct);
  const codesMaladieAnneePrec = anneeFuture
    ? absencesAnneePrec.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie))
    : [];
  reclassifierSortiesTemporaires(allEmployees, new Set([
    ...allAbsences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie)),
    ...codesMaladieAnneePrec,
  ]));

  const photosParRang = indexerPhotos(photosAnnee);
  ajouterPhotoSiAbsente(photosParRang, rosterPeriode, employees);
  const codesAvecMaladieCnsAnnee = new Set([
    ...absences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie)),
    ...codesMaladieAnneePrec,
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photosPreparees = new Map<number, any[]>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const photoDuMoisDe = (m: number, annee: number): any[] => {
    const { lignes, periode } = photoPourLeMois(photosParRang, m, annee);
    if (!periode) return allEmployees;
    const r = rangPeriode(periode);
    let prete = photosPreparees.get(r);
    if (!prete) {
      prete = reclassifierSortiesTemporaires(lignes.filter(passeLesFiltres), codesAvecMaladieCnsAnnee);
      photosPreparees.set(r, prete);
    }
    return prete;
  };
  const photoDuMois = (m: number) => photoDuMoisDe(m, selectedYear);

  // ---- Les douze points en ETP (calcul partagé avec le tableau de bord)
  const courbe = construireCourbeEffectifs({
    selectedYear,
    selectedMonth,
    now,
    anneeFuture,
    filtresActifs: filtres.actifs,
    targetTotal: 0,
    photoDuMoisDe,
    photoExacte: (m, annee) => photoPourLeMois(photosParRang, m, annee).exacte,
    sortisHorsPhotoPour: (m) => {
      const precM: MoisAnnee = m === 1 ? { mois: 12, annee: selectedYear - 1 } : { mois: m - 1, annee: selectedYear };
      if (!photoPourLeMois(photosParRang, m, selectedYear).exacte || !photoPourLeMois(photosParRang, precM.mois, precM.annee).exacte) return [];
      const codesPhotoM = new Set(photoDuMois(m).map((e) => e.code_salarie));
      return computeRosterMovements(
        photoDuMoisDe(precM.mois, precM.annee), photoDuMois(m), m, selectedYear,
        sortiesConstateesSur(mouvementsSirh, salaryStats, m, selectedYear, precM)
      ).sortiesDefinitives
        .filter((i) => i.date && !codesPhotoM.has(i.code_salarie))
        .map((i) => ({ date_sortie: i.date!, taux_occupation: i.etp * 100 }));
    },
    absences,
    mctHorsWeekEnd,
    absencesInjustifiees,
    absencesAnneePrec,
    mctAnneePrec,
    injAnneePrec,
  });

  // ---- Valorisation
  const coefficient = calculerCoefficientCharges([...salaryStats, ...statsCoefficient], filtres.actifs ? employeeCodes : undefined);
  const courbeCouts = construireCourbeCouts({
    headcountData: courbe.headcountData,
    selectedYear,
    filtresActifs: filtres.actifs,
    photoDuMois,
    photoReference: photoReference as SalarieCout[] | null,
    coef: coefficient.coef,
    absences,
    mctHorsWeekEnd,
    absencesInjustifiees,
    stats: salaryStats,
  });
  const points = courbeCouts.map((p) => p.point);
  const duMois = courbeCouts[selectedMonth - 1];
  const aucunSalaire = photoReference == null;

  // ---- Cartes KPI du mois affiché
  const sourceDuMois = construireSourceSalaires(photoDuMois(selectedMonth), photoReference as SalarieCout[] | null);
  const actifsDuMois = (photoDuMois(selectedMonth) as SalarieCout[]).filter((e) => estActifLe(e, refDate));
  const etpSousContrat = actifsDuMois.reduce((s, e) => s + etpDe(e), 0);
  const moyenne = duMois.point.moyenne;
  const stats: CoutsStats = {
    sous_contrat: duMois.couts.sousContrat,
    cout_suspendu: duMois.couts.coutSuspendu,
    apres_suspension: duMois.couts.apresSuspension,
    cout_perdu_cns: duMois.point.effectif_reel != null ? duMois.couts.apresSuspension - duMois.point.effectif_reel : duMois.couts.coutPerduCns,
    cout_perdu_injustifiees: duMois.point.effectif_reel != null && duMois.point.effectif_apres_injustifiees != null ? duMois.point.effectif_reel - duMois.point.effectif_apres_injustifiees : duMois.couts.coutPerduInjustifiees,
    paye: duMois.point.effectif_apres_injustifiees,
    cout_perdu_mct: duMois.point.effectif_apres_injustifiees != null && duMois.point.effectif_apres_mct != null ? duMois.point.effectif_apres_injustifiees - duMois.point.effectif_apres_mct : undefined,
    disponible: duMois.point.effectif_apres_mct,
    sous_contrat_moyen: moyenne?.effectif_brut,
    apres_suspension_moyen: moyenne?.effectif_net,
    paye_moyen: moyenne?.effectif_apres_injustifiees,
    realise: duMois.realise.mesure ? duMois.realise.employeur : null,
    realise_lignes: duMois.realise.n,
    coefficient: coefficient.coef,
    coefficient_source: coefficient.source
      ? `Calculé sur ${MONTH_LABELS[coefficient.source.mois]} ${coefficient.source.annee} (${coefficient.source.n.toLocaleString("fr-FR")} lignes, ${coefficient.source.perimetre === "filtre" ? "périmètre filtré" : "toute l'entreprise"})`
      : null,
    cout_moyen_etp: duMois.couts.coutMoyenEtp,
    brut_plein_temps_moyen: coefficient.coef > 0 ? duMois.couts.coutMoyenEtp / coefficient.coef : 0,
    etp_sous_contrat: etpSousContrat,
    masse_annuelle: points.reduce((s, p) => s + p.effectif_brut, 0),
    mois_reportes: points.filter((p) => p.reporte?.brut).length,
    codes_sans_salaire: duMois.couts.reporte.codesManquants,
    mois_label: moisLabel,
    reference_label: sourceDuMois.reporte && periodeRef ? `${MONTH_LABELS[periodeRef.mois]} ${periodeRef.annee}` : null,
  };

  // ---- Coût moyen par cost center du mois affiché (aide à lire les repli des scénarios)
  const parCostCenter = new Map<string, { n: number; etp: number; brutPleinTemps: number; avecBrut: number; cout: number }>();
  actifsDuMois.forEach((e) => {
    const cc = e.centre_cout || "(sans cost center)";
    const ligne = parCostCenter.get(cc) ?? { n: 0, etp: 0, brutPleinTemps: 0, avecBrut: 0, cout: 0 };
    const brut = sourceDuMois.brutDe(e.code_salarie);
    ligne.n += 1;
    ligne.etp += etpDe(e);
    if (brut != null) {
      ligne.avecBrut += 1;
      ligne.brutPleinTemps += brut;
      ligne.cout += brut * etpDe(e) * coefficient.coef;
    } else {
      ligne.cout += duMois.couts.coutMoyenEtp * etpDe(e);
    }
    parCostCenter.set(cc, ligne);
  });
  const lignesCostCenter = [...parCostCenter.entries()]
    .map(([cc, l]) => ({ cc, ...l, brutMoyen: l.avecBrut > 0 ? l.brutPleinTemps / l.avecBrut : null, coutEtp: l.etp > 0 ? l.cout / l.etp : null }))
    .sort((a, b) => b.cout - a.cout);

  const maxValeur = Math.max(0, ...points.map((p) => p.effectif_brut));
  const filtresDesc = [
    filtres.fonctions.length > 0 ? `${filtres.fonctions.length} fonction(s)` : null,
    filtres.cc.length > 0 ? `${filtres.cc.length} cost center(s)` : null,
    filtres.depots.length > 0 ? `${filtres.depots.length} dépôt(s)` : null,
    filtres.contrats.length > 0 ? (filtres.contrats[0] === AUCUNE_VALEUR ? "aucun contrat" : filtres.contrats.join(" + ")) : null,
    filtres.employee ? `salarié ${filtres.employee}` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Coûts</h1>
        <p className="text-muted-foreground">
          Masse salariale employeur — {moisLabel}
          {filtresDesc.map((f) => ` — ${f}`).join("")}
        </p>
      </div>

      {!rosterPeriodeExacte && rosterPeriode && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun roster n&apos;a été importé pour {moisLabel}. Les effectifs proviennent du roster de{" "}
          <strong>{MONTH_LABELS[rosterPeriode.mois]} {rosterPeriode.annee}</strong>.
        </div>
      )}
      {aucunSalaire ? (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          Aucun roster importé ne porte de salaire (colonne « Brut indice » vide) : les coûts contractuels ne peuvent pas être calculés.
          Importez un roster avec salaires pour activer cette page.
        </div>
      ) : (
        sourceDuMois.reporte && periodeRef && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Le roster de {moisLabel} ne porte pas de salaire : les bruts sont lus dans celui de{" "}
            <strong>{MONTH_LABELS[periodeRef.mois]} {periodeRef.annee}</strong>, la dernière photo qui en porte. Les coûts de ce mois sont donc reportés (pointillé).
          </div>
        )
      )}
      {!coefficient.source && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Aucun mois de statistiques salariales ne porte de montants : le coefficient de charges patronales est la valeur par défaut ({coefficient.coef.toLocaleString("fr-FR", { minimumFractionDigits: 2 })}).
          Importez des « Statistiques rapides » avec salaires pour le calculer sur le réalisé.
        </div>
      )}

      {!aucunSalaire && <CostKpiCards stats={stats} lienMethodologie={lienMethodologie} />}

      {!aucunSalaire && (
        <HeadcountEvolutionChart
          data={points}
          title="Évolution des coûts"
          series={SERIES_COUTS}
          unite="euros"
          axeStep={pasAxeEuros(maxValeur)}
          brushDataKey="effectif_brut"
          libelleVide="Importez un roster avec salaires pour visualiser l'évolution des coûts."
        />
      )}

      {!aucunSalaire && lignesCostCenter.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coût employeur par cost center — {moisLabel}</CardTitle>
            <CardDescription>
              Salariés sous contrat en fin de mois. Coût = brut plein temps × taux d&apos;occupation × coefficient {coefficient.coef.toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ; un salarié sans brut est compté au coût moyen par ETP du périmètre.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cost center</TableHead>
                  <TableHead className="text-xs text-right">Salariés</TableHead>
                  <TableHead className="text-xs text-right">ETP</TableHead>
                  <TableHead className="text-xs text-right">Brut plein temps moyen</TableHead>
                  <TableHead className="text-xs text-right">Coût par ETP</TableHead>
                  <TableHead className="text-xs text-right">Coût sous contrat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lignesCostCenter.map((l) => (
                  <TableRow key={l.cc}>
                    <TableCell className="text-sm font-medium">{l.cc}</TableCell>
                    <TableCell className="text-sm text-right">{l.n.toLocaleString("fr-FR")}{l.avecBrut < l.n ? <span className="ml-1 text-xs text-amber-600">({l.n - l.avecBrut} sans brut)</span> : null}</TableCell>
                    <TableCell className="text-sm text-right">{l.etp.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</TableCell>
                    <TableCell className="text-sm text-right">{l.brutMoyen != null ? formatEuros(l.brutMoyen) : "—"}</TableCell>
                    <TableCell className="text-sm text-right">{l.coutEtp != null ? formatEuros(l.coutEtp) : "—"}</TableCell>
                    <TableCell className="text-sm text-right font-medium">{formatEuros(l.cout)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
