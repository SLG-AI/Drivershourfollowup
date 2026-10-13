/**
 * Garde-fou de l'analyste IA : chaque nombre du deck doit se retrouver dans
 * les sorties des outils de la session. Un nombre introuvable (inventé,
 * recalculé, mal arrondi) est renvoyé à l'IA, qui doit corriger avant que le
 * deck ne soit rendu.
 *
 * Tolérances : l'arrondi d'affichage (4,08 ↔ 4.0833, « 66% » ↔ 65.9), les
 * séparateurs de milliers (« 3,076 »), les signes (« −79% » ↔ -79). Sont
 * ignorés : années, numéros de période et de décile (« P2 », « D10 »), les
 * entiers de 0 à 12 (mois, rangs, « top 10 »), et les 11 h / 12 h des
 * définitions.
 */

import type { DeckSpec } from "./deck-spec";

/** Tous les nombres présents dans les sorties d'outils (récursif). */
export function nombresDesSorties(sorties: unknown[]): number[] {
  const res: number[] = [];
  const parcourir = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) res.push(v);
    else if (Array.isArray(v)) v.forEach(parcourir);
    else if (v && typeof v === "object") Object.values(v).forEach(parcourir);
  };
  sorties.forEach(parcourir);
  return res;
}

const EXPR_NOMBRE = /[−-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[−-]?\d+(?:\.\d+)?/g;

/** Nombres cités dans un texte, sans les années ni les identifiants. */
export function nombresDuTexte(texte: string): { brut: string; valeur: number; decimales: number }[] {
  const nettoye = texte
    .replace(/\b[PDQ]\d+\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b1[12]\s?h\b/gi, " ");
  return [...nettoye.matchAll(EXPR_NOMBRE)].map((m) => {
    const brut = m[0];
    const normal = brut.replace("−", "-").replace(/,/g, "");
    return { brut, valeur: Number(normal), decimales: normal.includes(".") ? normal.split(".")[1].length : 0 };
  }).filter((n) => !(Number.isInteger(n.valeur) && Math.abs(n.valeur) <= 12));
}

/** Le nombre cité correspond-il à une sortie, à l'arrondi d'affichage près ? */
function retrouve(cite: { valeur: number; decimales: number }, sources: number[]): boolean {
  const tol = 0.5 * 10 ** -cite.decimales + 1e-9;
  return sources.some((s) =>
    Math.abs(s - cite.valeur) <= tol ||
    Math.abs(Math.abs(s) - Math.abs(cite.valeur)) <= tol ||
    Math.abs(s * 100 - cite.valeur) <= tol
  );
}

export interface NombreNonVerifie {
  slide: number;
  champ: string;
  nombre: string;
}

export function verifierNombres(deck: DeckSpec, sorties: unknown[]): NombreNonVerifie[] {
  const sources = nombresDesSorties(sorties);
  const ecarts: NombreNonVerifie[] = [];
  const controlerTexte = (slide: number, champ: string, texte: string | undefined) => {
    if (!texte) return;
    for (const n of nombresDuTexte(texte)) if (!retrouve(n, sources)) ecarts.push({ slide, champ, nombre: n.brut });
  };
  const controlerValeur = (slide: number, champ: string, v: number) => {
    if (Number.isInteger(v) && Math.abs(v) <= 12) return;
    const decimales = String(v).includes(".") ? String(v).split(".")[1].length : 0;
    if (!retrouve({ valeur: v, decimales }, sources)) ecarts.push({ slide, champ, nombre: String(v) });
  };

  deck.slides.forEach((s, i) => {
    const n = i + 1;
    if (s.type === "cover" || s.type === "section") return;
    controlerTexte(n, "title", `${s.title} ${s.highlight ?? ""}`);
    switch (s.type) {
      case "kpis":
        s.items.forEach((k, j) => { controlerTexte(n, `items[${j}].value`, k.value); controlerTexte(n, `items[${j}].note`, k.note); });
        controlerTexte(n, "commentary", s.commentary);
        break;
      case "bar_chart":
        s.series.forEach((serie, j) => serie.values.forEach((v, k) => controlerValeur(n, `series[${j}].values[${k}]`, v)));
        if (s.reference) controlerValeur(n, "reference", s.reference.value);
        controlerTexte(n, "commentary", s.commentary);
        break;
      case "table":
        s.rows.forEach((r, j) => r.forEach((c, k) => controlerTexte(n, `rows[${j}][${k}]`, c)));
        controlerTexte(n, "commentary", s.commentary);
        break;
      case "findings":
        s.items.forEach((it, j) => controlerTexte(n, `items[${j}]`, `${it.headline} ${it.detail}`));
        break;
      case "limits":
        s.items.forEach((t, j) => controlerTexte(n, `items[${j}]`, t));
        break;
    }
  });
  return ecarts;
}
