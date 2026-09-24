"use client";

/**
 * Rendu de la page Méthodologie.
 *
 * Le contenu est décrit comme des DONNÉES (tableau `Indicateur`) plutôt que
 * comme du JSX : une définition se relit et se corrige sans toucher à la mise
 * en page, et l'impression n'a qu'un seul gabarit à traiter.
 *
 * Deux niveaux de lecture, conformément à l'usage attendu :
 *  - la définition métier en une phrase, toujours visible, avec le chiffre du
 *    mois à côté ;
 *  - le détail du calcul (formule, population, cas particuliers, source),
 *    replié à l'écran et TOUJOURS déplié à l'impression.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Printer, AlertTriangle, Info } from "lucide-react";
import type { PaliersMois } from "@/lib/utils/wp-paliers";
import type { CoutsMois } from "@/lib/utils/wp-couts";
import { FAMILLES, NATURES } from "@/lib/utils/wp-natures-paie";

const MOIS_LABELS: Record<number, string> = {
  1: "janvier", 2: "février", 3: "mars", 4: "avril", 5: "mai", 6: "juin",
  7: "juillet", 8: "août", 9: "septembre", 10: "octobre", 11: "novembre", 12: "décembre",
};

export interface DonneesMethodologie {
  refDate: string;
  paliers: PaliersMois;
  perimetreComplet: boolean;
  rosterPeriode: { mois: number; annee: number; exacte: boolean };
  moisPrecedentDisponible: boolean;
  mct: { lignesWeekEnd: number; heuresWeekEnd: number };
  effectifMoyen: { brut: number; suspendus: number; net: number; jours: number };
  turnover: {
    sortiesEtp: number;
    sortiesHorsTurnoverEtp: number;
    tauxMensuel: number;
    tauxAnnualise: number;
    sourceMouvements: boolean;
  };
  /** La chaîne des paliers en euros (page Coûts). */
  couts?: {
    paliers: CoutsMois;
    coefficient: number;
    coefficientSource: { mois: number; annee: number; n: number; brut: number; employeur: number; perimetre: "filtre" | "entreprise" } | null;
    salairesReportes: boolean;
    periodeReference: { mois: number; annee: number } | null;
    aucunSalaire: boolean;
    realise: { employeur: number; brut: number; n: number; mesure: boolean };
    /** Compléments récurrents mesurés sur la Liste des salaires, null sans mesure. */
    complements: { mois: number; annee: number; taux: number; tauxCct: number; tauxPrf: number; n: number; brutBase: number; montant: number; costCenters: number } | null;
  };
}

interface Props {
  donnees: DonneesMethodologie | null;
  perimetre: { libelle: string; valeurs: string[] }[];
  annee: number;
  mois: number;
}

// ============================================================
// Formatage
// ============================================================

const nf = (n: number, d = 1) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const etp = (n: number) => `${nf(n)} ETP`;
const pct = (n: number, d = 1) => `${nf(n, d)} %`;
const heures = (n: number) => `${nf(n, 0)} h`;
const euros = (n: number) => `${nf(n, 0)} €`;
const dateFr = (iso: string) => {
  const [a, m, j] = iso.split("-");
  return `${j}/${m}/${a}`;
};

// ============================================================
// Modèle de contenu
// ============================================================

interface Operande {
  label: string;
  valeur: string;
}

interface BlocDetail {
  titre: string;
  points: string[];
}

interface Indicateur {
  /** Ancre d'URL : c'est elle que visent les liens « ? » des cartes du tableau de bord. */
  cle: string;
  titre: string;
  /** La définition métier, en une phrase. */
  definition: string;
  /** Le chiffre du mois, quand l'indicateur en a un. */
  valeur?: string;
  valeurNote?: string;
  /** Formule littérale, suivie de ses opérandes chiffrées sur le mois. */
  formule?: string;
  operandes?: Operande[];
  details: BlocDetail[];
  source?: string;
}

interface Section {
  cle: string;
  titre: string;
  chapeau: string;
  indicateurs: Indicateur[];
}

// ============================================================
// Composants
// ============================================================

