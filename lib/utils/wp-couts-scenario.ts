/**
 * Valorisation en euros d'une projection de scénario.
 *
 * PRINCIPE. Le moteur de projection (`wp-projection-scenarios.ts`) raisonne
 * en ETP et émet un journal mensuel : ce qui entre, ce qui sort, les taux
 * appliqués. Ce module suit le même journal avec une masse en euros :
 *  - la masse de départ est celle du dernier mois réel (photo de départ,
 *    salaire par salarié) ;
 *  - chaque mois, un COÛT MOYEN PAR ETP est recalculé sur la photo de départ
 *    avec les leviers du mois (indexation, augmentation, salaire minimum,
 *    coefficient forcé) : c'est lui qui valorise le turnover, les sorties
 *    datées, les retours et les suspensions, et qui fait monter la masse
 *    quand une hausse tombe ;
 *  - une hypothèse d'arrivée est valorisée au coût moyen de son PROFIL
 *    (fonction + contrat, cost center puis dépôt puis entreprise), et sa fin
 *    de CDD retirée au même coût ;
 *  - les primes du mois s'ajoutent à tous les paliers : une prime est payée
 *    quelle que soit l'absence.
 *
 * Les paliers suivent la chaîne du journal : net = brut − suspensions ; réel
 * = net × (1 − CNS) ; après MCT = réel − net × MCT ; après congés = après MCT
 * − congés × coût moyen. Les sources de coût de chaque hypothèse sont
 * rendues pour être affichées avec leur niveau de repli.
 */

import type { ArrivalHypothesis } from "./wp-calculations";
import type { JournalMoisProjection } from "./wp-projection-scenarios";
import { coutMoyenEtp, type CoutMoyen, type ProfilCout } from "./wp-cout-moyen";
import { brutPleinTempsAvecLeviers, coefficientPour, facteurHausse, primesDuMois, type LevierCout, type MoisAnnee } from "./wp-leviers-cout";
import { etpDe } from "./wp-paliers";
import { tauxComplementsDe, type ComplementsRecurrents, type SalarieCout, type SourceSalaires } from "./wp-couts";
import { familleContrat } from "./wp-filtres";

export interface EntreesValorisation {
  /** Photo du dernier mois réel (actifs, filtrée), avec ses salaires. */
  photoDepart: SalarieCout[];
  source: SourceSalaires;
  /** Population de référence NON filtrée pour le coût moyen des hypothèses (dernière photo avec salaires). */
  populationReference: SalarieCout[];
  coefBase: number;
  leviers: LevierCout[];
  premierMoisProjete: MoisAnnee;
  /** Coût moyen par ETP de repli quand aucun salarié comparable n'a de salaire. */
  coutEtpDefaut: number;
  /**
   * Compléments récurrents (13e mois proratisé, prime de fonction) : mêmes
   * taux que la chaîne des coûts réels, sinon la courbe sauterait entre le
   * dernier mois réel et le premier projeté. Une hypothèse d'arrivée n'a pas
   * l'ancienneté du 13e mois : elle ne porte que la prime de fonction.
   */
  complements?: ComplementsRecurrents | null;
}

export interface SourceCoutHypothese {
  libelle: string;
  profil: ProfilCout;
  cout: CoutMoyen;
  /** ETP concernés (nb_personnes × taux). */
  etp: number;
  sens: "arrivee" | "fin_cdd";
  mois: MoisAnnee;
}

export interface MoisValorise {
  annee: number;
  mois: number;
  coutEtp: number;
  coefficient: number;
  primes: number;
  scenario_brut: number;
  scenario_net: number;
  scenario_reel: number;
  scenario_apres_injustifiees?: number;
  scenario_apres_mct: number;
  scenario_apres_conges?: number;
}

export interface SortieValorisation {
  mois: MoisValorise[];
  sources: SourceCoutHypothese[];
}

function profilDeHypothese(h: ArrivalHypothesis): ProfilCout {
  return {
    fonction: h.fonction || null,
    famille: familleContrat(h.type_contrat),
    centre_cout: h.centre_cout || null,
    depot: h.depot || null,
  };
}

const arrondi = (n: number) => Math.round(n);

/**
 * Coût moyen par ETP d'un mois projeté : la photo de départ, salaire par
 * salarié, hausses et plancher SSM du mois appliqués, coefficient du mois.
 */
export function coutEtpDuMois(e: EntreesValorisation, m: MoisAnnee): { coutEtp: number; coefficient: number } {
  let masse = 0;
  let etp = 0;
  const coefGlobal = coefficientPour(e.leviers, null, m, e.premierMoisProjete, e.coefBase);
  for (const s of e.photoDepart) {
    const etpS = etpDe(s);
    if (etpS <= 0) continue;
    const brut = e.source.brutDe(s.code_salarie);
    const cc = s.centre_cout ?? null;
    const coef = coefficientPour(e.leviers, cc, m, e.premierMoisProjete, e.coefBase);
    const cout = brut != null
      ? brutPleinTempsAvecLeviers(brut, e.leviers, cc, m, e.premierMoisProjete).brut * (1 + tauxComplementsDe(e.complements, cc)) * etpS * coef
      : e.coutEtpDefaut * etpS * facteurHausse(e.leviers, cc, m, e.premierMoisProjete);
    masse += cout;
    etp += etpS;
  }
  return { coutEtp: etp > 0 ? masse / etp : e.coutEtpDefaut, coefficient: coefGlobal };
}

