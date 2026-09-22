/**
 * Méthodologie : comment chaque indicateur Workforce est calculé.
 *
 * La page est HYBRIDE : à côté de chaque définition, elle affiche le calcul
 * réellement effectué sur le mois et le périmètre choisis dans la barre
 * d'en-tête — les mêmes que le tableau de bord. Un chiffre contesté se
 * réconcilie donc ici, opérande par opérande, sans ouvrir le code.
 *
 * Les chiffres viennent des mêmes fonctions que le tableau de bord
 * (lib/utils/wp-paliers.ts, wp-effectif-moyen.ts, wp-movements.ts) : les deux
 * pages ne peuvent pas diverger.
 */

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { listRosterPeriods, resolveRosterPeriod } from "@/lib/utils/roster-period";
import { lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { computeRosterMovements, reclassifierSortiesTemporaires } from "@/lib/utils/wp-movements";
import { computeEffectifMoyen } from "@/lib/utils/wp-effectif-moyen";
import { estFinDeMission, estSortieHorsTurnover } from "@/lib/utils/wp-suspension";
import { calculerPaliers, etpDe, injustifieesDuPerimetre, type SalariePaliers } from "@/lib/utils/wp-paliers";
import { horsWeekEnd, lastDayOfMonth, moisEffetSortie } from "@/lib/utils/wp-calculations";
import { MethodologieClient, type DonneesMethodologie } from "@/components/workforce/methodologie-client";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import { calculerCoefficientCharges, calculerCoutsPaliers, construireSourceSalaires, realiseDuMois, type SalarieCout } from "@/lib/utils/wp-couts";

interface Props {
  searchParams: Promise<{
    year?: string;
    month?: string;
    fonctions?: string;
    cc?: string;
    depots?: string;
    equipes?: string;
    contrats?: string;
    societes?: string;
    employee?: string;
  }>;
}

export default async function WorkforceMethodologiePage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const now = new Date();
  const selectedYear = params.year ? parseInt(params.year) : now.getFullYear();
  const selectedMonth = params.month ? parseInt(params.month) : now.getMonth() + 1;
  const filtres = lireFiltresWorkforce(params);
  const refDate = lastDayOfMonth(selectedYear, selectedMonth);

  // Périmètre actif, pour que le lecteur sache à quoi se rapportent les chiffres
  const perimetre: { libelle: string; valeurs: string[] }[] = [
    { libelle: "Sociétés", valeurs: filtres.societes },
    { libelle: "Fonctions", valeurs: filtres.fonctions },
    { libelle: "Centres de coût", valeurs: filtres.cc },
    { libelle: "Dépôts", valeurs: filtres.depots },
    { libelle: "Équipes", valeurs: filtres.equipes },
    { libelle: "Contrats", valeurs: filtres.contrats },
    { libelle: "Salarié", valeurs: filtres.employee ? [filtres.employee] : [] },
  ].filter((f) => f.valeurs.length > 0);

  // Photographie du mois : un export SIRH par mois, on ne lit QUE celle-là.
  const { periode: rosterPeriode, exacte: rosterPeriodeExacte } = await resolveRosterPeriod(
    supabase,
    selectedMonth,
    selectedYear
  );

  if (!rosterPeriode) {
    return (
      <MethodologieClient
        donnees={null}
        perimetre={perimetre}
        annee={selectedYear}
        mois={selectedMonth}
      />
    );
  }

  const moisPrecedent =
    selectedMonth === 1
      ? { mois: 12, annee: selectedYear - 1 }
      : { mois: selectedMonth - 1, annee: selectedYear };
  const periodesRoster = await listRosterPeriods(supabase);
  const moisPrecedentDisponible =
    rosterPeriodeExacte &&
    periodesRoster.some((p) => p.mois === moisPrecedent.mois && p.annee === moisPrecedent.annee);

  const [employees, employeesPrec, absences, absencesMct, absencesInj, mouvementsSirh, salaryStats] =
    await Promise.all([
      fetchAll(
        supabase.from("wp_employees").select("*").eq("mois", rosterPeriode.mois).eq("annee", rosterPeriode.annee)
      ),
      moisPrecedentDisponible
        ? fetchAll(
            supabase.from("wp_employees").select("*").eq("mois", moisPrecedent.mois).eq("annee", moisPrecedent.annee)
          )
        : Promise.resolve([] as Record<string, unknown>[]),
      fetchAll(supabase.from("wp_absences").select("*").eq("annee", selectedYear)).then(plafonnerTauxCns),
      fetchAll(supabase.from("wp_absences_mct").select("*").eq("annee", selectedYear)),
      fetchAll(supabase.from("wp_absences_injustifiees").select("*").eq("annee", selectedYear)),
      fetchAll(
        supabase
          .from("wp_mouvements")
          .select("code_salarie, type, date_sortie, motif_sortie, mois, annee")
          .in("annee", Array.from(new Set([selectedYear, moisPrecedent.annee])))
          .in("type", ["sortie", "sortie_temporaire"])
      ),
      fetchAll(supabase.from("wp_salary_stats").select("code_salarie, date_sortie, mois, annee, centre_cout, total_brut, brut_base, supplements, cout_total_secu, charges_patronales").eq("annee", selectedYear)),
    ]);
  // Coûts : photo de référence salariale (dernière avec brut indice) et dernier
  // mois de statistiques salariales avec montants, comme sur la page Coûts.
  const [periodeReference, dernierMoisStats] = await Promise.all([
    supabase.from("wp_employees").select("mois, annee").gt("brut_indice", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("wp_salary_stats").select("mois, annee").gt("charges_patronales", 0).order("annee", { ascending: false }).order("mois", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const periodeRef = periodeReference.data ? { mois: Number(periodeReference.data.mois), annee: Number(periodeReference.data.annee) } : null;
  const [photoReference, statsCoefficient] = await Promise.all([
    periodeRef
      ? fetchAll(supabase.from("wp_employees").select("code_salarie, brut_indice, taux_occupation").eq("mois", periodeRef.mois).eq("annee", periodeRef.annee))
      : Promise.resolve(null),
    dernierMoisStats.data && Number(dernierMoisStats.data.annee) !== selectedYear
      ? fetchAll(supabase.from("wp_salary_stats").select("code_salarie, mois, annee, centre_cout, total_brut, charges_patronales").eq("mois", dernierMoisStats.data.mois).eq("annee", dernierMoisStats.data.annee))
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);

  // Mêmes filtres et même reclassification que le tableau de bord, sinon les
  // chiffres de cette page ne seraient pas ceux qu'on cherche à expliquer.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const passe = (e: any) => filtres.passe(e);
  const roster = employees.filter(passe);
  const rosterPrec = employeesPrec.filter(passe);
  const codesRoster = new Set(roster.map((e) => e.code_salarie));

  const codesAvecMaladieCns = new Set(
    absences.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => a.code_salarie)
  );
  reclassifierSortiesTemporaires(roster, codesAvecMaladieCns);
  reclassifierSortiesTemporaires(rosterPrec, codesAvecMaladieCns);

  // ============================================================
  // La chaîne des paliers, avec toutes ses opérandes
  // ============================================================
  const cns = absences.filter((a) => codesRoster.has(a.code_salarie));
  const mct = horsWeekEnd(absencesMct);
  const paliers = calculerPaliers(
    roster as unknown as SalariePaliers[],
    cns,
    mct,
    injustifieesDuPerimetre(absencesInj, filtres.actifs, codesRoster),
    selectedMonth,
    selectedYear
  );

  // Nombre de lignes MCT écartées parce qu'elles tombent un week-end : rend
  // visible une règle qui, sinon, se lit seulement dans le code.
  const mctDuMoisBrut = absencesMct.filter((a) => Number(a.mois) === selectedMonth);
  const mctDuMoisRetenu = mct.filter((a) => Number(a.mois) === selectedMonth);
  const mctLignesWeekEnd = mctDuMoisBrut.length - mctDuMoisRetenu.length;
  const mctHeuresWeekEnd =
    mctDuMoisBrut.reduce((s, a) => s + Number(a.duree_hrs || 0), 0) -
    mctDuMoisRetenu.reduce((s, a) => s + Number(a.duree_hrs || 0), 0);

  // ============================================================
  // Mouvements et turnover mensuel : mêmes sources que le tableau de bord
  // ============================================================
  const estSurLaPeriode = (mois: unknown, annee: unknown) =>
    (Number(mois) === selectedMonth && Number(annee) === selectedYear) ||
    (Number(mois) === moisPrecedent.mois && Number(annee) === moisPrecedent.annee);
  const sortiesConstatees = new Map<string, { date: string; motif?: string }>();
  mouvementsSirh
    .filter((mv) => mv.type === "sortie" && mv.date_sortie && estSurLaPeriode(mv.mois, mv.annee))
    .forEach((mv) => {
      const d = String(mv.date_sortie).slice(0, 10);
      const prev = sortiesConstatees.get(mv.code_salarie);
      if (!prev || d > prev.date) sortiesConstatees.set(mv.code_salarie, { date: d, motif: mv.motif_sortie || undefined });
    });
  salaryStats
    .filter((st) => st.date_sortie && estSurLaPeriode(st.mois, st.annee) && !sortiesConstatees.has(st.code_salarie))
    .forEach((st) => {
      const d = String(st.date_sortie).slice(0, 10);
      const prev = sortiesConstatees.get(st.code_salarie);
      if (!prev || d > prev.date) sortiesConstatees.set(st.code_salarie, { date: d });
    });

  const mouvements = moisPrecedentDisponible
    ? computeRosterMovements(rosterPrec, roster, selectedMonth, selectedYear, sortiesConstatees, { prev: employeesPrec, curr: employees })
    : null;

  // Hors turnover : les seules fins de mission (voir estSortieHorsTurnover)
  const estFinDeCdd = (motif: string | null | undefined) => estFinDeMission(motif);

  let sortiesMoisEtp: number;
  let sortiesMoisHorsTurnoverEtp = 0;
  if (mouvements) {
    sortiesMoisEtp = mouvements.sortiesDefinitives
      .filter((i) => !estFinDeCdd(i.motif))
      .reduce((sum, i) => sum + i.etp, 0);
    sortiesMoisHorsTurnoverEtp = mouvements.sortiesDefinitives
      .filter((i) => estFinDeCdd(i.motif))
      .reduce((sum, i) => sum + i.etp, 0);
  } else {
    sortiesMoisEtp = roster
      .filter((e) => {
        if (!e.date_sortie || estSortieHorsTurnover(e)) return false;
        const effet = moisEffetSortie(e.date_sortie);
        return effet.mois === selectedMonth && effet.annee === selectedYear;
      })
      .reduce((sum, e) => sum + etpDe(e as unknown as SalariePaliers), 0);
  }

  // ============================================================
  // Effectif MOYEN du mois : l'autre lecture du même mois
  // ============================================================
  const sortisHorsPhoto = (mouvements?.sortiesDefinitives ?? [])
    .filter((i) => i.date && !codesRoster.has(i.code_salarie))
    .map((i) => ({ date_sortie: i.date!, taux_occupation: i.etp * 100 }));
  const effectifMoyen = computeEffectifMoyen(
    roster as unknown as Parameters<typeof computeEffectifMoyen>[0],
    sortisHorsPhoto,
    selectedMonth,
    selectedYear
  );

  const tauxTurnoverMensuel = effectifMoyen.brut > 0 ? (sortiesMoisEtp / effectifMoyen.brut) * 100 : 0;

  // ============================================================
  // Coûts : la même chaîne en euros (page Coûts)
  // ============================================================
  const coefficient = calculerCoefficientCharges([...salaryStats, ...statsCoefficient], filtres.actifs ? codesRoster : undefined);
  const sourceSalaires = construireSourceSalaires(roster as unknown as SalarieCout[], photoReference as SalarieCout[] | null);
  const coutsPaliers = calculerCoutsPaliers(
    roster as unknown as SalarieCout[],
    cns,
    mct,
    injustifieesDuPerimetre(absencesInj, filtres.actifs, codesRoster),
    selectedMonth,
    selectedYear,
    { coef: coefficient.coef, source: sourceSalaires }
  );
  const realise = realiseDuMois(salaryStats, selectedMonth, selectedYear, filtres.actifs ? codesRoster : undefined);

  const donnees: DonneesMethodologie = {
    refDate,
    paliers,
    perimetreComplet: perimetre.length === 0,
    rosterPeriode: { mois: rosterPeriode.mois, annee: rosterPeriode.annee, exacte: rosterPeriodeExacte },
    moisPrecedentDisponible,
    mct: { lignesWeekEnd: mctLignesWeekEnd, heuresWeekEnd: Math.round(mctHeuresWeekEnd * 10) / 10 },
    effectifMoyen: {
      brut: effectifMoyen.brut,
      suspendus: effectifMoyen.suspendus,
      net: effectifMoyen.net,
      jours: effectifMoyen.jours,
    },
    turnover: {
      sortiesEtp: sortiesMoisEtp,
      sortiesHorsTurnoverEtp: sortiesMoisHorsTurnoverEtp,
      tauxMensuel: tauxTurnoverMensuel,
      tauxAnnualise: tauxTurnoverMensuel * 12,
      sourceMouvements: mouvements !== null,
    },
    couts: {
      paliers: coutsPaliers,
      coefficient: coefficient.coef,
      coefficientSource: coefficient.source
        ? { mois: coefficient.source.mois, annee: coefficient.source.annee, n: coefficient.source.n, brut: coefficient.source.brut, employeur: coefficient.source.employeur, perimetre: coefficient.source.perimetre }
        : null,
      salairesReportes: sourceSalaires.reporte,
      periodeReference: periodeRef,
      aucunSalaire: photoReference == null,
      realise: { employeur: realise.employeur, brut: realise.brut, n: realise.n, mesure: realise.mesure },
    },
  };

  return (
    <MethodologieClient
      donnees={donnees}
      perimetre={perimetre}
      annee={selectedYear}
      mois={selectedMonth}
    />
  );
}
