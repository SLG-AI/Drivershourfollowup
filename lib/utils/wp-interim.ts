/**
 * Coûts intérim : coût ATTENDU calculé par SLG Intérim (wp_interim_costs),
 * rattaché au dépôt et au cost center par le roster HRIS du même mois
 * (wp_interim_roster). Les intérimaires restent hors effectifs et hors paie.
 */
import { joursOuvresEntre } from "./wp-calculations";
import { HEURES_JOUR_TEMPS_PLEIN } from "./wp-duree-absence";
import type { SalarieFiltrable } from "./wp-filtres";

export interface CoutInterim {
  code_salarie: string;
  mois: number;
  annee: number;
  composante: string;
  quantite: number;
  montant_facturable: number;
}

export interface RattachementInterim {
  code_salarie: string;
  mois: number;
  annee: number;
  type_contrat?: string | null;
  code_employeur?: string | null;
  centre_cout?: string | null;
  description_service?: string | null;
  description_fonction?: string | null;
  description_equipe?: string | null;
}

const cle = (annee: number, mois: number) => `${annee}-${String(mois).padStart(2, "0")}`;
const libelleMois = (annee: number, mois: number) => `${String(mois).padStart(2, "0")}/${annee}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Temps plein du mois : jours ouvrés (hors week-ends et fériés luxembourgeois) × 8 h. */
export function heuresTempsPleinDuMois(annee: number, mois: number): number {
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return joursOuvresEntre(`${cle(annee, mois)}-01`, `${cle(annee, mois)}-${String(dernier).padStart(2, "0")}`) * HEURES_JOUR_TEMPS_PLEIN;
}

/**
 * Contrôle bloquant avant import : chaque code du fichier doit figurer dans le
 * roster intérim de son mois. Rend les messages d'erreur (codes seulement,
 * jamais de nom) ; vide = import possible.
 *
 * `salaries` : codes présents dans wp_employees du mois. Un code qui y figure
 * mais pas comme intérimaire signale une collision de codes entre les deux
 * applis, ou un type de contrat non reconnu.
 */
export function controlerRattachement(
  couts: Pick<CoutInterim, "code_salarie" | "mois" | "annee">[],
  roster: Pick<RattachementInterim, "code_salarie" | "mois" | "annee">[],
  salaries: Pick<RattachementInterim, "code_salarie" | "mois" | "annee">[]
): string[] {
  const enRoster = new Set(roster.map((r) => `${cle(r.annee, r.mois)}|${r.code_salarie}`));
  const enSalaries = new Set(salaries.map((r) => `${cle(r.annee, r.mois)}|${r.code_salarie}`));
  const parMois = new Map<string, { annee: number; mois: number; absents: Set<string>; collisions: Set<string> }>();
  for (const c of couts) {
    const k = cle(c.annee, c.mois);
    if (enRoster.has(`${k}|${c.code_salarie}`)) continue;
    const m = parMois.get(k) ?? { annee: c.annee, mois: c.mois, absents: new Set(), collisions: new Set() };
    (enSalaries.has(`${k}|${c.code_salarie}`) ? m.collisions : m.absents).add(c.code_salarie);
    parMois.set(k, m);
  }
  const liste = (codes: Set<string>) => {
    const tries = Array.from(codes).sort();
    return tries.slice(0, 10).join(", ") + (tries.length > 10 ? `… (+${tries.length - 10})` : "");
  };
  const messages: string[] = [];
  for (const m of Array.from(parMois.values()).sort((a, b) => a.annee - b.annee || a.mois - b.mois)) {
    if (m.absents.size > 0) {
      messages.push(`${m.absents.size} code(s) absent(s) du roster intérim de ${libelleMois(m.annee, m.mois)} : ${liste(m.absents)}.`);
    }
    if (m.collisions.size > 0) {
      messages.push(
        `${m.collisions.size} code(s) présent(s) dans le roster de ${libelleMois(m.annee, m.mois)} comme salarié(s), pas comme intérimaire(s) : ` +
          `${liste(m.collisions)}. Type de contrat non reconnu, ou même code dans les deux applis.`
      );
    }
  }
  return messages;
}

export interface LigneInterimCostCenter {
  centre_cout: string;
  montant: number;
  heures: number;
  etp: number;
  intervenants: number;
  composantes: Record<string, { quantite: number; montant: number }>;
}

/**
 * Agrégat d'un mois par cost center, après les filtres de l'en-tête
 * (appliqués aux champs du roster intérim). Heures = composante « base » :
 * toutes les heures prestées, heures sup. comprises (« overtime » n'est
 * qu'une majoration). ETP = heures ÷ temps plein du mois.
 */
export function agregerInterimParCostCenter(
  couts: CoutInterim[],
  roster: RattachementInterim[],
  annee: number,
  mois: number,
  filtres: { actifs: boolean; passe: (e: SalarieFiltrable) => boolean } = { actifs: false, passe: () => true }
): LigneInterimCostCenter[] {
  const rattachement = new Map(roster.filter((r) => r.annee === annee && r.mois === mois).map((r) => [r.code_salarie, r]));
  const tempsPlein = heuresTempsPleinDuMois(annee, mois);
  const parCc = new Map<string, LigneInterimCostCenter & { codes: Set<string> }>();

  for (const c of couts) {
    if (c.annee !== annee || c.mois !== mois) continue;
    const r = rattachement.get(c.code_salarie);
    // Sans rattachement (roster réimporté depuis) : affiché à part sans filtre,
    // écarté dès qu'un filtre est posé puisqu'on ne sait pas s'il y répond.
    if (r ? !filtres.passe(r) : filtres.actifs) continue;
    const cc = r?.centre_cout || "(non rattaché)";
    const l = parCc.get(cc) ?? { centre_cout: cc, montant: 0, heures: 0, etp: 0, intervenants: 0, composantes: {}, codes: new Set<string>() };
    l.montant += c.montant_facturable;
    if (c.composante === "base") l.heures += c.quantite;
    const comp = (l.composantes[c.composante] ??= { quantite: 0, montant: 0 });
    comp.quantite += c.quantite;
    comp.montant += c.montant_facturable;
    l.codes.add(c.code_salarie);
    parCc.set(cc, l);
  }

  return Array.from(parCc.values())
    .map(({ codes, ...l }) => ({
      ...l,
      montant: r2(l.montant),
      heures: r2(l.heures),
      etp: tempsPlein > 0 ? r2(l.heures / tempsPlein) : 0,
      intervenants: codes.size,
      composantes: Object.fromEntries(
        Object.entries(l.composantes).map(([k, v]) => [k, { quantite: r2(v.quantite), montant: r2(v.montant) }])
      ),
    }))
    .sort((a, b) => b.montant - a.montant);
}
