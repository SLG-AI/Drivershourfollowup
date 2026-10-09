import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { getLatestRosterPeriod, rangPeriode } from "@/lib/utils/roster-period";
import { ajouterPhotoSiAbsente, indexerPhotos, photoPourLeMois } from "@/lib/utils/roster-photos";
import { lireFiltresWorkforce } from "@/lib/utils/wp-filtres";
import { computeRosterMovements, sortiesConstateesSur } from "@/lib/utils/wp-movements";
import { reclassifierSortiesTemporaires } from "@/lib/utils/wp-suspension";
import { plafonnerTauxCns } from "@/lib/utils/wp-taux-cns";
import { moisCongesComplets } from "@/lib/utils/wp-conges";
import {
  CONGES_POOL_ANNUEL,
  calculerEffectifJournalier,
  hypothesesDuScenario,
  listerJour,
  tauxMesuresParMois,
  tauxRepris,
  tauxScenarioDuMois,
  type EntreesEffectifJournalier,
  type PersonneEffectif,
} from "@/lib/utils/wp-effectif-journalier";
import { EffectifJournalierClient } from "@/components/workforce/effectif-journalier-client";

interface Props {
  searchParams: Promise<{
    debut?: string; fin?: string; scenario?: string; jour?: string;
    societes?: string; fonctions?: string; cc?: string; depots?: string; equipes?: string; contrats?: string; employee?: string;
  }>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const decalerJours = (date: string, jours: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + jours); return iso(d); };
const decalerMois = (date: string, mois: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + mois); return iso(d); };
const premierDuMois = (date: string) => `${date.slice(0, 7)}-01`;
const PLAGE_MAX_JOURS = 366;

const COLONNES_PHOTO = "code_salarie, nom_salarie, code_employeur, mois, annee, date_entree, date_sortie, date_debut_sortie_temporaire, date_fin_sortie_temporaire, taux_occupation, est_sortie_temporaire, description_motif_sortie, description_fonction, centre_cout, description_service, description_equipe, type_contrat";

type Ligne = Record<string, unknown>;