export function valoriserProjection(journal: JournalMoisProjection[], e: EntreesValorisation): SortieValorisation {
  const sources: SourceCoutHypothese[] = [];
  const mois: MoisValorise[] = [];
  // Coût des hypothèses d'arrivée, mémorisé pour retirer une fin de CDD au coût de son entrée
  const coutParHypothese = new Map<string, number>();

  const coutHypothese = (h: ArrivalHypothesis, m: MoisAnnee, sens: "arrivee" | "fin_cdd"): number => {
    const profil = profilDeHypothese(h);
    const base = coutMoyenEtp(e.populationReference, profil, e.coefBase, e.coutEtpDefaut);
    const facteur = facteurHausse(e.leviers, profil.centre_cout, m, e.premierMoisProjete);
    const coefRatio = coefficientPour(e.leviers, profil.centre_cout, m, e.premierMoisProjete, e.coefBase) / e.coefBase;
    const etp = h.nb_personnes * (h.taux_occupation / 100);
    // Arrivée : prime de fonction du cost center, pas de 13e mois (ancienneté < 1 an)
    const complements = 1 + tauxComplementsDe(e.complements, profil.centre_cout, { sansCct: true });
    const coutEtp = sens === "arrivee" ? base.coutEtp * complements * facteur * coefRatio : (coutParHypothese.get(h.id) ?? base.coutEtp * complements * facteur * coefRatio);
    if (sens === "arrivee") coutParHypothese.set(h.id, coutEtp);
    sources.push({
      libelle: `${h.nb_personnes} × ${h.fonction || "fonction non précisée"} (${h.type_contrat}${h.centre_cout ? `, ${h.centre_cout}` : ""})`,
      profil, cout: base, etp, sens, mois: m,
    });
    return coutEtp * etp;
  };

  // Masse de départ : la photo du dernier mois réel, salaire par salarié
  let masse = 0;
  let etpDepart = 0;
  for (const s of e.photoDepart) {
    const brut = e.source.brutDe(s.code_salarie);
    masse += (brut != null ? brut * (1 + tauxComplementsDe(e.complements, s.centre_cout ?? null)) * e.coefBase : e.coutEtpDefaut) * etpDe(s);
    etpDepart += etpDe(s);
  }
  // Coût moyen de départ, SANS levier : un levier effectif dès le premier
  // mois projeté relève la masse par le rapport des coûts moyens.
  let coutEtpPrecedent: number | null = etpDepart > 0 ? masse / etpDepart : null;

  for (const j of journal) {
    const m: MoisAnnee = { mois: j.mois, annee: j.annee };
    const { coutEtp, coefficient } = coutEtpDuMois(e, m);
    // Une hausse ou un changement de coefficient ce mois relève toute la masse
    if (coutEtpPrecedent != null && coutEtpPrecedent > 0) masse *= coutEtp / coutEtpPrecedent;
    coutEtpPrecedent = coutEtp;

    // Sorties : turnover, sorties retenues (données ou hypothèses), fins de CDD d'hypothèse
    masse -= (j.turnoverLosses + j.departsRetenus) * coutEtp;
    for (const h of j.finsCddHyp) masse -= coutHypothese(h, m, "fin_cdd");
    // Entrées : arrivées datées des données, retours, hypothèses d'arrivée
    masse += (j.dataArrivals + j.retours) * coutEtp;
    for (const h of j.arriveesHyp) masse += coutHypothese(h, m, "arrivee");
    masse = Math.max(0, masse);

    const primes = primesDuMois(e.leviers, null, m, Math.max(0, j.scenario_net));
    const net = Math.max(0, masse - j.tempExitsEtp * coutEtp);
    const reel = net * (1 - j.cnsRate / 100);
    // Payé = réel − injustifiées (taux repris) ; disponible = payé − MCT
    const apresInj = j.injRate != null ? reel - net * (j.injRate / 100) : undefined;
    const apresMct = (apresInj ?? reel) - net * (j.absRate / 100);
    mois.push({
      annee: j.annee,
      mois: j.mois,
      coutEtp,
      coefficient,
      primes,
      scenario_brut: arrondi(masse + primes),
      scenario_net: arrondi(net + primes),
      scenario_reel: arrondi(reel + primes),
      scenario_apres_injustifiees: apresInj != null ? arrondi(apresInj + primes) : undefined,
      scenario_apres_mct: arrondi(apresMct + primes),
      scenario_apres_conges: j.leaveFte != null ? arrondi(apresMct - j.leaveFte * coutEtp + primes) : undefined,
    });
  }
  return { mois, sources };
}
