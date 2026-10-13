/**
 * Plan d'un deck d'analyse : ce que l'IA produit (structured output) et ce
 * que `render-deck.ts` transforme en PowerPoint à la charte SLG. Le deck est
 * en anglais ; les chiffres n'y entrent que par ces champs typés, chacun
 * rattaché aux outils qui l'ont produit (`sources`), pour pouvoir vérifier
 * qu'aucune valeur n'a été inventée.
 */

import { z } from "zod/v4";

const Sources = z.array(z.string()).describe("Names of the analysis tools whose output backs this slide.");
const Notes = z.string().optional().describe("Speaker notes: method, definitions, caveats.");

/** Titre façon charte : « OUR [LOGO] » — le second segment est posé sur l'aplat vert. */
const Titre = {
  title: z.string().describe("Uppercase-friendly lead words, e.g. 'LONG DAYS'."),
  highlight: z.string().optional().describe("Words shown on the green brand block, e.g. 'BY DEPOT'."),
};

export const SlideCouverture = z.object({
  type: z.literal("cover"),
  title: z.string(),
  subtitle: z.string().optional(),
  date: z.string(),
});

export const SlideSection = z.object({
  type: z.literal("section"),
  title: z.string(),
  subtitle: z.string().optional(),
});

export const SlideKpis = z.object({
  type: z.literal("kpis"),
  ...Titre,
  items: z.array(z.object({ label: z.string(), value: z.string(), note: z.string().optional() })).min(1).max(4),
  commentary: z.string().optional(),
  sources: Sources,
  notes: Notes,
});

export const SlideBarres = z.object({
  type: z.literal("bar_chart"),
  ...Titre,
  categories: z.array(z.string()).min(1),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).min(1).max(4),
  stacked: z.boolean().optional(),
  /** Trait de référence (moyenne du périmètre…), tracé sur toute la largeur. */
  reference: z.object({ label: z.string(), value: z.number() }).optional(),
  valueFormat: z.enum(["integer", "one_decimal", "two_decimals", "percent"]).default("one_decimal"),
  axisTitle: z.string().optional(),
  commentary: z.string().optional(),
  sources: Sources,
  notes: Notes,
});

export const SlideTableau = z.object({
  type: z.literal("table"),
  ...Titre,
  columns: z.array(z.string()).min(2),
  rows: z.array(z.array(z.string())).min(1),
  /** Lignes mises en avant (index 0-based), ex. la ligne « Average ». */
  emphasisRows: z.array(z.number()).optional(),
  commentary: z.string().optional(),
  sources: Sources,
  notes: Notes,
});

export const SlideConstats = z.object({
  type: z.literal("findings"),
  ...Titre,
  items: z.array(z.object({ headline: z.string(), detail: z.string() })).min(1).max(5),
  sources: Sources,
  notes: Notes,
});

/** Obligatoire : ce que les données ne montrent pas, et pourquoi. */
export const SlideLimites = z.object({
  type: z.literal("limits"),
  ...Titre,
  items: z.array(z.string()).min(1).max(6),
  notes: Notes,
});

export const Slide = z.discriminatedUnion("type", [SlideCouverture, SlideSection, SlideKpis, SlideBarres, SlideTableau, SlideConstats, SlideLimites]);

/** Forme brute : sert de schéma d'entrée à l'outil `submit_deck` (un schéma JSON ne porte pas de `refine`). */
export const DeckSpecBase = z.object({
  /** Bandeau supérieur de chaque page : « SLG DRIVER ANALYTICS / <topic> ». */
  topic: z.string().describe("Short topic shown in every slide header, e.g. 'Schedule hardship'."),
  slides: z.array(Slide).min(3),
});

export const DeckSpec = DeckSpecBase.refine((d) => d.slides.some((s) => s.type === "limits"), { message: "A deck must include a 'limits' slide." });

export type DeckSpec = z.infer<typeof DeckSpec>;
export type Slide = z.infer<typeof Slide>;
