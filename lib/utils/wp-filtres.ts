/**
 * Filtres de périmètre écrits dans l'URL par la barre d'en-tête Workforce
 * (components/layout/header.tsx) : fonctions, centres de coût, dépôts,
 * équipes (multi-valeurs séparées par « ||| », « __none__ » = aucune valeur
 * cochée) et un salarié. Lus à l'identique par le tableau de bord et
 * l'analyse historique.
 */

export const SEP_FILTRE = "|||";
export const AUCUNE_VALEUR = "__none__";

export interface ParamsFiltres {
  fonctions?: string;
  cc?: string;
  depots?: string;
  equipes?: string;
  employee?: string;
}

export interface SalarieFiltrable {
  code_salarie: string;
  description_fonction?: string | null;
  centre_cout?: string | null;
  description_service?: string | null;
  description_equipe?: string | null;
}

export interface FiltresWorkforce {
  fonctions: string[];
  cc: string[];
  depots: string[];
  equipes: string[];
  employee: string | null;
  /** Au moins un filtre restreint le périmètre */
  actifs: boolean;
  passe: (e: SalarieFiltrable) => boolean;
}

function lireListe(valeur: string | undefined): string[] {
  if (valeur === AUCUNE_VALEUR) return [AUCUNE_VALEUR];
  return valeur ? valeur.split(SEP_FILTRE) : [];
}

export function lireFiltresWorkforce(params: ParamsFiltres): FiltresWorkforce {
  const fonctions = lireListe(params.fonctions);
  const cc = lireListe(params.cc);
  const depots = lireListe(params.depots);
  const equipes = lireListe(params.equipes);
  const employee = params.employee || null;
  const actifs = fonctions.length > 0 || cc.length > 0 || depots.length > 0 || equipes.length > 0 || !!employee;
  const passe = (e: SalarieFiltrable) => {
    if (fonctions.length > 0 && !fonctions.includes(e.description_fonction || "")) return false;
    if (cc.length > 0 && !cc.includes(e.centre_cout || "")) return false;
    if (depots.length > 0 && !depots.includes(e.description_service || "")) return false;
    if (equipes.length > 0 && !equipes.includes(e.description_equipe || "")) return false;
    if (employee && e.code_salarie !== employee) return false;
    return true;
  };
  return { fonctions, cc, depots, equipes, employee, actifs, passe };
}