export default async function EffectifJournalierPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const filtres = lireFiltresWorkforce(params);

  // ---- Plage : aujourd'hui → +3 mois par défaut, bornée à un an
  const aujourdhui = iso(new Date());
  const debut = params.debut && ISO.test(params.debut) ? params.debut : aujourdhui;
  let fin = params.fin && ISO.test(params.fin) && params.fin >= debut ? params.fin : decalerJours(decalerMois(debut, 3), -1);
  if (fin > decalerJours(debut, PLAGE_MAX_JOURS - 1)) fin = decalerJours(debut, PLAGE_MAX_JOURS - 1);
  const jourChoisi = params.jour && ISO.test(params.jour) && params.jour >= debut && params.jour <= fin ? params.jour : null;

  // ---- Historique : 12 mois avant la plage (ou avant aujourd'hui) pour mesurer les taux
  const debutHistorique = premierDuMois(decalerMois(debut < aujourdhui ? debut : aujourdhui, -12));
  // L'année du mois précédant l'historique suffit (photo précédente d'un mois de janvier)
  const anneeMin = Number(decalerMois(debutHistorique, -1).slice(0, 4));
  const anneeMax = Number(fin.slice(0, 4));
  const annees = Array.from({ length: anneeMax - anneeMin + 1 }, (_, i) => anneeMin + i);

  const periodeRecente = await getLatestRosterPeriod(supabase);
  const scenarioId = params.scenario || null;

  const [photos, photoRecenteHorsPlage, mouvements, statsSalariales, cns, mct, injustifiees, scenarios, scParams, scConges, scTurnover, scArrivees, scSortiesTemp, scDeparts, conges, importsMct] = await Promise.all([
    fetchAll<Ligne>(supabase.from("wp_employees").select(COLONNES_PHOTO).in("annee", annees).order("id")),
    periodeRecente && !annees.includes(periodeRecente.annee)
      ? fetchAll<Ligne>(supabase.from("wp_employees").select(COLONNES_PHOTO).eq("mois", periodeRecente.mois).eq("annee", periodeRecente.annee).order("id"))
      : Promise.resolve([] as Ligne[]),
    fetchAll<Ligne>(supabase.from("wp_mouvements").select("code_salarie, type, date_sortie, motif_sortie, mois, annee").in("annee", annees).in("type", ["sortie", "sortie_temporaire"]).order("id")),
    fetchAll<Ligne>(supabase.from("wp_salary_stats").select("code_salarie, date_sortie, mois, annee").in("annee", annees).order("id")),
    fetchAll<Ligne>(supabase.from("wp_absences").select("code_salarie, mois, annee, pct_absenteisme, hrs_maladie").in("annee", annees).order("id")).then((r) => plafonnerTauxCns(r as never[]) as unknown as Ligne[]),
    fetchAll<Ligne>(supabase.from("wp_absences_mct").select("code_salarie, date_absence, mois, annee").gte("date_absence", debutHistorique).lte("date_absence", fin).order("id")),
    fetchAll<Ligne>(supabase.from("wp_absences_injustifiees").select("code_salarie, date_debut, date_fin, mois, annee").in("annee", annees).order("id")),
    fetchAll<Ligne>(supabase.from("wp_scenarios").select("id, name, projected_turnover_rate").order("created_at", { ascending: false })),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_monthly_params").select("mois, centre_cout, projected_absenteeism_rate").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_monthly_leave_params").select("mois, centre_cout, projected_leave_rate").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_monthly_turnover_params").select("mois, centre_cout, projected_turnover_rate").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_arrival_hypotheses").select("*").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_temp_exit_hypotheses").select("*").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    scenarioId ? fetchAll<Ligne>(supabase.from("wp_scenario_departures").select("*").eq("scenario_id", scenarioId)) : Promise.resolve([] as Ligne[]),
    // Congés datés, et les imports MCT qui disent quels mois sont complets (chauffeurs importés)
    fetchAll<Ligne>(supabase.from("wp_conges").select("code_salarie, date_conge, duree_hrs").gte("date_conge", debutHistorique).lte("date_conge", fin).order("id")),
    fetchAll<Ligne>(supabase.from("wp_imports").select("mois, annee, imported_at, conges_chauffeurs_inclus").eq("file_type", "absences_mct").eq("status", "completed").in("annee", annees)),
  ]);
  const scenario = scenarios.find((s) => s.id === scenarioId) ?? null;

  // ---- Photos : chaque mois lit la sienne, reconduite à défaut ; mêmes filtre et reclassification que le tableau de bord
  const codesMaladie = new Set(cns.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => String(a.code_salarie)));
  const index = indexerPhotos(photos as (Ligne & { mois: number; annee: number })[]);
  ajouterPhotoSiAbsente(index, periodeRecente, photoRecenteHorsPlage as (Ligne & { mois: number; annee: number })[]);
  const preparees = new Map<number, PersonneEffectif[]>();
  const photoPreparee = (annee: number, mois: number) => {
    const { lignes, periode, exacte } = photoPourLeMois(index, mois, annee);
    if (!periode) return { lignes: [] as PersonneEffectif[], exacte: false };
    const r = rangPeriode(periode);
    let prete = preparees.get(r);
    if (!prete) {
      prete = reclassifierSortiesTemporaires(
        (lignes as unknown as PersonneEffectif[]).filter((e) => filtres.passe(e as never)).map((e) => ({ ...e })),
        codesMaladie
      );
      preparees.set(r, prete);
    }
    return { lignes: prete, exacte };
  };

  // Sortis du mois absents de sa photo (l'export SIRH ne les reconduit pas) : repris de la photo précédente avec leur date réelle
  const populations = new Map<string, PersonneEffectif[]>();
  const populationDuMois = (annee: number, mois: number): PersonneEffectif[] => {
    const cle = `${annee}-${mois}`;
    const deja = populations.get(cle);
    if (deja) return deja;
    const courante = photoPreparee(annee, mois);
    const prec = mois === 1 ? { annee: annee - 1, mois: 12 } : { annee, mois: mois - 1 };
    const precedente = photoPreparee(prec.annee, prec.mois);
    let population = courante.lignes;
    if (courante.exacte && precedente.exacte) {
      const codes = new Set(courante.lignes.map((e) => e.code_salarie));
      const parCode = new Map(precedente.lignes.map((e) => [e.code_salarie, e]));
      const sortis = computeRosterMovements(precedente.lignes, courante.lignes, mois, annee,
        sortiesConstateesSur(mouvements as never[], statsSalariales as never[], mois, annee, prec)).sortiesDefinitives
        .filter((i) => i.date && !codes.has(i.code_salarie) && parCode.has(i.code_salarie))
        .map((i) => ({ ...parCode.get(i.code_salarie)!, date_sortie: i.date, est_sortie_temporaire: false }));
      population = [...courante.lignes, ...sortis];
    }
    populations.set(cle, population);
    return population;
  };

  // ---- Absences connues
  const cleMois = (annee: unknown, mois: unknown) => `${annee}-${String(mois).padStart(2, "0")}`;
  const moisMesures = {
    cns: new Set(cns.map((a) => cleMois(a.annee, a.mois))),
    mct: new Set(mct.map((a) => String(a.date_absence).slice(0, 7))),
    inj: new Set(injustifiees.map((a) => cleMois(a.annee, a.mois))),
    // Congés : seuls les mois COMPLETS retirent les jours datés ; les autres gardent le taux
    conges: new Set(annees.flatMap((a) => [...moisCongesComplets(importsMct, a)].map((m) => cleMois(a, m)))),
  };
  const cnsParSalarieMois = new Map(cns.map((a) => [`${a.code_salarie}|${cleMois(a.annee, a.mois)}`, Number(a.pct_absenteisme || 0)]));
  const mctJours = new Set(
    mct.filter((a) => { const j = new Date(`${a.date_absence}T00:00:00Z`).getUTCDay(); return j !== 0 && j !== 6; })
      .map((a) => `${a.code_salarie}|${String(a.date_absence).slice(0, 10)}`)
  );
  // Part de la journée en congé (heures / 8, plafonnée à 1), cumulée par jour ; week-ends écartés
  const congesJours = new Map<string, number>();
  conges.forEach((c) => {
    const date = String(c.date_conge).slice(0, 10);
    const j = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (j === 0 || j === 6) return;
    const cle = `${c.code_salarie}|${date}`;
    congesJours.set(cle, Math.min(1, (congesJours.get(cle) ?? 0) + Number(c.duree_hrs || 0) / 8));
  });
  const plagesInj = injustifiees
    .filter((a) => a.date_debut)
    .map((a) => ({ code_salarie: String(a.code_salarie), debut: String(a.date_debut).slice(0, 10), fin: String(a.date_fin || a.date_debut).slice(0, 10) }));

  // Premier jour projeté : lendemain du mois de la dernière photo
  const premierJourProjete = periodeRecente
    ? premierDuMois(decalerMois(`${periodeRecente.annee}-${String(periodeRecente.mois).padStart(2, "0")}-01`, 1))
    : aujourdhui;

  const base: Omit<EntreesEffectifJournalier, "debut" | "fin" | "tauxDuMois"> = {
    premierJourProjete,
    populationDuMois,
    moisMesures,
    cnsParSalarieMois,
    mctJours,
    congesJours,
    injustifiees: plagesInj,
  };

  // ---- Taux mesurés sur l'historique, repris pour les mois sans fichier
  const finHistorique = decalerJours(premierJourProjete, -1);
  const mesures = finHistorique >= debutHistorique
    ? tauxMesuresParMois(calculerEffectifJournalier({ ...base, debut: debutHistorique, fin: finHistorique, tauxDuMois: () => ({ cns: 0, mct: 0, inj: 0, conges: 0 }) }), moisMesures)
    : new Map();
  const tauxDuMois = (annee: number, mois: number) => ({
    cns: (scenario ? tauxScenarioDuMois(scParams, "projected_absenteeism_rate", mois) : null) ?? tauxRepris(mesures, "cns", annee, mois),
    mct: tauxRepris(mesures, "mct", annee, mois),
    inj: tauxRepris(mesures, "inj", annee, mois),
    conges: scenario ? (tauxScenarioDuMois(scConges, "projected_leave_rate", mois) ?? 0) * CONGES_POOL_ANNUEL : 0,
  });

  // ---- Scénario
  const codesPerimetre = new Set(periodeRecente ? photoPreparee(periodeRecente.annee, periodeRecente.mois).lignes.map((e) => e.code_salarie) : []);
  const { hypotheses, sortiesScenario } = scenario
    ? hypothesesDuScenario({ arrivees: scArrivees, sortiesTemporaires: scSortiesTemp, departs: scDeparts }, filtres, codesPerimetre)
    : { hypotheses: [], sortiesScenario: new Map<string, string>() };
  const turnoverAnnuel = scenario
    ? (_annee: number, mois: number) => tauxScenarioDuMois(scTurnover, "projected_turnover_rate", mois) ?? Number(scenario.projected_turnover_rate ?? 0)
    : undefined;

  const entrees: EntreesEffectifJournalier = { ...base, debut, fin, tauxDuMois, hypotheses, sortiesScenario, turnoverAnnuel };
  const jours = calculerEffectifJournalier(entrees);
  const liste = jourChoisi ? listerJour(entrees, jourChoisi) : null;

  // Taux appliqués aux mois de la plage, pour les afficher
  const moisPlage = [...new Set(jours.map((j) => j.date.slice(0, 7)))];
  const tauxAffiches = moisPlage.map((k) => {
    const [a, m] = k.split("-").map(Number);
    return { mois: k, mesure: { cns: moisMesures.cns.has(k), mct: moisMesures.mct.has(k), inj: moisMesures.inj.has(k), conges: moisMesures.conges.has(k) }, taux: tauxDuMois(a, m) };
  });

  return (
    <EffectifJournalierClient
      jours={jours}
      debut={debut}
      fin={fin}
      aujourdhui={aujourdhui}
      premierJourProjete={premierJourProjete}
      scenarios={scenarios.map((s) => ({ id: String(s.id), name: String(s.name) }))}
      scenarioId={scenario ? String(scenario.id) : null}
      hypotheses={hypotheses.map((h) => ({ libelle: h.libelle, type: h.type, nbPersonnes: h.nbPersonnes, debut: h.debut, fin: h.fin }))}
      departsDonnees={sortiesScenario.size}
      tauxAffiches={tauxAffiches}
      jourChoisi={jourChoisi}
      liste={liste}
      filtresActifs={filtres.actifs}
    />
  );
}