function Formule({ formule, operandes }: { formule: string; operandes?: Operande[] }) {
  return (
    <div className="rounded-md border bg-muted/40 p-3">
      {/* whitespace-pre-wrap : les formules sur plusieurs lignes gardent leur alignement */}
      <p className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">{formule}</p>
      {operandes && operandes.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 border-t pt-3 sm:grid-cols-2">
          {operandes.map((o) => (
            <div key={o.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-muted-foreground">{o.label}</dt>
              <dd className="font-mono text-xs font-semibold tabular-nums">{o.valeur}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function BlocIndicateur({ ind, ouvertParDefaut }: { ind: Indicateur; ouvertParDefaut: boolean }) {
  const [ouvert, setOuvert] = useState(ouvertParDefaut);

  return (
    <div id={ind.cle} className="scroll-mt-24 break-inside-avoid rounded-lg border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{ind.titre}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{ind.definition}</p>
        </div>
        {ind.valeur && (
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">{ind.valeur}</p>
            {ind.valeurNote && <p className="text-xs text-muted-foreground">{ind.valeurNote}</p>}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        className="flex w-full items-center gap-2 border-t px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50 print:hidden"
        aria-expanded={ouvert}
      >
        {ouvert ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Détail du calcul
      </button>

      <div className={`${ouvert ? "block" : "hidden"} space-y-4 border-t p-4 print:block`}>
        {ind.formule && <Formule formule={ind.formule} operandes={ind.operandes} />}
        {ind.details.map((d) => (
          <div key={d.titre}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.titre}</p>
            <ul className="mt-1.5 space-y-1.5">
              {d.points.map((p, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {ind.source && (
          <p className="border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium">Source :</span> {ind.source}
          </p>
        )}
      </div>
    </div>
  );
}

/** La chaîne des paliers, en barres proportionnelles. */
function Cascade({ paliers }: { paliers: PaliersMois }) {
  const max = paliers.sousContrat || 1;
  const lignes = paliers.etapes.map((e) => ({
    ...e,
    part: Math.max(0, (e.etp / max) * 100),
  }));

  return (
    <div className="space-y-2">
      {lignes.map((l) => (
        <div key={l.cle} className="break-inside-avoid">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <a href={`#${l.cle}`} className="font-medium hover:underline">
              {l.libelle}
            </a>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold">{etp(l.etp)}</span>
              {l.retire > 0 && (
                <span className="ml-2 text-xs text-red-600">−{nf(l.retire)}</span>
              )}
              {!l.mesure && l.retire === 0 && l.taux !== null && (
                <span className="ml-2 text-xs text-amber-600">aucune donnée</span>
              )}
            </span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full bg-muted print:border">
            <div
              className="h-full rounded-full bg-blue-600 print:bg-gray-700"
              style={{ width: `${l.part}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Page
// ============================================================

export function MethodologieClient({ donnees, perimetre, annee, mois }: Props) {
  const [toutOuvert, setToutOuvert] = useState(false);
  const libelleMois = `${MOIS_LABELS[mois]} ${annee}`;

  const sections = construireSections(donnees, libelleMois);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Méthodologie des indicateurs</h1>
          <p className="text-muted-foreground">
            Comment chaque chiffre du module Workforce Planning est calculé, et sur quelles données.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => setToutOuvert((v) => !v)}>
            {toutOuvert ? "Tout replier" : "Tout déplier"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Imprimer
          </Button>
        </div>
      </div>

      {/* Périmètre des chiffres affichés */}
      <Card className="border-blue-200 bg-blue-50/50 print:border-gray-300 print:bg-transparent">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
            <div className="space-y-2 text-sm">
              <p>
                Les chiffres de cette page sont ceux de <strong>{libelleMois}</strong>
                {donnees ? <> arrêtés au <strong>{dateFr(donnees.refDate)}</strong></> : null}, calculés
                sur le périmètre choisi dans la barre d&apos;en-tête — exactement comme le tableau de bord.
                Changez de mois ou de filtre et les exemples suivent.
              </p>
              {perimetre.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">Périmètre :</span>
                  {perimetre.map((f) => (
                    <Badge key={f.libelle} variant="secondary" className="font-normal">
                      {f.libelle} : {f.valeurs.join(", ")}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Périmètre : aucun filtre actif, l&apos;ensemble de l&apos;effectif est pris en compte.
                </p>
              )}
              {donnees && !donnees.rosterPeriode.exacte && (
                <p className="flex items-start gap-2 text-xs font-medium text-amber-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Aucun export SIRH pour ce mois : les effectifs sont repris de la photographie de{" "}
                  {MOIS_LABELS[donnees.rosterPeriode.mois]} {donnees.rosterPeriode.annee}, reconduite telle quelle.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {!donnees && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Aucune photographie d&apos;effectif n&apos;est encore importée : les définitions ci-dessous
              sont affichées sans exemple chiffré.
            </p>
          </CardContent>
        </Card>
      )}

      {/* La chaîne des effectifs, d'un coup d'œil */}
      {donnees && (
        <Card className="break-inside-avoid">
          <CardHeader>
            <CardTitle className="text-base">La chaîne des effectifs, de bout en bout</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Cascade paliers={donnees.paliers} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Chaque palier retire une population du précédent. Les trois taux d&apos;absence, eux, se
              rapportent tous à l&apos;effectif <strong>après suspension de contrat</strong> ({etp(donnees.paliers.apresSuspension)})
              et jamais au palier qui les précède : rapporter le MCT à l&apos;effectif après CNS gonflerait le
              taux et le rendrait incomparable d&apos;un mois à l&apos;autre.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sommaire */}
      <Card className="print:hidden">
        <CardHeader>
          <CardTitle className="text-base">Sommaire</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((s) => (
              <div key={s.cle}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{s.titre}</p>
                <ul className="mt-1.5 space-y-1">
                  {s.indicateurs.map((i) => (
                    <li key={i.cle}>
                      <a href={`#${i.cle}`} className="text-sm text-blue-700 hover:underline">
                        {i.titre}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Sections */}
      {sections.map((s) => (
        <section key={s.cle} id={s.cle} className="scroll-mt-24 space-y-3">
          <div>
            <h2 className="text-lg font-bold">{s.titre}</h2>
            <p className="text-sm text-muted-foreground">{s.chapeau}</p>
          </div>
          <div className="space-y-3">
            {s.indicateurs.map((i) => (
              <BlocIndicateur key={i.cle} ind={i} ouvertParDefaut={toutOuvert} />
            ))}
          </div>
        </section>
      ))}

      <p className="pt-4 text-xs text-muted-foreground">
        Page générée depuis les mêmes fonctions de calcul que le tableau de bord
        (lib/utils/wp-paliers.ts, wp-effectif-moyen.ts, wp-absenteisme.ts, wp-turnover.ts,
        wp-movements.ts). Une définition qui change dans le code change ici aussi.
      </p>
    </div>
  );
}

// ============================================================
// Contenu
// ============================================================

/**
 * Exemple travaillé du temps partiel.
 *
 * C'est la question qui revient : un mi-temps absent 20 % de SES jours, que
 * pèse-t-il ? La réponse — 0,10 ETP — est la même par les trois taux, mais
 * obtenue de deux façons opposées : le CNS pondère explicitement par l'ETP,
 * le MCT et les injustifiées ne pondèrent rien du tout. Montrer les deux côte
 * à côte évite de croire qu'il manque une multiplication quelque part.
 *
 * Les nombres suivent le mois affiché (jours ouvrés, heures travaillables).
 */
function exempleTempsPartiel(p: PaliersMois | undefined, libelleMois: string): Indicateur {
  const JOURNEE_MI_TEMPS = 4; // 8 h × 50 %
  const PART_ABSENTE = 0.2;

  const jours = p?.joursOuvres ?? 0;
  const hTrav = p?.heuresTravaillables ?? 0;
  const heuresManquees = PART_ABSENTE * jours * JOURNEE_MI_TEMPS;
  const etpPerdu = hTrav > 0 ? heuresManquees / hTrav : 0;

  return {
    cle: "temps-partiel",
    titre: "Le cas d'un salarié à temps partiel",
    definition:
      "Un salarié à 50 % qui manque 20 % des jours qu'il devait travailler fait perdre 0,10 ETP, soit 20 % de son demi-poste. Les trois taux aboutissent au même chiffre, mais par deux mécanismes opposés.",
    valeur: p ? `${nf(etpPerdu, 2)} ETP` : "0,10 ETP",
    valeurNote: "20 % de son 0,5 ETP",
    formule: p
      ? `CNS       : (20 / 100) × 0,5 ETP disponible  = ${nf(etpPerdu, 2)} ETP\n` +
        `MCT/inj.  : ${nf(heuresManquees, 1)} h / ${hTrav} h heures travaillables = ${nf(etpPerdu, 2)} ETP`
      : "CNS       : (20 / 100) × 0,5 ETP disponible\nMCT/inj.  : (heures manquées) / heures travaillables",
    operandes: p
      ? [
          { label: `Jours ouvrés (${libelleMois})`, valeur: String(jours) },
          { label: "Sa journée contractuelle", valeur: `${JOURNEE_MI_TEMPS} h` },
          { label: "Heures manquées", valeur: `${nf(heuresManquees, 1)} h` },
          { label: "Heures travaillables (temps plein)", valeur: heures(hTrav) },
        ]
      : undefined,
    details: [
      {
        titre: "Côté CNS : la pondération est explicite",
        points: [
          "Le pourcentage du fichier CNS vaut 20, pas 10 : c'est un pourcentage rapporté aux heures théoriques DU SALARIÉ, pas à un mois de temps plein. Un mi-temps a environ moitié moins d'heures théoriques qu'un temps plein.",
          "Ce pourcentage est ensuite multiplié par l'ETP disponible du salarié : 0,20 × 0,5 = 0,10 ETP. Sans cette multiplication, un mi-temps absent pèserait autant qu'un temps plein.",
          "Le pourcentage est plafonné à 100 % avant tout calcul. Le fichier dépasse parfois ce seuil — 248 h de maladie pour 168 h théoriques, quand le SIRH crédite des journées pleines sur des jours non ouvrés — et un salarié ferait alors perdre plus que son propre ETP. La base conserve la valeur du fichier, les heures affichées restent les siennes, la ligne est marquée « plafonné » et l'import signale ces salariés.",
        ],
      },
      {
        titre: "Côté MCT et injustifiées : aucune pondération, et il n'en faut pas",
        points: [
          "Ces deux taux divisent des heures par les heures travaillables d'un mois de TEMPS PLEIN, identiques pour tout le monde. Il n'y a aucune multiplication par l'ETP, ni dans le taux ni dans le détail par salarié.",
          "Le résultat est juste quand même, parce que le numérateur porte déjà la proportion : le fichier note la journée RÉELLE du salarié — 4 h pour un mi-temps, 6,4 h pour un 80 %.",
          `Sur ${libelleMois} : 20 % de ${jours} jours × 4 h = ${nf(heuresManquees, 1)} h, divisé par ${heures(hTrav)}, soit ${nf(etpPerdu, 2)} ETP. Le même chiffre que par la voie CNS.`,
        ],
      },
      {
        titre: "La condition à surveiller",
        points: [
          "Tout repose sur le fait que le fichier note la durée contractuelle du salarié. S'il notait 8 h forfaitaires pour la journée d'un mi-temps, la perte serait comptée DOUBLE — 0,20 ETP au lieu de 0,10 — sans erreur ni alerte.",
          "Vérification faite sur un mois complet, les deux fichiers respectent la règle : le MCT note la journée du salarié, et les absences injustifiées notent ses jours ouvrés × sa journée sur toute la période couverte.",
          "Un contrôle à l'import le vérifie désormais à chaque fichier, en comparant la durée déclarée au temps de travail du salarié sur la période — taux du roster et taux des « Statistiques rapides », dont il retient le plus favorable, aucun des deux n'étant fiable seul.",
        ],
      },
    ],
    source: "Tables wp_absences, wp_absences_mct, wp_absences_injustifiees ; contrôles dans lib/utils/wp-duree-absence.ts et lib/utils/wp-taux-cns.ts.",
  };
}

function construireSections(d: DonneesMethodologie | null, libelleMois: string): Section[] {
  const p = d?.paliers;

  return [
    {
      cle: "sec-effectifs",
      titre: "Les effectifs",
      chapeau:
        "Qui est compté, à quelle date, et ce que l'on retire à chaque étape. Tout est exprimé en ETP, pas en personnes.",
      indicateurs: [
        {
          cle: "effectif-sous-contrat",
          titre: "Effectif sous contrat (ETP)",
          definition:
            "Somme des équivalents temps plein de tous les salariés liés par un contrat au dernier jour du mois, y compris ceux dont le contrat est suspendu.",
          valeur: p ? etp(p.sousContrat) : undefined,
          valeurNote: p ? `${p.headcount} personnes` : undefined,
          formule: "effectif sous contrat = Σ (taux d'occupation / 100) des salariés actifs à la date de référence",
          operandes: p
            ? [
                { label: "Date de référence", valeur: dateFr(p.refDate) },
                { label: "Personnes retenues", valeur: String(p.headcount) },
                { label: "Total", valeur: etp(p.sousContrat) },
              ]
            : undefined,
          details: [
            {
              titre: "Qui est « actif » à la date de référence",
              points: [
                "Sa date d'entrée est passée, ou n'est pas renseignée.",
                "Il n'a pas de date de sortie, ou elle n'est pas encore passée.",
                "Exception : un salarié dont la date de sortie est passée MAIS dont le contrat est suspendu reste compté. Il n'est pas parti, il reviendra — le sortir puis le réintégrer créerait un faux départ suivi d'une fausse embauche.",
              ],
            },
            {
              titre: "Personnes et ETP",
              points: [
                "L'ETP d'un salarié est son taux d'occupation divisé par 100 : un 50 % compte pour 0,5.",
                "Un taux d'occupation vide vaut un temps plein : le SIRH ne renseigne la colonne que pour les temps partiels.",
                "Le nombre de personnes est affiché à côté de l'ETP sur le tableau de bord ; les deux ne s'additionnent jamais.",
              ],
            },
            {
              titre: "Pourquoi le dernier jour du mois",
              points: [
                "C'est la date à laquelle le SIRH arrête sa photographie, donc la seule qui soit vérifiable ligne à ligne.",
                "Un salarié entré le 20 ou sorti le 10 compte ici pour 1 ou pour 0. La lecture pondérée par les jours est l'effectif moyen, plus bas.",
              ],
            },
          ],
          source: "Table wp_employees, photographie du mois affiché.",
        },
        {
          cle: "effectif-apres-suspension",
          titre: "Effectif après suspension de contrat (ETP)",
          definition:
            "L'effectif sous contrat diminué de la part dont le contrat est suspendu : congé parental, maternité, congé sans solde. C'est l'effectif réellement mobilisable avant absences.",
          valeur: p ? etp(p.apresSuspension) : undefined,
          valeurNote: p ? `${nf(p.etpSuspendu)} ETP suspendus — ${p.nbSuspendus} personnes` : undefined,
          formule: "effectif après suspension = effectif sous contrat − Σ (ETP × fraction suspendue)",
          operandes: p
            ? [
                { label: "Effectif sous contrat", valeur: etp(p.sousContrat) },
                { label: "Dont suspendus", valeur: `− ${etp(p.etpSuspendu)}` },
                { label: "Personnes en suspension", valeur: String(p.nbSuspendus) },
                { label: "Résultat", valeur: etp(p.apresSuspension) },
              ]
            : undefined,
          details: [
            {
              titre: "Quand une suspension compte",
              points: [
                "Le drapeau « sortie temporaire » est posé sur le salarié.",
                "Le congé a commencé : sa date de début est antérieure au dernier jour du mois.",
                "Il n'est pas terminé : sa date de fin, si elle est connue, n'est pas dépassée.",
                "Convention partagée avec les scénarios : un départ ou un retour daté du DERNIER jour du mois prend effet le mois suivant.",
              ],
            },
            {
              titre: "Combien la suspension retire",
              points: [
                "L'ETP entier par défaut : un congé parental à temps plein, une maternité ou un congé sans solde retirent tout le salarié.",
                "Rien du tout quand le congé parental à temps partiel est encodé par le taux : le SIRH pose alors le drapeau sans motif ni dates et abaisse le taux d'occupation à la part travaillée (100 → 50). La réduction est déjà portée par le taux ; la retirer une seconde fois compterait la perte en double.",
                "La moitié quand un motif désigne explicitement un temps partiel. Le SIRH n'a pas encore émis un tel code : la table des libellés reconnus l'anticipe.",
                "Un motif parental que l'application ne sait pas classer est signalé à l'import et traité comme une suspension complète — choix prudent : mieux vaut sous-estimer l'effectif que le surestimer.",
              ],
            },
            {
              titre: "Deux corrections appliquées avant le calcul",
              points: [
                "Un salarié flaggé « sortie temporaire » avec un motif non structurel et des heures maladie CNS n'est pas en congé : c'est un absent maladie. Le drapeau est retiré, il repasse dans l'effectif disponible et son absence est comptée dans le taux CNS.",
                "Un salarié dont le motif est structurel et qui a une date de sortie sans être encore flaggé est un congé À VENIR : il est reclassé en sortie temporaire pour ne pas être compté comme un départ définitif.",
                "La même correction est appliquée à la photographie du mois précédent, sinon la comparaison des deux mois inventerait des mouvements.",
              ],
            },
          ],
          source: "Table wp_employees ; règles dans lib/utils/wp-suspension.ts.",
        },
        {
          cle: "effectif-moyen",
          titre: "Effectif moyen du mois (ETP)",
          definition:
            "La moyenne journalière de l'effectif sur le mois, et non sa valeur au dernier jour : chaque jour, on somme les ETP sous contrat, puis on divise par le nombre de jours.",
          valeur: d ? etp(d.effectifMoyen.brut) : undefined,
          valeurNote: d ? `moyenne sur ${d.effectifMoyen.jours} jours` : undefined,
          formule: "effectif moyen = Σ (sur chaque jour du mois) ETP sous contrat ce jour-là / nombre de jours du mois",
          operandes: d
            ? [
                { label: "Jours du mois", valeur: String(d.effectifMoyen.jours) },
                { label: "Moyenne sous contrat", valeur: etp(d.effectifMoyen.brut) },
                { label: "Moyenne suspendue", valeur: `− ${etp(d.effectifMoyen.suspendus)}` },
                { label: "Moyenne après suspension", valeur: etp(d.effectifMoyen.net) },
              ]
            : undefined,
          details: [
            {
              titre: "Pourquoi une seconde lecture du même mois",
              points: [
                "Au dernier jour du mois, un salarié entré le 20 compte pour 1 et un salarié sorti le 10 compte pour 0, alors qu'ils n'ont pesé qu'une fraction du mois.",
                "La moyenne journalière rend cette réalité. C'est elle qui sert de dénominateur au turnover mensuel : rapporter des départs étalés sur le mois à une photo d'un seul jour fausserait le taux.",
                "Les deux valeurs diffèrent toujours un peu. Ce n'est pas une incohérence : ce sont deux questions différentes.",
              ],
            },
            {
              titre: "Les sortis absents de la photographie",
              points: [
                "L'export SIRH ne reconduit pas un salarié déjà sorti à sa date : les partis en cours de mois disparaissent de la photo du mois.",
                "Ils sont réinjectés depuis les mouvements, avec leur date de sortie, et comptent jusqu'à ce jour inclus. Sans cela, leurs jours de présence seraient perdus et la moyenne sous-estimée.",
              ],
            },
            {
              titre: "Mêmes règles que le tableau de bord",
              points: [
                "L'activité et la suspension sont évaluées jour par jour avec les règles décrites plus haut, y compris la fraction suspendue.",
              ],
            },
            {
              titre: "La vue « Moyenne » de la courbe",
              points: [
                "Le bouton « Fin de mois / Moyenne » de la courbe d'évolution applique ce calcul aux douze mois, chacun lu dans sa propre photographie.",
                "Sous contrat et net sont des moyennes journalières. Les paliers suivants (réel, payé, disponible) appliquent à l'effectif net moyen les taux d'absence du mois, qui sont déjà des moyennes : le point du mois affiché donne donc les mêmes chiffres que les lignes violettes des cartes, à l'arrondi près.",
                "Les sortis absents de la photographie ne sont repris que lorsque le mois et le précédent ont chacun leur photo. Un scénario est projeté en fin de mois : en vue Moyenne, chaque mois projeté vaut la moyenne de ses deux fins de mois (la précédente et la sienne), une interpolation linéaire à l'intérieur du mois.",
                "Sur chaque ligne, le trait plein couvre les mois mesurés et le pointillé les mois reportés : photo de roster reconduite d'un autre mois, ou taux d'absence repris du dernier mois connu. Un palier hérite du report de ses entrées, si bien que le pointillé peut commencer plus tôt sur les lignes du bas. L'infobulle marque ces valeurs « reporté ».",
              ],
            },
          ],
          source: "lib/utils/wp-effectif-moyen.ts.",
        },
      ],
    },
    {
      cle: "sec-absences",
      titre: "Les taux d'absence",
      chapeau:
        "Trois taux qui se cumulent, tous rapportés au même dénominateur : l'effectif après suspension de contrat.",
      indicateurs: [
        {
          cle: "heures-travaillables",
          titre: "Heures travaillables du mois",
          definition:
            "Le dénominateur qui convertit des heures d'absence en ETP : les jours ouvrés du mois multipliés par 8 heures.",
          valeur: p ? heures(p.heuresTravaillables) : undefined,
          valeurNote: p ? `${p.joursOuvres} jours ouvrés × 8 h` : undefined,
          formule: "heures travaillables = jours ouvrés (lundi-vendredi, hors jours fériés) × 8",
          operandes: p
            ? [
                { label: "Jours ouvrés", valeur: String(p.joursOuvres) },
                { label: "Heures par jour", valeur: "8" },
                { label: "Heures travaillables", valeur: heures(p.heuresTravaillables) },
              ]
            : undefined,
          details: [
            {
              titre: "Les 11 jours fériés luxembourgeois retenus",
              points: [
                "Fixes : Nouvel An, Fête du Travail (1er mai), Journée de l'Europe (9 mai), Fête nationale (23 juin), Assomption (15 août), Toussaint (1er novembre), Noël (25 décembre), Saint-Étienne (26 décembre).",
                "Mobiles, calculés à partir de la date de Pâques : lundi de Pâques, Ascension, lundi de Pentecôte.",
                "Un férié qui tombe un samedi ou un dimanche ne retire rien : il n'était déjà pas un jour ouvré.",
              ],
            },
            {
              titre: "Une convention, pas une mesure",
              points: [
                "Les 8 heures par jour sont une base conventionnelle appliquée à tous, indépendamment du temps de travail réel de chaque salarié.",
                "L'ETP individuel intervient ailleurs : dans le taux CNS, où chaque salarié pèse son ETP disponible.",
              ],
            },
          ],
          source: "lib/utils/wp-calculations.ts.",
        },
        {
          cle: "taux-cns",
          titre: "Taux de couverture CNS",
          definition:
            "Part de l'effectif absente pour un motif pris en charge par la Caisse nationale de santé : maladie, accident, maternité, raisons familiales, congé d'accompagnement, accueil.",
          valeur: p ? pct(p.tauxCns) : undefined,
          valeurNote: p
            ? p.cnsMesure
              ? `${etp(p.etpPerduCns)} perdus — ${heures(p.heuresCns)} déclarées`
              : "aucune donnée CNS sur ce mois"
            : undefined,
          formule:
            "taux CNS = Σ (% d'absence du salarié × son ETP disponible) / effectif après suspension × 100",
          operandes: p
            ? [
                { label: "ETP perdus (numérateur)", valeur: etp(p.etpPerduCns) },
                { label: "Effectif après suspension", valeur: etp(p.apresSuspension) },
                { label: "Taux", valeur: pct(p.tauxCns) },
                { label: "Effectif après CNS", valeur: etp(p.apresCns) },
              ]
            : undefined,
          details: [
            {
              titre: "Le numérateur",
              points: [
                "Le pourcentage d'absence vient du fichier CNS : c'est le rapport entre les heures d'absence du salarié et ses heures théoriques du mois.",
                "Il est pondéré par l'ETP DISPONIBLE du salarié, pas par son ETP contractuel : un mi-temps absent tout le mois pèse 0,5 ETP, pas 1.",
                "Un salarié dont le contrat est suspendu a un ETP disponible nul : il ne peut pas être malade au sens de cet indicateur, et ne fait donc pas bouger le taux.",
              ],
            },
            {
              titre: "Les heures affichées à côté du taux",
              points: [
                "Elles additionnent tous les motifs CNS du mois et donnent un ordre de grandeur.",
                "Elles ne sont PAS le numérateur : le taux est construit sur les pourcentages d'absence, plus fiables, car ils rapportent déjà l'absence aux heures théoriques propres à chaque salarié.",
                "Elles ne sont affichées que lorsque le taux est mesuré sur le mois, pour qu'il n'y ait jamais un pourcentage et des heures qui ne se correspondent pas.",
              ],
            },
            {
              titre: "Quand le mois n'a pas de données",
              points: [
                "Le taux du dernier mois connu est repris, et la carte porte la mention « Estimé — repris de … ».",
                "Les heures ne sont alors pas affichées, puisqu'elles appartiendraient à un autre mois.",
              ],
            },
          ],
          source: "Table wp_absences (fichier CNS mensuel).",
        },
        {
          cle: "taux-injustifiees",
          titre: "Taux d'absences injustifiées",
          definition: "Part de l'effectif absente sans justificatif.",
          valeur: p ? pct(p.tauxInjustifiees) : undefined,
          valeurNote: p
            ? p.injustifieesMesure
              ? `${heures(p.heuresInjustifiees)} = ${etp(p.etpPerduInjustifiees)}`
              : "aucune absence injustifiée sur ce mois"
            : undefined,
          formule:
            "taux injustifiées = (heures injustifiées / heures travaillables) / effectif après suspension × 100",
          operandes: p
            ? [
                { label: "Heures injustifiées", valeur: heures(p.heuresInjustifiees) },
                { label: "Heures travaillables", valeur: heures(p.heuresTravaillables) },
                { label: "ETP perdus", valeur: etp(p.etpPerduInjustifiees) },
                { label: "Taux", valeur: pct(p.tauxInjustifiees) },
              ]
            : undefined,
          details: [
            {
              titre: "Une différence avec les deux autres taux",
              points: [
                "Sans filtre, les absences injustifiées ne sont PAS restreintes aux salariés présents dans la photographie du mois : le fichier peut concerner un salarié sorti depuis, et ces heures ont bien manqué au mois.",
                "Dès qu'un filtre de périmètre est actif, seules comptent celles des salariés du périmètre, comme pour la CNS et le MCT. Sans cela, les heures de toute l'entreprise seraient retirées d'un effectif partiel.",
              ],
            },
            {
              titre: "Pourquoi ce palier vient avant le MCT : l'effectif payé",
              points: [
                "Une absence CNS ou injustifiée n'est pas payée par l'employeur. Un salarié en MCT, lui, reste payé ; la mutuelle rembourse ensuite une partie.",
                "Retirer les injustifiées juste après la CNS fait donc de ce palier l'effectif PAYÉ. Le MCT se retire ensuite et donne l'effectif disponible, dont la valeur ne dépend pas de l'ordre.",
              ],
            },
            {
              titre: "Conversion",
              points: [
                "Identique au MCT : heures additionnées, divisées par les heures travaillables du mois, puis rapportées à l'effectif après suspension.",
                "Un jour d'absence injustifiée vaut 8 heures lorsqu'il faut le convertir en jours, par exemple dans le score de Bradford.",
                "Une ligne de ce fichier décrit une PÉRIODE (début → fin), pas une journée : sa durée couvre tous les jours ouvrés de l'intervalle, à la journée contractuelle du salarié. Une absence du 4 au 12 août vaut ainsi 56 h, soit 7 jours ouvrés à 8 h.",
                "La colonne « Jours » du détail compte donc les jours ouvrés de chaque période. Elle comptait auparavant les lignes du fichier, ce qui affichait « 1 jour » pour une absence d'une semaine.",
              ],
            },
          ],
          source: "Table wp_absences_injustifiees.",
        },
        {
          cle: "taux-mct",
          titre: "Taux de maladies non prises en charge (MCT)",
          definition:
            "Part de l'effectif absente pour maladie courte durée non couverte par la CNS — les jours à charge de l'employeur.",
          valeur: p ? pct(p.tauxMct) : undefined,
          valeurNote: p
            ? p.mctMesure
              ? `${heures(p.heuresMct)} = ${etp(p.etpPerduMct)}`
              : "aucune donnée MCT sur ce mois"
            : undefined,
          formule:
            "taux MCT = (heures MCT hors week-end / heures travaillables) / effectif après suspension × 100",
          operandes:
            p && d
              ? [
                  { label: "Heures MCT retenues", valeur: heures(p.heuresMct) },
                  { label: "Heures travaillables", valeur: heures(p.heuresTravaillables) },
                  { label: "ETP perdus", valeur: etp(p.etpPerduMct) },
                  { label: "Taux", valeur: pct(p.tauxMct) },
                ]
              : undefined,
          details: [
            {
              titre: "Les week-ends sont écartés",
              points: [
                "Le dénominateur ne compte que du lundi au vendredi. Garder les heures du samedi et du dimanche au numérateur gonflait le taux — jusqu'à 4,6 % des heures MCT sur un mois observé.",
                d
                  ? d.mct.lignesWeekEnd > 0
                    ? `Sur ${libelleMois} : ${d.mct.lignesWeekEnd} ligne(s) écartée(s), soit ${heures(d.mct.heuresWeekEnd)} non comptées.`
                    : `Sur ${libelleMois}, aucune ligne d'absence ne tombe un week-end.`
                  : "",
              ].filter(Boolean),
            },
            {
              titre: "La conversion en ETP",
              points: [
                "Une ligne du fichier = un jour d'absence d'un salarié. Les lignes sont additionnées en heures, puis divisées par les heures travaillables du mois.",
                "Le résultat est un nombre d'ETP : 176 heures d'absence sur un mois à 176 heures travaillables valent 1 ETP, quel que soit le nombre de salariés concernés.",
                "Seuls les salariés présents dans la photographie du mois sont retenus.",
              ],
            },
            {
              titre: "Le dénominateur ne change pas",
              points: [
                "Le taux est rapporté à l'effectif après suspension, pas au palier précédent. Le palier « après MCT », lui, se retire bien en cascade de l'effectif payé, et donne l'effectif disponible : le dernier de la chaîne.",
              ],
            },
          ],
          source: "Table wp_absences_mct.",
        },
        {
          cle: "taux-global",
          titre: "Taux d'absentéisme global",
          definition: "La somme des trois taux précédents : CNS, MCT et absences injustifiées.",
          valeur: p ? pct(p.tauxGlobal) : undefined,
          valeurNote: p
            ? `CNS ${nf(p.tauxCns)} % + MCT ${nf(p.tauxMct)} % + inj. ${nf(p.tauxInjustifiees)} %`
            : undefined,
          formule: "taux global = taux CNS + taux MCT + taux injustifiées",
          operandes: p
            ? [
                { label: "CNS", valeur: pct(p.tauxCns) },
                { label: "MCT", valeur: pct(p.tauxMct) },
                { label: "Injustifiées", valeur: pct(p.tauxInjustifiees) },
                { label: "Global", valeur: pct(p.tauxGlobal) },
              ]
            : undefined,
          details: [
            {
              titre: "Pourquoi une simple addition est légitime",
              points: [
                "Les trois taux partagent le même dénominateur — l'effectif après suspension — et portent sur des populations disjointes : un salarié n'est pas simultanément en arrêt CNS et en MCT.",
                "C'est précisément pour rendre cette addition possible que le MCT n'est pas rapporté à l'effectif après CNS.",
              ],
            },
            {
              titre: "Effectif disponible",
              points: [
                "Le complément du taux global appliqué à l'effectif après suspension donne l'effectif réellement disponible : le dernier palier de la chaîne.",
                p ? `Sur ${libelleMois} : ${etp(p.apresMct)} disponibles sur ${etp(p.sousContrat)} sous contrat.` : "",
              ].filter(Boolean),
            },
            {
              titre: "Estimations",
              points: [
                "Si au moins un des trois taux est repris d'un autre mois, la carte le signale. Le total affiché mêle alors du mesuré et de l'estimé.",
              ],
            },
          ],
        },
        exempleTempsPartiel(p, libelleMois),
      ],
    },
    {
      cle: "sec-mouvements",
      titre: "Mouvements et turnover",
      chapeau: "Qui entre, qui sort, et à quel rythme. Deux mesures distinctes : le mois et l'année.",
      indicateurs: [
        {
          cle: "turnover-mensuel",
          titre: "Taux de turnover mensuel",
          definition:
            "Les départs définitifs du mois, hors fins de CDD, rapportés à l'effectif moyen du mois. Multiplié par 12 pour se comparer à un taux annuel.",
          valeur: d ? pct(d.turnover.tauxMensuel, 2) : undefined,
          valeurNote: d ? `annualisé : ${pct(d.turnover.tauxAnnualise)}` : undefined,
          formule: "turnover mensuel = sorties définitives du mois (ETP, hors fins de CDD) / effectif moyen du mois × 100",
          operandes: d
            ? [
                { label: "Sorties retenues", valeur: etp(d.turnover.sortiesEtp) },
                { label: "Dont fins de CDD exclues", valeur: etp(d.turnover.sortiesHorsTurnoverEtp) },
                { label: "Effectif moyen du mois", valeur: etp(d.effectifMoyen.brut) },
                { label: "Taux mensuel", valeur: pct(d.turnover.tauxMensuel, 2) },
              ]
            : undefined,
          details: [
            {
              titre: "Ce qui est exclu, et pourquoi",
              points: [
                "Les fins de mission — le terme prévu d'un CDD — ne sont pas du turnover : on mesure les départs subis ou choisis, pas des contrats arrivés à leur terme. Arbitrage du 15 septembre 2026.",
                "Seul le motif décide : un CDD rompu avant son terme (démission, licenciement, résiliation d'un commun accord) est un départ, il compte dans le turnover. Arbitrage du 22 septembre 2026, qui aligne le tableau de bord sur l'analyse historique.",
                "Les suspensions de contrat ne sont pas des sorties : elles n'entrent pas dans ce taux.",
              ],
            },
            {
              titre: "D'où viennent les sorties du mois",
              points: [
                "De la comparaison entre la photographie du mois précédent et celle du mois affiché : qui a disparu.",
                "La date et le motif réels viennent de l'export IN/OUT du SIRH ; à défaut, de la date de sortie des statistiques salariales. Un CDD rompu avant son terme n'a sinon que sa date prévue.",
                d && !d.moisPrecedentDisponible
                  ? "Sur ce mois, la photographie du mois précédent est absente : le calcul se replie sur les sorties datées de la photographie affichée, c'est-à-dire les sorties PRÉVUES seulement."
                  : "",
                "Convention : une sortie datée du dernier jour du mois prend effet le mois suivant.",
              ].filter(Boolean),
            },
            {
              titre: "Mensuel et annualisé",
              points: [
                "Le taux mensuel répond à « combien de départs ce mois-ci ». Le ×12 le projette sur douze mois à rythme constant.",
                "L'annualisé n'est PAS le taux de turnover de l'année : un mois atypique projeté sur douze donne un chiffre spectaculaire et faux. Le taux annuel réel se lit dans l'analyse historique.",
              ],
            },
          ],
          source: "Tables wp_mouvements, wp_salary_stats et les deux photographies wp_employees.",
        },
        {
          cle: "departs-prevus",
          titre: "Départs prévisibles",
          definition:
            "Le nombre de salariés dont une date de sortie est déjà connue, entre la date de référence et la fin de l'année affichée.",
          details: [
            {
              titre: "Ce qui est compté",
              points: [
                "Un salarié dont la date de sortie est postérieure ou égale au dernier jour du mois affiché et antérieure au 31 décembre de l'année.",
                "Sorties définitives ET temporaires confondues : c'est un indicateur de charge à venir, pas un indicateur de turnover.",
                "Le compte est en PERSONNES, pas en ETP, contrairement à la plupart des autres indicateurs.",
              ],
            },
            {
              titre: "Limite",
              points: [
                "Il ne voit que ce qui est déjà déclaré au SIRH. Les démissions non encore connues n'y figurent évidemment pas : le chiffre est un plancher, jamais une prévision.",
              ],
            },
          ],
          source: "Colonne date_sortie de la photographie du mois.",
        },
        {
          cle: "mouvements",
          titre: "Mouvements du mois (M-1 → M)",
          definition:
            "Les entrées, sorties, mises en suspension et retours constatés entre la photographie du mois précédent et celle du mois affiché.",
          details: [
            {
              titre: "Pourquoi comparer deux photographies",
              points: [
                "L'export SIRH ne reconduit pas les salariés déjà sortis à sa date. Lire les dates de sortie dans la seule photo du mois affiché fait donc purement et simplement disparaître les sortis du mois.",
                "La comparaison de deux photos consécutives est la seule source fiable : qui est apparu, qui a disparu, qui est passé en suspension, qui en est revenu.",
                "Les deux photos subissent les mêmes filtres et la même reclassification, sans quoi un salarié hors périmètre passerait pour un nouvel engagé ou un sorti.",
                "Sous filtre, un salarié muté vers un autre cost center, dépôt ou équipe disparaît du périmètre sans quitter l'entreprise. Les photos complètes permettent de le reconnaître : il est classé « Sorti du périmètre » (ou « Entré dans le périmètre » dans l'autre sens), avec son affectation de destination ou d'origine, plutôt que parmi les disparus ou les nouveaux engagés. Ces transferts pèsent sur le solde du périmètre, mais ne sont ni des départs ni des embauches.",
                "Même règle de temps que pour les embauches et les retours : le panneau Mouvements montre les transferts survenus entre les deux photos ; les cartes « Départs identifiés » et « Arrivées identifiées » n'annoncent que ceux des mois suivants, tels qu'un roster plus récent les révèle. Sur la dernière photo de l'année, elles n'en montrent donc aucun.",
              ],
            },
            {
              titre: "Quand le panneau n'est pas affiché",
              points: [
                "Si la photographie du mois précédent n'existe pas, la comparaison est abandonnée plutôt que faite contre une photo de repli : on comparerait deux fois la même photo et tous les mouvements seraient nuls.",
              ],
            },
            {
              titre: "Solde",
              points: [
                "Le solde en ETP additionne les entrées et les retours, retranche les sorties et les mises en suspension. Il explique l'écart d'effectif entre les deux mois.",
              ],
            },
          ],
          source: "lib/utils/wp-movements.ts, table wp_mouvements.",
        },
        {
          cle: "gap-vs-cible",
          titre: "Gap vs cible",
          definition:
            "L'écart entre l'effectif après suspension de contrat et la somme des besoins cibles définis dans le module.",
          formule: "gap = effectif après suspension − Σ des besoins cibles",
          operandes: p ? [{ label: "Effectif après suspension", valeur: etp(p.apresSuspension) }] : undefined,
          details: [
            {
              titre: "Lecture",
              points: [
                "Un gap positif est un surplus, un gap négatif un déficit.",
                "Sans aucun besoin cible saisi, l'indicateur reste vide : il n'y a rien à comparer.",
                "La comparaison porte sur l'effectif après suspension, pas sur l'effectif disponible : une cible exprime un besoin de contrats, et les absences se gèrent par ailleurs.",
              ],
            },
          ],
          source: "Table wp_target_needs.",
        },
      ],
    },
    sectionCouts(d, libelleMois),
    {
      cle: "sec-historique",
      titre: "Analyse historique",
      chapeau:
        "Les mêmes définitions, appliquées mois par mois sur douze mois. Chaque mois est lu dans SA propre photographie.",
      indicateurs: [
        {
          cle: "absenteisme-historique",
          titre: "Absentéisme par mois et par dépôt",
          definition:
            "Le taux global et son détail CNS / MCT / injustifiées, recalculés mois par mois, puis agrégés par dépôt et sur l'année.",
          details: [
            {
              titre: "Mêmes règles que le tableau de bord",
              points: [
                "CNS : somme des pourcentages d'absence pondérés par l'ETP disponible des actifs non suspendus.",
                "MCT : heures hors week-end rapportées aux heures travaillables du mois, converties en ETP.",
                "Injustifiées : heures rapportées aux heures travaillables.",
                "Dénominateur : l'ETP disponible, soit l'effectif sous contrat moins les suspensions.",
              ],
            },
            {
              titre: "Agrégation annuelle",
              points: [
                "L'année n'est pas la moyenne des douze taux mensuels : c'est la somme des pertes divisée par la somme des ETP disponibles, sur les seuls mois qui ont des données.",
                "Un mois sans données ne compte donc ni au numérateur ni au dénominateur, au lieu d'être traité comme un mois à 0 %.",
              ],
            },
            {
              titre: "Par dépôt",
              points: [
                "Un dépôt doit peser au moins 10 ETP pour être classé : en dessous, un seul arrêt longue durée produit un taux spectaculaire et dénué de sens.",
                "Les salariés sans dépôt renseigné sont regroupés sous « Non renseigné » plutôt qu'écartés, pour ne rien perdre en silence.",
              ],
            },
          ],
          source: "lib/utils/wp-absenteisme.ts.",
        },
        {
          cle: "bradford",
          titre: "Score de Bradford",
          definition:
            "Un score individuel qui pénalise la répétition des absences bien plus que leur durée : S² × D, où S est le nombre d'épisodes et D le nombre de jours absents sur l'année.",
          formule: "Bradford = S² × D   (S = nombre d'épisodes, D = nombre de jours d'absence)",
          details: [
            {
              titre: "Ce qu'est un épisode",
              points: [
                "Une suite de jours d'absence MCT : un trou de 3 jours ou moins ne coupe pas l'épisode, et le week-end ne compte pas comme un trou.",
                "Chaque absence injustifiée compte pour un épisode à part entière.",
                "Chaque suite de mois consécutifs comportant des jours de maladie CNS compte pour un épisode.",
              ],
            },
            {
              titre: "Ce qu'est un jour",
              points: [
                "Une ligne du fichier MCT = un jour.",
                "Les heures d'absence injustifiée divisées par 8.",
                "Les jours de maladie déclarés au CNS.",
              ],
            },
            {
              titre: "Lecture",
              points: [
                "Dix absences d'un jour donnent 10² × 10 = 1 000 ; une absence de dix jours donne 1² × 10 = 10. Le score vise l'absentéisme perlé, pas l'arrêt long.",
                "Les 25 premiers salariés sont affichés ; ceux qui ont quitté l'entreprise apparaissent en gris.",
                "C'est un outil de conversation managériale, pas une sanction automatique : un arrêt fractionné pour une pathologie lourde produit le même score qu'un absentéisme de confort.",
              ],
            },
          ],
          source: "lib/utils/wp-absenteisme.ts.",
        },
        {
          cle: "turnover-historique",
          titre: "Turnover annuel, volontaire et involontaire",
          definition:
            "Les sorties définitives de l'année, classées par nature, rapportées à l'effectif moyen, en ETP.",
          details: [
            {
              titre: "Classification des motifs (arbitrage du 15 septembre 2026)",
              points: [
                "Volontaire : démission, résiliation de commun accord, transfert de société, préretraite, pension de vieillesse.",
                "Involontaire : licenciement, période d'essai non concluante, reclassement externe, décès.",
                "Fin de mission (terme d'un CDD) : hors turnover, comptée à part.",
                "Autre : motif inconnu, affiché tel quel pour ne rien perdre en silence plutôt que d'être rangé d'office dans une des deux catégories.",
              ],
            },
            {
              titre: "Deux sources, dans cet ordre",
              points: [
                "L'export IN/OUT quand il couvre l'année : dates et motifs réels.",
                "À défaut, les dates de sortie lues photo par photo — mais elles ne donnent que les sorties PRÉVUES, une photographie ne contenant plus les partis avant son export.",
                "Les sorties sont dédoublonnées par salarié : un même départ présent dans deux sources ne compte qu'une fois.",
              ],
            },
            {
              titre: "Mensuel et annuel ne se déduisent pas l'un de l'autre",
              points: [
                "Le KPI du tableau de bord est mensuel, calculé sur l'effectif moyen du mois, et son ×12 n'est qu'une projection.",
                "L'analyse historique est annuelle et s'appuie sur les entrées/sorties de l'année. Les deux chiffres n'ont pas vocation à coïncider.",
                "Sous le graphique « Sorties par mois », chaque mois porte son taux mensuel : sorties du mois hors fins de mission / effectif en fin de mois, lu dans la photo du mois — la même base que l'effectif moyen de l'année. Le KPI du tableau de bord divise, lui, par l'effectif moyen pondéré par les jours : les deux peuvent différer de quelques centièmes de point.",
                "Un mois sans roster (mois à venir dont des sorties sont déjà connues) reprend l'effectif de la dernière photo, sorties déjà datées retirées ; son taux s'affiche en gris italique.",
              ],
            },
          ],
          source: "lib/utils/wp-turnover.ts, table wp_mouvements.",
        },
      ],
    },
    {
      cle: "sec-sources",
      titre: "Les données et leur provenance",
      chapeau: "Ce que contient chaque fichier importé, et les pièges que leur structure impose.",
      indicateurs: [
        {
          cle: "sources",
          titre: "Fichiers et tables",
          definition:
            "Cinq imports alimentent le module ; aucun n'est saisi à la main dans l'application.",
          details: [
            {
              titre: "Les tables",
              points: [
                "wp_employees : la photographie mensuelle de l'effectif (une ligne par salarié et par mois). Source de tous les effectifs.",
                "wp_absences : le fichier CNS mensuel, avec le pourcentage d'absence et les heures par motif.",
                "wp_absences_mct : une ligne par jour d'absence pour maladie non prise en charge.",
                "wp_absences_injustifiees : une ligne par absence injustifiée, en heures.",
                "wp_mouvements : l'export IN/OUT du SIRH, seule source des dates et motifs de sortie réels.",
                "wp_salary_stats : les statistiques salariales, utilisées pour dater une sortie quand l'IN/OUT ne la couvre pas.",
                "wp_target_needs, wp_scenarios et leurs tables filles : les besoins cibles et les hypothèses de scénario, seules données saisies dans l'application.",
              ],
            },
            {
              titre: "La photographie mensuelle, et le biais qu'elle porte",
              points: [
                "Un export SIRH ne contient que les salariés présents à sa date : ni ceux embauchés après, ni ceux partis avant.",
                "Reconstruire une série de douze mois depuis une seule photo, par les dates d'entrée et de sortie, produit donc une courbe qui culmine systématiquement sur le mois de l'export — un biais de survivant.",
                "Toute lecture multi-mois passe donc par la règle « un mois = sa photo ». Un mois sans photo reprend la plus récente antérieure ; à défaut seulement, la plus ancienne disponible.",
              ],
            },
            {
              titre: "Le plafond des 1 000 lignes",
              points: [
                "L'API de la base tronque silencieusement toute réponse à 1 000 lignes, or un seul mois dépasse 1 400 salariés.",
                "Toutes les lectures de tables volumineuses sont donc paginées. Une lecture oubliée ne provoque pas d'erreur : elle rend simplement des salariés invisibles — d'où une vigilance particulière sur ce point.",
              ],
            },
          ],
        },
        {
          cle: "perimetre-filtres",
          titre: "Les filtres de périmètre",
          definition:
            "Société (code employeur), fonction, centre de coût, dépôt, équipe, contrat (CDI ou CDD) et salarié : les filtres de la barre d'en-tête s'appliquent à toutes les pages du module, et sont conservés dans l'adresse de la page.",
          details: [
            {
              titre: "Comment ils se combinent",
              points: [
                "Plusieurs valeurs cochées dans un même filtre agissent comme un « ou » ; deux filtres différents se combinent en « et ».",
                "Décocher toutes les valeurs d'un filtre ne revient pas à ne pas filtrer : cela sélectionne explicitement l'ensemble vide, et les indicateurs tombent à zéro.",
                "Les listes de valeurs proposées sont celles de la photographie la plus récente.",
              ],
            },
            {
              titre: "Le cas des absences injustifiées",
              points: [
                "Sans filtre, tout le fichier compte, y compris un salarié absent du roster. Avec un filtre, elles sont restreintes aux salariés du périmètre, comme les autres absences.",
              ],
            },
          ],
          source: "lib/utils/wp-filtres.ts.",
        },
        {
          cle: "scenarios",
          titre: "Scénarios et besoins cibles",
          definition:
            "Un scénario projette l'effectif sur les mois à venir à partir d'hypothèses d'arrivées, de départs, de congés et de taux d'absence.",
          details: [
            {
              titre: "Comment la projection avance",
              points: [
                "Elle part du dernier mois réel connu, puis enchaîne les mois un par un jusqu'à décembre de l'année affichée — en traversant les années si nécessaire, au lieu de repartir de la dernière photographie.",
                "Chaque mois applique, dans l'ordre : les arrivées prévues, les départs connus et le taux de turnover, les départs et retours de congé, puis les taux d'absence.",
                "Pour une année future, les taux d'absence sont amorcés sur les derniers mois connus de l'année précédente, calculés exactement comme les mois réels.",
                "La projection déroule la même chaîne que les mois réels : après CNS (dernier taux connu), après absences injustifiées (dernier taux connu, le scénario n'en modélise pas), après MCT. Le taux MCT est celui du scénario ; un scénario qui n'en renseigne aucun (tous les mois à 0) reprend le dernier taux MCT connu, comme la courbe sans scénario.",
              ],
            },
            {
              titre: "Ce qui reste une hypothèse",
              points: [
                "Les valeurs suggérées par l'analyse historique sont des moyennes du passé : elles ne prédisent rien, elles évitent seulement de partir d'une page blanche.",
                "Les besoins cibles sont saisis à la main et ne sont pas datés par mois : le gap compare un effectif d'un mois donné à une cible sans échéance.",
              ],
            },
          ],
        },
      ],
    },
    {
      cle: "sec-limites",
      titre: "Limites et biais connus",
      chapeau:
        "Ce que ces indicateurs ne disent pas. Les connaître évite de leur faire dire ce qu'ils ne mesurent pas.",
      indicateurs: [
        {
          cle: "limites",
          titre: "Ce qu'il faut savoir avant de commenter un chiffre",
          definition:
            "Les points sur lesquels les chiffres du module sont approximatifs, conventionnels ou dépendants d'une source incomplète.",
          details: [
            {
              titre: "Effectifs",
              points: [
                "L'effectif au dernier jour du mois et l'effectif moyen du mois diffèrent toujours. Comparer l'un d'une page à l'autre d'une autre page produit un faux écart.",
                "Un mois sans export SIRH reprend la photographie antérieure la plus récente, telle quelle : l'effectif affiché est alors celui d'un autre mois, signalé en haut de page.",
                "Le congé parental à temps partiel n'a pas de code SIRH dédié : il est reconnu à un encodage indirect (drapeau posé, sans motif ni dates, taux abaissé). Un motif parental non reconnu est traité comme une suspension complète — l'effectif est alors sous-estimé, jamais surestimé.",
                "Les congés à venir n'ont pas de date de fin communiquée par le SIRH : leur durée est inconnue, et donc leur effet sur les mois suivants.",
              ],
            },
            {
              titre: "Absences",
              points: [
                "Un taux peut être repris d'un mois antérieur quand le fichier du mois n'est pas encore importé. La carte le signale, mais le chiffre n'est pas une mesure.",
                "Les absences injustifiées échappent aux filtres de périmètre, contrairement à leur dénominateur.",
                "Les heures travaillables reposent sur une journée conventionnelle de 8 heures appliquée à tous, temps partiels compris.",
                "Le taux d'occupation d'un salarié peut changer en cours d'année, alors que chaque source ne le connaît qu'à une date : la photographie du roster le donne en fin de mois, les Statistiques rapides donnent le temps payé. Une absence survenue avant un changement de taux n'est donc rattachable à aucun des deux avec certitude.",
                "Un contrôle à l'import compare néanmoins chaque durée d'absence au temps de travail du salarié sur la période couverte, et signale ce qu'aucune des deux sources ne peut justifier — sur août 2026 : aucune ligne MCT sur 1 560, et 4 lignes d'absences injustifiées sur 31, toutes datées sur des jours non ouvrés ou d'une durée supérieure à leur période.",
              ],
            },
            {
              titre: "Turnover",
              points: [
                "Le turnover mensuel annualisé (×12) n'est pas le turnover annuel : il projette un seul mois sur douze.",
                "Les fins de CDD sont exclues du turnover par choix. Un service qui tourne massivement en CDD affichera donc un turnover faible.",
                "Sans photographie du mois précédent, les sorties du mois se limitent aux sorties PRÉVUES lisibles dans la photo affichée : le taux est alors sous-estimé.",
              ],
            },
          ],
        },
      ],
    },
  ];
}

// ============================================================
// Section « Les coûts » : la chaîne des paliers en euros (page Coûts)
// ============================================================

const MOIS_LONG = ["", "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function sectionCouts(d: DonneesMethodologie | null, libelleMois: string): Section {
  const c = d?.couts;
  const p = c?.paliers;
  const coefTexte = c
    ? c.coefficientSource
      ? `${nf(c.coefficient, 3)}, calculé sur ${MOIS_LONG[c.coefficientSource.mois]} ${c.coefficientSource.annee} (${nf(c.coefficientSource.n, 0)} lignes, ${c.coefficientSource.perimetre === "filtre" ? "périmètre filtré" : "toute l'entreprise"})`
      : `${nf(c.coefficient, 2)}, valeur par défaut faute de paie avec charges patronales`
    : undefined;
  const reference = c?.periodeReference ? `${MOIS_LONG[c.periodeReference.mois]} ${c.periodeReference.annee}` : null;

  return {
    cle: "sec-couts",
    titre: "Les coûts",
    chapeau:
      "La même chaîne de paliers, en euros de coût employeur : ce que coûterait l'effectif sous contrat, ce qui n'est pas payé, ce qui l'est. Deux sources : le brut indice du roster pour le contractuel, la paie (Liste des salaires, sinon Statistiques rapides) pour le réalisé.",
    indicateurs: [
      {
        cle: "coefficient-charges",
        titre: "Coefficient de charges patronales",
        definition: "Le rapport entre le coût employeur (brut + charges patronales) et le salaire brut, lu sur la paie réelle.",
        valeur: coefTexte,
        formule: "coefficient = Σ coût employeur / Σ Total brut, sur le dernier mois de paie qui porte les charges patronales (Liste des salaires : coût de la paie ; Statistiques rapides : total brut + charges patronales)",
        operandes: c?.coefficientSource
          ? [
              { label: "Total brut", valeur: euros(c.coefficientSource.brut) },
              { label: "Coût employeur", valeur: euros(c.coefficientSource.employeur) },
              { label: "Coefficient", valeur: nf(c.coefficient, 3) },
            ]
          : undefined,
        details: [
          {
            titre: "Périmètre puis entreprise, puis défaut",
            points: [
              "Le ratio est d'abord cherché sur le périmètre filtré (les charges varient avec la structure des salaires), sinon sur toute l'entreprise, sinon la valeur par défaut 1,15 (taux de charges patronales de 15 %) est appliquée et signalée.",
              "Les charges patronales sont la somme des colonnes CM et CP patronales, assurance accident, allocation familiale, santé au travail, mutualité et autres cotisations patronales du fichier. La colonne « Total SECU » n'est PAS un coût employeur : c'est le total des cotisations salariales et patronales (≈ 27 % du brut), elle ne sert pas au coefficient.",
              "Un fichier « sans salaire » (colonnes présentes, montants vides) ne compte pas : ses lignes valent 0 et n'entrent pas dans le ratio. Un fichier avec montants mais sans les colonnes patronales ne le fait pas non plus : le coût employeur y est alors estimé (brut × coefficient) et signalé.",
              "Quand la paie porte le centre de coût, un coefficient est aussi calculé par cost center et appliqué aux salariés de ce cost center dans la chaîne des paliers.",
              "La purge de rétention (3 ans) peut faire retomber le coefficient sur le défaut : sa source est toujours affichée.",
            ],
          },
        ],
        source: "lib/utils/wp-couts.ts (calculerCoefficientCharges).",
      },
      {
        cle: "cout-sous-contrat",
        titre: "Coût employeur sous contrat",
        definition: "Ce que coûterait, sur le mois, l'ensemble des salariés sous contrat : brut indice × (1 + compléments récurrents) × taux d'occupation × coefficient de charges.",
        valeur: p ? euros(p.sousContrat) : undefined,
        valeurNote: c?.salairesReportes && reference ? `salaires lus dans le roster de ${reference}` : undefined,
        formule: "coût sous contrat = Σ actifs (brut indice plein temps × (1 + taux de compléments récurrents) × taux d'occupation / 100 × coefficient)",
        operandes: p
          ? [
              { label: "Coût moyen par ETP", valeur: euros(p.coutMoyenEtp) },
              { label: "Compléments récurrents", valeur: c?.complements ? `${nf(c.complements.taux * 100, 1)} % du brut de base` : "non mesurés" },
              { label: "dont sous contrat", valeur: euros(p.complementsRecurrents) },
              { label: "Coefficient", valeur: nf(p.coef, 3) },
              { label: "Sous contrat", valeur: euros(p.sousContrat) },
            ]
          : undefined,
        details: [
          {
            titre: "Les compléments récurrents : 13e mois proratisé et prime de fonction",
            points: [
              "Le brut indice du roster ne porte ni le prorata mensuel du 13e mois (CCT / P001, versé aux chauffeurs de plus d'un an d'ancienneté) ni la prime de fonction (PR F : formateurs, team leaders, délégués du personnel dès octobre 2026). Les deux sont récurrents chaque mois : ils sont comptés dans le contractuel, pas dans le variable.",
              "Le taux est mesuré sur le dernier mois de Liste des salaires : Σ (CCT + PR F) / Σ brut de base des lignes de salaire, globalement et par cost center (la prime de fonction est concentrée sur quelques fonctions ; le taux du cost center d'un salarié prime, sinon le global). Il s'applique au brut indice avant les charges.",
              c?.complements
                ? `Mesure : ${MOIS_LABELS[c.complements.mois]} ${c.complements.annee}, ${nf(c.complements.n, 0)} lignes, ${euros(c.complements.montant)} de compléments pour ${euros(c.complements.brutBase)} de brut de base ⇒ ${nf(c.complements.taux * 100, 2)} % (13e mois ${nf(c.complements.tauxCct * 100, 2)} %, prime de fonction ${nf(c.complements.tauxPrf * 100, 2)} %), ${nf(c.complements.costCenters, 0)} cost centers avec leur propre taux.`
                : "Aucune Liste des salaires importée : le taux vaut 0 et le contractuel sous-estime la masse d'environ 6 %.",
              "Dans les scénarios, les mêmes taux s'appliquent aux mois projetés (sinon la courbe sauterait entre le dernier mois réel et le premier projeté). Une hypothèse d'arrivée ne porte que la prime de fonction de son cost center : elle n'a pas l'ancienneté du 13e mois.",
            ],
          },
          {
            titre: "Le brut indice est un plein temps",
            points: [
              "Le roster porte le brut mensuel à l'indice PLEIN TEMPS, quel que soit le taux d'occupation (vérifié : un mi-temps y porte le même brut qu'un temps plein). Le coût mensuel le multiplie donc par le taux.",
              "Un roster « sans salaire » (Brut indice vide) emprunte le brut de chaque salarié à la dernière photo qui en porte ; le mois est alors reporté et tracé en pointillé. Un salarié sans brut nulle part est compté au coût moyen par ETP du périmètre.",
              p && p.reporte.codesManquants > 0 ? `Sur ${libelleMois} : ${p.reporte.codesManquants} salarié(s) sans brut connu.` : "",
            ].filter(Boolean),
          },
        ],
        source: "wp_employees.brut_indice ; lib/utils/wp-couts.ts (calculerCoutsPaliers).",
      },
      {
        cle: "cout-apres-suspension",
        titre: "Coût après suspension de contrat",
        definition: "Le coût sous contrat moins celui des contrats suspendus, qui ne sont pas payés.",
        valeur: p ? euros(p.apresSuspension) : undefined,
        formule: "après suspension = sous contrat − Σ suspendus (coût × fraction suspendue)",
        operandes: p
          ? [
              { label: "Sous contrat", valeur: euros(p.sousContrat) },
              { label: "Suspendu", valeur: euros(p.coutSuspendu) },
              { label: "Après suspension", valeur: euros(p.apresSuspension) },
            ]
          : undefined,
        details: [
          {
            titre: "Mêmes règles que les ETP",
            points: [
              "Un congé parental à temps partiel ne retire que la moitié du coût, comme il ne retire que la moitié de l'ETP. C'est le même drapeau et la même fraction (wp-suspension.ts).",
            ],
          },
        ],
      },
      {
        cle: "cout-paye",
        titre: "Coût payé (après CNS et absences injustifiées)",
        definition: "Ce que l'employeur paie réellement : le coût après suspension, moins les absences CNS et les absences injustifiées, non rémunérées.",
        valeur: p ? euros(p.apresInjustifiees) : undefined,
        formule: "payé = après suspension − CNS − injustifiées",
        operandes: p
          ? [
              { label: "CNS", valeur: euros(p.coutPerduCns) },
              { label: "Injustifiées", valeur: euros(p.coutPerduInjustifiees) },
              { label: "Payé", valeur: euros(p.apresInjustifiees) },
            ]
          : undefined,
        details: [
          {
            titre: "Salarié par salarié quand le fichier existe",
            points: [
              "Sur un mois qui a son fichier d'absences, chaque absence est valorisée au coût du salarié concerné : une absence CNS pèse son pourcentage d'absence × son coût disponible ; une absence en heures pèse ses heures / heures travaillables × son coût plein temps. Un absent bien payé coûte plus qu'un absent au salaire minimum.",
              "Sur un mois sans fichier, le taux repris (le même que la courbe des effectifs) s'applique au coût net : le point est reporté.",
            ],
          },
        ],
      },
      {
        cle: "cout-mct",
        titre: "Coût des absences payées (MCT)",
        definition: "Les maladies non prises en charge sont payées par l'employeur : leur coût sort du disponible sans sortir du payé. Chaque heure d'absence est valorisée au coût employeur d'un ETP du salarié concerné.",
        valeur: p ? euros(p.coutPerduMct) : undefined,
        formule: "MCT = Σ (heures MCT du salarié / heures travaillables du mois) × brut plein temps du salarié × coefficient ; disponible = payé − MCT",
        operandes: p
          ? [
              { label: "Heures MCT retenues", valeur: `${nf(p.heures.mct.heures, 1)} h (${nf(p.heures.mct.lignes, 0)} lignes)` },
              { label: "Heures travaillables", valeur: `${nf(p.heures.travaillables, 0)} h` },
              { label: "ETP équivalents", valeur: etp(p.heures.mct.etp) },
              { label: "Coût moyen par ETP appliqué", valeur: p.heures.mct.etp > 0 ? euros(p.heures.mct.coutEtpApplique) : "—" },
              { label: "MCT", valeur: euros(p.coutPerduMct) },
              { label: "Payé", valeur: euros(p.apresInjustifiees) },
              { label: "Disponible", valeur: euros(p.apresMct) },
            ]
          : undefined,
        valeurNote: p && p.heures.mct.lignesAuRepli > 0 ? `${nf(p.heures.mct.lignesAuRepli, 0)} ligne${p.heures.mct.lignesAuRepli > 1 ? "s" : ""} valorisée${p.heures.mct.lignesAuRepli > 1 ? "s" : ""} au coût moyen par ETP du mois (salarié sans brut connu)` : undefined,
        details: [
          {
            titre: "Les heures retenues",
            points: [
              "Les lignes MCT du mois affiché, hors week-end (les heures travaillables ne comptent que du lundi au vendredi), restreintes aux salariés actifs en fin de mois dans la photo roster du périmètre. Un salarié en MCT sorti avant la fin du mois n'y figure pas.",
              "Heures travaillables = jours ouvrés du mois (fériés luxembourgeois exclus) × 8 h. Une absence de 8 h vaut 1 / jours ouvrés d'ETP-mois.",
            ],
          },
          {
            titre: "Un coût par salarié, pas un taux moyen",
            points: [
              "Chaque fraction d'ETP est valorisée au brut plein temps du salarié (brut indice du roster) × coefficient de charges (celui de son cost center quand la paie le donne, sinon le global). Un absent bien payé pèse plus qu'un absent au salaire minimum ; le « coût moyen par ETP appliqué » ci-dessus est le résultat de cette pondération, pas une entrée.",
              "Ce coût vient du contractuel (roster), pas de la paie réelle : la Liste des salaires ne porte pas les heures d'absence et ne change rien ici.",
            ],
          },
          {
            titre: "Pourquoi ce palier vient après le payé",
            points: [
              "C'est l'ordre de la chaîne des effectifs : un salarié en MCT reste payé (la mutuelle rembourse ensuite en partie). Le disponible en euros est donc une lecture de capacité, pas un décaissement.",
            ],
          },
        ],
      },
      {
        cle: "cout-realise",
        titre: "Réalisé du mois (coût employeur de la paie)",
        definition: "La paie effective du mois telle que la paie la donne : coût employeur (Liste des salaires : total brut + charges patronales − avantages en nature ; Statistiques rapides : total brut + charges patronales), toutes absences déjà déduites, suppléments et heures supplémentaires compris. Les rémunérations non périodiques (soldes de sortie) y sont comprises.",
        valeur: c ? (c.realise.mesure ? euros(c.realise.employeur) : "aucun montant importé") : undefined,
        valeurNote: c && !c.realise.mesure && c.realise.n > 0 ? `${nf(c.realise.n, 0)} lignes présentes mais sans salaire` : undefined,
        formule: "réalisé = Σ (Total brut + charges patronales) des lignes du mois (périmètre filtré : salariés de la photo) ; sans charges patronales importées : Σ Total brut × coefficient, marqué estimé",
        operandes: c?.realise.mesure
          ? [
              { label: "Total brut", valeur: euros(c.realise.brut) },
              { label: "Coût employeur", valeur: euros(c.realise.employeur) },
              { label: "Lignes", valeur: nf(c.realise.n, 0) },
            ]
          : undefined,
        details: [
          {
            titre: "Ce que contient chaque case de la carte « Paie réalisée »",
            points: [
              "Brut base : colonne « Brut base » de la paie — le salaire de base du mois, déjà proratisé par le temps payé (« Tâche en % ») et par les entrées et sorties en cours de mois. C'est le pendant réel du brut indice × taux d'occupation du roster.",
              "Suppléments : tout ce qui s'ajoute au brut de base pour former le total brut, c'est-à-dire la somme des natures de paie (voir la liste ci-dessous). Avec les Statistiques rapides, c'est la colonne « Suppléments » du fichier, non détaillée.",
              "Total brut : brut base + suppléments, colonne « Total brut » de la paie. Les retenues pour absence injustifiée et congés trop pris y sont déjà déduites (natures négatives).",
              "CM patronale : caisse maladie, part employeur — « CM Patr. soins » + « CM Patr. espèces ». CP patronale : caisse de pension, part employeur. Assurance accident, Santé au travail, Mutualité, Autres cotisations patronales : les colonnes du même nom.",
              "Charges patronales : la somme des cotisations patronales ci-dessus. Les cotisations SALARIALES (CM/CP salariales, assurance dépendance), l'impôt et le net ne sont pas importés : ils ne changent pas ce que l'employeur décaisse.",
              "Avantages en nature (déduits) : ce que la paie retire du brut chargé pour obtenir son coût — voiture de fonction et compléments valorisés dans le brut pour l'impôt mais qui ne sont pas un décaissement de salaire. Calculé comme total brut + charges patronales − coût natures déduites.",
              "Soldes de sortie : les lignes « Rémun. np » (période 13 du SIRH), en pratique le décompte de congés versé à la sortie. Comptées dans le coût employeur réalisé (elles sont décaissées ce mois) mais données à part, hors masse salariale courante et hors coefficient.",
              "Coût employeur réalisé : colonne « Coût natures déduites » de la paie = total brut + charges patronales − avantages en nature. « Hors soldes de sortie » retire les lignes non périodiques.",
              "Coefficient réel du mois : coût employeur réalisé / total brut, soldes compris — à comparer au coefficient de charges appliqué au contractuel.",
              "Écart réalisé − payé contractuel : ce que le contractuel (brut indice × ETP × coefficient, absences non payées retirées) ne modélise pas — suppléments et heures supplémentaires, prorata des entrées et sorties en cours de mois, régularisations, soldes de sortie, écart entre brut indice et brut réellement payé.",
            ],
          },
          {
            titre: "Les natures de paie qui composent les suppléments, par famille",
            points: FAMILLES.map((f) => {
              const natures = NATURES.filter((n) => n.famille === f.id).map((n) => (n.codes.length > 0 ? `${n.codes.join(" / ")} (${n.libelle})` : n.libelle)).join(", ");
              return `${f.libelle} — ${f.description} Natures : ${natures}.${f.id === "structurel" ? " Le brut de base compte aussi dans cette famille." : ""}`;
            }),
          },
          {
            titre: "Une 6e courbe, pas un palier",
            points: [
              "Le réalisé ne se découpe pas en paliers : il intègre déjà toutes les absences, les suppléments et les heures supplémentaires. Il est tracé à part, en gris, sur les seuls mois qui portent des montants.",
              "L'écart entre réalisé et payé contractuel se lit sur la carte : il mesure ce que le contractuel ne modélise pas (suppléments, heures supplémentaires, chômage partiel, régularisations).",
            ],
          },
        ],
        source: "Table wp_salary_lines (Liste des salaires : brut par nature, cotisations patronales, coût employeur) quand le mois y est, sinon wp_salary_stats (Statistiques rapides).",
      },
      {
        cle: "cout-moyen-etp",
        titre: "Coût moyen par ETP",
        definition: "Le coût employeur d'un équivalent temps plein, sur le périmètre et le mois affichés, compléments récurrents compris.",
        valeur: p ? euros(p.coutMoyenEtp) : undefined,
        formule: "coût moyen par ETP = coût sous contrat / Σ ETP sous contrat",
        details: [
          {
            titre: "Le coût moyen qui valorise une hypothèse de scénario",
            points: [
              "Une embauche, un départ ou une suspension d'hypothèse n'a pas de salaire : elle est valorisée au coût moyen des salariés comparables, par une chaîne de repli à sept niveaux — même cost center et même profil (fonction + CDI/CDD), même dépôt et même profil, toute l'entreprise et même profil, puis même cost center et même fonction, toute l'entreprise et même fonction, toute l'entreprise, enfin le coût moyen du périmètre.",
              "Le niveau atteint est affiché avec l'hypothèse : un chauffeur de bus n'est jamais valorisé au tarif d'un chef de service.",
            ],
          },
        ],
        source: "lib/utils/wp-cout-moyen.ts.",
      },
      {
        cle: "masse-annuelle",
        titre: "Masse salariale annuelle sous contrat",
        definition: "La somme des douze coûts mensuels sous contrat, mois mesurés et mois reportés confondus.",
        details: [
          {
            titre: "Lecture",
            points: [
              "Chaque mois se lit dans sa photo de roster, reconduite à défaut ; un mois reporté est signalé. Ce n'est pas un budget : les mois à venir prolongent le dernier connu, sans hausse ni scénario, sauf sur la courbe quand un scénario est affiché.",
            ],
          },
        ],
      },
      {
        cle: "leviers-cout",
        titre: "Leviers de coût d'un scénario",
        definition: "Un scénario porte, en plus de ses hypothèses d'effectifs, des leviers qui modifient les salaires ou les charges à partir d'un mois donné.",
        details: [
          {
            titre: "Les cinq leviers",
            points: [
              "Indexation et augmentation générale : +X % sur les bruts à partir d'un mois d'effet ; plusieurs tranches se cumulent en se multipliant. Les tranches antérieures au premier mois projeté sont ignorées : le brut de la photo les porte déjà.",
              "Salaire social minimum : un nouveau seuil plein temps à partir d'un mois ; chaque salarié dont le brut plein temps est sous ce seuil est relevé au seuil (× son taux d'occupation). Un seuil est lui-même relevé par les indexations postérieures à son effet.",
              "Coefficient de charges forcé : remplace le coefficient calculé à partir de son mois d'effet.",
              "Primes et suppléments ponctuels : un montant global, ou par ETP payé, sur un mois donné, ajouté à tous les paliers du mois (une prime est payée quelle que soit l'absence).",
              "Chaque levier est global ou propre à un cost center. Quand plusieurs scénarios sont combinés, les hausses et primes s'additionnent ; le seuil et le coefficient viennent du scénario choisi comme source « Coûts », comme les taux de turnover, d'absentéisme et de congés.",
            ],
          },
        ],
        source: "Table wp_scenario_cost_params ; lib/utils/wp-leviers-cout.ts.",
      },
    ],
  };
}

