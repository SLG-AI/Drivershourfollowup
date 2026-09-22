import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getLatestRosterPeriod } from "@/lib/utils/roster-period";
import { indexerPhotos, periodesDesPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { effectifReelDuMois, moisEffetSortie, type AbsenceRecord, type EffectifReelMois } from "@/lib/utils/wp-calculations";
import { estFinDeMission, estSortieHorsTurnover } from "@/lib/utils/wp-suspension";
import { analyserTurnover } from "@/lib/utils/wp-turnover";
import { analyserAbsenteisme } from "@/lib/utils/wp-absenteisme";
import { lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { HistoryClient } from "./history-client";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";

interface Props {
  searchParams: Promise<{ year?: string; societes?: string; fonctions?: string; cc?: string; depots?: string; equipes?: string; contrats?: string; employee?: string }>;
}

export default async function HistoryPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const filtres = lireFiltresWorkforce(params);
  const anneeChoisie = params.year ? parseInt(params.year) : null;

  // Roster historisé : on se cale sur la photographie d'effectif la plus récente.
  const rosterPeriode = await getLatestRosterPeriod(supabase);

  const [employeesBruts, absencesBrutes, salaryStatsBruts, photosBrutes, mouvementsBruts, mctBruts, injustifieesBrutes] = await Promise.all([
    fetchAll(rosterPeriode
      ? supabase.from("wp_employees").select("code_salarie, date_entree, date_sortie, vehicle_type, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_departement").eq("mois", rosterPeriode.mois).eq("annee", rosterPeriode.annee)
      : supabase.from("wp_employees").select("code_salarie, date_entree, date_sortie, vehicle_type, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_departement").limit(0)),
    fetchAll(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie, jours_maladie, hrs_maternite, hrs_accident, hrs_raisons_familiales, hrs_conge_accompagnement, heures_theoriques")).then(plafonnerTauxCns),
    fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, etp, hrs_base, hrs_supp")),
    // Toutes les photos de roster (colonnes utiles seulement) : chaque mois se
    // lit dans SA photo. Une photo unique reconstruite par les dates culmine
    // toujours sur son propre mois, et ne connaît ni les partis avant elle ni
    // les embauchés après.
    fetchAll(supabase.from("wp_employees").select("code_salarie, code_employeur, mois, annee, date_entree, date_sortie, est_sortie_temporaire, date_debut_sortie_temporaire, date_fin_sortie_temporaire, description_motif_sortie, type_contrat, taux_occupation, description_service, nom_salarie, description_fonction, centre_cout, description_equipe")),
    // Mouvements constatés par le SIRH (export IN/OUT) : dates et motifs RÉELS
    // des entrées/sorties, là où une photo ne connaît que les sorties prévues.
    fetchAll(supabase.from("wp_mouvements").select("code_salarie, type, motif_sortie, date_sortie, mois, annee")),
    // Onglet Absentéisme : lignes MCT (une par jour) et absences injustifiées
    fetchAll(supabase.from("wp_absences_mct").select("code_salarie, nom_salarie, date_absence, duree_hrs, mois, annee")),
    fetchAll(supabase.from("wp_absences_injustifiees").select("code_salarie, nom_salarie, date_debut, date_fin, duree_hrs, mois, annee")),
  ]);

  // Périmètre des filtres de l'en-tête (fonctions, centres de coût, dépôts,
  // équipes, contrats CDI/CDD, salarié) : les photos sont filtrées sur leurs colonnes, et les
  // autres sources par les codes présents dans au moins une photo filtrée —
  // un salarié hors périmètre n'apporte ni absence, ni sortie, ni Bradford.
  const toutesLesPhotos = photosBrutes.filter((e) => filtres.passe(e));
  const codesPerimetre = new Set(toutesLesPhotos.map((e) => e.code_salarie));
  const dansPerimetre = <T extends { code_salarie: string }>(rows: T[]): T[] =>
    filtres.actifs ? rows.filter((r) => codesPerimetre.has(r.code_salarie)) : rows;
  const employees = dansPerimetre(employeesBruts || []);
  const absences = dansPerimetre(absencesBrutes || []);
  const salaryStats = dansPerimetre(salaryStatsBruts || []);
  const mouvements = dansPerimetre(mouvementsBruts || []);
  const absencesMct = dansPerimetre(mctBruts || []);
  const absencesInjustifiees = dansPerimetre(injustifieesBrutes || []);

  if (!employeesBruts || employeesBruts.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Analyse historique</h1>
          <p className="text-muted-foreground">Tendances sur 2 ans : absentéisme, turnover, départs.</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12">
          <p className="text-lg font-medium">Aucune donnée disponible</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Importez vos fichiers RH historiques pour visualiser les tendances.
          </p>
        </div>
      </div>
    );
  }

  // Années couvertes par des DONNÉES (absences, stats salariales, photos de
  // roster). Les dates d'entrée/sortie des salariés n'en font pas partie :
  // elles étiraient l'analyse de 2001 à 2027 sans aucune donnée derrière.
  const photos = indexerPhotos(toutesLesPhotos);
  const absYears = [...new Set((absences || []).map((a) => Number(a.annee)))].sort();
  const salaryYears = [...new Set((salaryStats || []).map((s) => Number(s.annee)))].sort();
  const photoYears = periodesDesPhotos(photos).map((p) => p.annee);
  const allYears = [...new Set([...absYears, ...salaryYears, ...photoYears])].filter((y) => y > 2000).sort();

  // Effectif constaté d'un mois, lu dans sa photo (mémoïsé : plusieurs
  // sections en ont besoin). Un mois sans photo reconduit la plus récente
  // antérieure, sinon la plus ancienne.
  const absencesTypees: AbsenceRecord[] = (absences || []).map((a) => ({
    code_salarie: a.code_salarie,
    mois: Number(a.mois),
    annee: Number(a.annee),
    pct_absenteisme: Number(a.pct_absenteisme),
    hrs_maladie: Number(a.hrs_maladie),
    hrs_maternite: Number(a.hrs_maternite),
    hrs_accident: Number(a.hrs_accident),
    heures_theoriques: Number(a.heures_theoriques),
  }));
  const reelParMois = new Map<string, EffectifReelMois>();
  const reel = (yr: number, m: number): EffectifReelMois => {
    const cle = `${yr}-${m}`;
    let r = reelParMois.get(cle);
    if (!r) {
      r = effectifReelDuMois(photoPourLeMois(photos, m, yr).lignes, yr, m, absencesTypees);
      reelParMois.set(cle, r);
    }
    return r;
  };
  const aDesAbsences = (yr: number, m: number) => absencesTypees.some((a) => a.annee === yr && a.mois === m);
  // Mois d'une année sur lesquels une moyenne annuelle a un sens : tous pour
  // une année écoulée, jusqu'au mois courant pour l'année en cours.
  const now = new Date();
  const moisCouverts = (yr: number): number[] => {
    const dernier = yr < now.getFullYear() ? 12 : yr === now.getFullYear() ? now.getMonth() + 1 : 0;
    return Array.from({ length: dernier }, (_, i) => i + 1);
  };

  // ============================================================
  // 1. Monthly absenteeism by year (for seasonal overlay)
  // ============================================================
  // Onglet Absentéisme : taux global par mois et par dépôt, scores de Bradford.
  // Calculé ici car la vue d'ensemble s'en sert aussi : la saisonnalité montre
  // le taux GLOBAL (CNS + MCT + injustifiées) et les valeurs suggérées le taux
  // MCT, la grandeur que modélise le paramètre d'absentéisme des scénarios.
  const absenteismeAnalyses = allYears
    .filter((yr) => moisCouverts(yr).length > 0)
    .map((yr) => analyserAbsenteisme(yr, moisCouverts(yr), photos, absences || [], absencesMct || [], absencesInjustifiees || []))
    .filter((an) => an.moisAvecDonnees.length > 0);

  const absenteeismSeries = absenteismeAnalyses.map((an) => ({
    year: an.annee,
    data: Array.from({ length: 12 }, (_, i) => {
      const m = an.parMois.find((x) => x.mois === i + 1);
      return m
        ? { mois: i + 1, global: m.global, cns: m.cns, mct: m.mct, injustifiees: m.injustifiees }
        : { mois: i + 1, global: null, cns: null, mct: null, injustifiees: null };
    }),
  }));

  // ============================================================
  // 2. Absence type breakdown (aggregate across all data)
  // ============================================================
  const absTypeAgg = { maladie: 0, accident: 0, maternite: 0, raisons_fam: 0, accompagnement: 0 };
  (absences || []).forEach((a) => {
    absTypeAgg.maladie += Number(a.hrs_maladie || 0);
    absTypeAgg.accident += Number(a.hrs_accident || 0);
    absTypeAgg.maternite += Number(a.hrs_maternite || 0);
    absTypeAgg.raisons_fam += Number(a.hrs_raisons_familiales || 0);
    absTypeAgg.accompagnement += Number(a.hrs_conge_accompagnement || 0);
  });

  const absTypeData = [
    { type: "Maladie", hours: Math.round(absTypeAgg.maladie) },
    { type: "Accident", hours: Math.round(absTypeAgg.accident) },
    { type: "Maternité", hours: Math.round(absTypeAgg.maternite) },
    { type: "Raisons fam.", hours: Math.round(absTypeAgg.raisons_fam) },
    { type: "Accompagnement", hours: Math.round(absTypeAgg.accompagnement) },
  ].filter((d) => d.hours > 0);

  // ============================================================
  // 3. Turnover by year
  // ============================================================
  // Turnover annuel = départs définitifs HORS FINS DE MISSION (terme des CDD)
  // / effectif moyen, comme le KPI du tableau de bord. Départs et arrivées :
  // l'export IN/OUT s'il couvre l'année (dates et motifs réels), sinon les
  // dates lues photo par photo — une photo ne connaît que les sorties prévues
  // et les embauches encore présentes.
  const mouvementsDe = (yr: number, type: string) =>
    (mouvements || []).filter((mv) => Number(mv.annee) === yr && mv.type === type);
  const turnoverByYear = allYears.map((yr) => {
    const mois = moisCouverts(yr);
    const effectifs = mois.map((m) => reel(yr, m).brut);
    const effectif = effectifs.length > 0 ? effectifs.reduce((a, b) => a + b, 0) / effectifs.length : 0;

    const sirhCouvre = (mouvements || []).some((mv) => Number(mv.annee) === yr);
    const departures = sirhCouvre
      ? mouvementsDe(yr, "sortie").filter((mv) => !estFinDeMission(mv.motif_sortie)).length
      : mois.reduce((sum, m) => {
          return sum + photoPourLeMois(photos, m, yr).lignes.filter((e) => {
            if (!e.date_sortie || estSortieHorsTurnover(e)) return false;
            const effet = moisEffetSortie(e.date_sortie);
            return effet.mois === m && effet.annee === yr;
          }).length;
        }, 0);
    const arrivals = sirhCouvre
      ? mouvementsDe(yr, "entree").length
      : mois.reduce((sum, m) => {
          const debut = `${yr}-${String(m).padStart(2, "0")}-01`;
          const fin = `${yr}-${String(m).padStart(2, "0")}-31`;
          return sum + photoPourLeMois(photos, m, yr).lignes.filter((e) => e.date_entree && e.date_entree >= debut && e.date_entree <= fin).length;
        }, 0);

    const rate = effectif > 0 ? (departures / effectif) * 100 : 0;

    return { year: yr, effectif: Math.round(effectif), departures, arrivals, rate: Math.round(rate * 10) / 10 };
  }).filter((d) => d.effectif > 0);

  // ============================================================
  // 4. Departure motifs breakdown
  // ============================================================
  // Motifs des sorties RÉELLES (export IN/OUT) ; à défaut, sorties datées de
  // la photo la plus récente (qui mêle sorties passées et prévues).
  const motifCounts: Record<string, number> = {};
  const sortiesSirh = (mouvements || []).filter((mv) => mv.type === "sortie");
  if (sortiesSirh.length > 0) {
    sortiesSirh.forEach((mv) => {
      const motif = mv.motif_sortie || "Non spécifié";
      motifCounts[motif] = (motifCounts[motif] || 0) + 1;
    });
  } else {
    (employees || []).forEach((e) => {
      if (!e.date_sortie || !e.description_motif_sortie) return;
      const motif = e.description_motif_sortie;
      motifCounts[motif] = (motifCounts[motif] || 0) + 1;
    });
  }

  const motifData = Object.entries(motifCounts)
    .map(([motif, count]) => ({ motif, count }))
    .sort((a, b) => b.count - a.count);

  // ============================================================
  // 5. Monthly headcount evolution across years
  // ============================================================
  // Un mois sans photo reconduit la plus récente antérieure (les années
  // d'avant l'historisation lisent donc toutes la photo la plus ancienne).
  const headcountByYearMonth = allYears.map((yr) => ({
    year: yr,
    data: Array.from({ length: 12 }, (_, i) => {
      const monthDate = `${yr}-${String(i + 1).padStart(2, "0")}-28`;
      const monthStart = `${yr}-${String(i + 1).padStart(2, "0")}-01`;
      const { lignes } = photoPourLeMois(photos, i + 1, yr);
      const count = lignes.filter((e) => {
        if (!e.date_entree || e.date_entree > monthDate) return false;
        if (e.date_sortie && e.date_sortie < monthStart) return false;
        return true;
      }).length;
      return { mois: i + 1, count };
    }),
  }));

  // ============================================================
  // 6. Suggested defaults for scenarios
  // ============================================================
  // Taux MCT moyen par mois sur les années observées (grandeur du paramètre
  // d'absentéisme des scénarios) ; un mois jamais observé reçoit la moyenne
  // des mois observés (et non 5 % arbitraires, qui tiraient la moyenne annuelle).
  const avgAbsByMonth: Record<number, number> = {};
  const tauxObserves: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const taux = absenteeismSeries
      .map((s) => s.data[m - 1].mct)
      .filter((r): r is number => r !== null);
    if (taux.length > 0) {
      avgAbsByMonth[m] = taux.reduce((a, b) => a + b, 0) / taux.length;
      tauxObserves.push(avgAbsByMonth[m]);
    }
  }
  const moyenneObservee = tauxObserves.length > 0 ? tauxObserves.reduce((a, b) => a + b, 0) / tauxObserves.length : 5;
  for (let m = 1; m <= 12; m++) {
    if (avgAbsByMonth[m] === undefined) avgAbsByMonth[m] = moyenneObservee;
  }

  // Onglet Turnover : volontaire / involontaire, par mois, motif et dépôt
  const turnoverAnalyses = allYears
    .filter((yr) => moisCouverts(yr).length > 0)
    .map((yr) => analyserTurnover(yr, moisCouverts(yr), photos, mouvements || []));

  const avgTurnover = turnoverByYear.length > 0
    ? turnoverByYear.reduce((sum, t) => sum + t.rate, 0) / turnoverByYear.length
    : 5;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Analyse historique</h1>
        <p className="text-muted-foreground">
          Tendances sur {allYears.length} année(s) : {allYears[0]}–{allYears[allYears.length - 1]}
          {filtres.actifs && <> · périmètre filtré ({codesPerimetre.size} salarié{codesPerimetre.size > 1 ? "s" : ""})</>}
        </p>
      </div>
      <HistoryClient
        absenteeismSeries={absenteeismSeries}
        absTypeData={absTypeData}
        turnoverByYear={turnoverByYear}
        motifData={motifData}
        headcountByYearMonth={headcountByYearMonth}
        suggestedAbsenteeism={avgAbsByMonth}
        suggestedTurnover={Math.round(avgTurnover * 10) / 10}
        years={allYears}
        turnoverAnalyses={turnoverAnalyses}
        absenteismeAnalyses={absenteismeAnalyses}
        anneeChoisie={anneeChoisie}
      />
    </div>
  );
}
