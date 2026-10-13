/**
 * DeckSpec → PowerPoint à la charte SLG (brand book de juillet 2020) :
 *  - Calibri, imposée pour la bureautique à la place de Metropolis ; titres
 *    en Calibri Light capitales, le second segment sur un aplat vert
 *    (« OUR [LOGO] ») ;
 *  - bleu-gris SLG 1.1 #547D93, vert SLG 1.2 #93C01F, noir ;
 *  - bandeau « SLG DRIVER ANALYTICS / TOPIC » en lettres espacées, encadré
 *    gris clair à filet pointillé, équerre verte du G en motif.
 * Les graphiques sont natifs PowerPoint : modifiables après coup.
 */

import fs from "fs";
import path from "path";
import PptxGenJS from "pptxgenjs";
import type { DeckSpec, Slide } from "./deck-spec";

export const MARQUE = {
  bleu: "547D93",
  vert: "93C01F",
  noir: "000000",
  texte: "1F2A30",
  gris: "E6EAEA",
  bleuClair: "A9BEC9",
  vertClair: "C9DE8F",
  police: "Calibri",
  policeTitre: "Calibri Light",
} as const;

const SERIES = [MARQUE.bleu, MARQUE.vert, MARQUE.bleuClair, MARQUE.vertClair];
const LARGEUR = 13.333;
const HAUTEUR = 7.5;
const MARGE = 0.6;

const FORMATS = { integer: "#,##0", one_decimal: "#,##0.0", two_decimals: "#,##0.00", percent: "0%" } as const;

function logo(nom: string): string {
  return path.join(process.cwd(), "lib", "analyses", "brand", nom);
}

/**
 * Largeur d'un texte en capitales Calibri Light, en pouces : ≈ 0,5 em par
 * caractère mesuré sur le rendu PowerPoint ; 0,56 pour l'aplat, qui doit
 * contenir son texte même avec des W et des M.
 */
const largeurTexte = (texte: string, taille: number, em = 0.5) => (texte.length * taille * em) / 72;

function bandeau(slide: PptxGenJS.Slide, topic: string) {
  slide.addText([
    { text: "SLG DRIVER ANALYTICS", options: { bold: true, color: MARQUE.texte } },
    { text: ` / ${topic.toUpperCase()}`, options: { color: "6B7B83" } },
  ], { x: MARGE, y: 0.25, w: 9, h: 0.3, fontFace: MARQUE.police, fontSize: 9, charSpacing: 3, margin: 0 });
}

function pied(slide: PptxGenJS.Slide, numero: number) {
  slide.addText(String(numero), { x: MARGE, y: HAUTEUR - 0.45, w: 0.6, h: 0.3, fontFace: MARQUE.police, fontSize: 9, color: "6B7B83", margin: 0 });
  slide.addText("Aggregated data — no individual information", { x: 1.4, y: HAUTEUR - 0.45, w: 6, h: 0.3, fontFace: MARQUE.police, fontSize: 8, color: "9AA7AD", margin: 0 });
  slide.addImage({ path: logo("slg-logo.png"), x: LARGEUR - MARGE - 0.9, y: HAUTEUR - 0.55, w: 0.9, h: 0.9 * 960 / 2120 });
}

/** « LONG DAYS [BY DEPOT] » : texte fin, puis le segment sur l'aplat vert. */
function titre(slide: PptxGenJS.Slide, s: { title: string; highlight?: string }) {
  const taille = 32;
  const debut = s.title.toUpperCase();
  const commun = { y: 0.75, h: 0.8, fontFace: MARQUE.policeTitre, fontSize: taille, color: MARQUE.noir, margin: 0, valign: "middle" as const, wrap: false };
  const w1 = Math.min(largeurTexte(debut, taille) + 0.1, LARGEUR - 2 * MARGE);
  slide.addText(debut, { ...commun, x: MARGE, w: w1 });
  if (s.highlight) {
    // L'aplat est une forme SOUS un texte réglé comme le premier segment : mêmes y, h et marges, donc même ligne de base
    const fin = s.highlight.toUpperCase();
    const pad = 0.14;
    const x = MARGE + w1 + 0.12;
    const w = largeurTexte(fin, taille, 0.56) + 2 * pad;
    slide.addShape("rect", { x, y: 0.79, w, h: 0.72, fill: { color: MARQUE.vert }, line: { color: MARQUE.vert, width: 0 } });
    slide.addText(fin, { ...commun, x: x + pad, w: w - 2 * pad });
  }
}

/** Encadré gris à filet pointillé, comme les blocs de texte du brand book. */
function encadre(slide: PptxGenJS.Slide, texte: string, y: number, h: number) {
  slide.addShape("line", { x: MARGE, y, w: LARGEUR - 2 * MARGE, h: 0, line: { color: MARQUE.bleu, width: 0.75, dashType: "sysDot" } });
  slide.addText(texte, {
    x: MARGE, y: y + 0.04, w: LARGEUR - 2 * MARGE, h, fill: { color: MARQUE.gris },
    fontFace: MARQUE.police, fontSize: 13, color: MARQUE.bleu, margin: [8, 14, 8, 14], valign: "top",
  });
}

function notesEtSources(slide: PptxGenJS.Slide, s: Slide) {
  const sources = "sources" in s && s.sources?.length ? `Sources: ${s.sources.join(", ")}.` : "";
  const notes = "notes" in s && s.notes ? s.notes : "";
  if (sources || notes) slide.addNotes([notes, sources].filter(Boolean).join("\n\n"));
}

function couverture(pptx: PptxGenJS, s: Extract<Slide, { type: "cover" }>) {
  const slide = pptx.addSlide();
  slide.background = { color: MARQUE.bleu };
  const wLogo = 3.4;
  slide.addImage({ path: logo("slg-logo-white-tagline.png"), x: (LARGEUR - wLogo) / 2, y: 1.2, w: wLogo, h: wLogo * 1300 / 2120 });
  slide.addText(s.title.toUpperCase(), { x: MARGE, y: 4.3, w: LARGEUR - 2 * MARGE, h: 0.9, fontFace: MARQUE.policeTitre, fontSize: 34, color: "FFFFFF", align: "center", margin: 0 });
  if (s.subtitle) slide.addText(s.subtitle, { x: MARGE, y: 5.2, w: LARGEUR - 2 * MARGE, h: 0.5, fontFace: MARQUE.policeTitre, fontSize: 18, color: "FFFFFF", align: "center", margin: 0 });
  slide.addText(s.date, { x: MARGE, y: 6.5, w: LARGEUR - 2 * MARGE, h: 0.4, fontFace: MARQUE.police, fontSize: 11, color: "DCE4E8", align: "center", charSpacing: 2, margin: 0 });
}

function section(pptx: PptxGenJS, s: Extract<Slide, { type: "section" }>) {
  const slide = pptx.addSlide();
  slide.background = { color: MARQUE.bleu };
  slide.addText(s.title.toUpperCase(), { x: MARGE + 0.4, y: 1.4, w: 9.5, h: 2.2, fontFace: MARQUE.policeTitre, fontSize: 44, color: "FFFFFF", valign: "top", margin: 0 });
  // L'équerre verte du G, motif du brand book
  slide.addShape("rect", { x: 10.6, y: 1.5, w: 1.3, h: 0.45, fill: { color: MARQUE.vert }, line: { color: MARQUE.vert, width: 0 } });
  slide.addShape("rect", { x: 11.45, y: 1.5, w: 0.45, h: 1.3, fill: { color: MARQUE.vert }, line: { color: MARQUE.vert, width: 0 } });
  if (s.subtitle) slide.addText(s.subtitle, { x: MARGE + 0.4, y: 5.2, w: 9, h: 1.2, fontFace: MARQUE.policeTitre, fontSize: 18, color: "FFFFFF", valign: "top", margin: 0 });
}

function kpis(pptx: PptxGenJS, s: Extract<Slide, { type: "kpis" }>, topic: string, n: number) {
  const slide = pptx.addSlide();
  bandeau(slide, topic); titre(slide, s);
  const largeur = (LARGEUR - 2 * MARGE - 0.3 * (s.items.length - 1)) / s.items.length;
  s.items.forEach((k, i) => {
    const x = MARGE + i * (largeur + 0.3);
    slide.addShape("rect", { x, y: 2.0, w: 0.08, h: 2.2, fill: { color: i % 2 === 0 ? MARQUE.bleu : MARQUE.vert }, line: { width: 0, color: "FFFFFF" } });
    slide.addText(k.label, { x: x + 0.25, y: 2.0, w: largeur - 0.3, h: 0.5, fontFace: MARQUE.police, fontSize: 13, color: "6B7B83", margin: 0, valign: "top" });
    slide.addText(k.value, { x: x + 0.25, y: 2.5, w: largeur - 0.3, h: 1.0, fontFace: MARQUE.policeTitre, fontSize: 44, color: MARQUE.bleu, margin: 0, valign: "middle" });
    if (k.note) slide.addText(k.note, { x: x + 0.25, y: 3.5, w: largeur - 0.3, h: 0.7, fontFace: MARQUE.police, fontSize: 11, color: MARQUE.texte, margin: 0, valign: "top" });
  });
  if (s.commentary) encadre(slide, s.commentary, 4.8, 1.6);
  pied(slide, n); notesEtSources(slide, s);
}

function barres(pptx: PptxGenJS, s: Extract<Slide, { type: "bar_chart" }>, topic: string, n: number) {
  const slide = pptx.addSlide();
  bandeau(slide, topic); titre(slide, s);
  const avecCommentaire = Boolean(s.commentary);
  const wGraph = avecCommentaire ? 8.4 : LARGEUR - 2 * MARGE;
  const donnees = s.series.map((serie) => ({ name: serie.name, labels: s.categories, values: serie.values }));
  const options: PptxGenJS.IChartOpts = {
    x: MARGE, y: 1.8, w: wGraph, h: 5.0,
    barDir: "col", barGrouping: s.stacked ? "stacked" : "clustered", barGapWidthPct: 60,
    chartColors: SERIES.slice(0, s.series.length),
    catAxisLabelFontFace: MARQUE.police, catAxisLabelFontSize: 10, catAxisLabelColor: MARQUE.texte,
    valAxisLabelFontFace: MARQUE.police, valAxisLabelFontSize: 10, valAxisLabelColor: "6B7B83",
    valAxisLabelFormatCode: FORMATS[s.valueFormat], valGridLine: { color: "E3E7E9", size: 0.5 }, catGridLine: { style: "none" },
    showValue: !s.stacked && !s.reference, dataLabelFormatCode: FORMATS[s.valueFormat], dataLabelFontFace: MARQUE.police, dataLabelFontSize: 9, dataLabelColor: MARQUE.texte,
    showLegend: s.series.length > 1 || Boolean(s.reference), legendPos: "b", legendFontFace: MARQUE.police, legendFontSize: 10,
    ...(s.axisTitle ? { showValAxisTitle: true, valAxisTitle: s.axisTitle, valAxisTitleFontSize: 10, valAxisTitleColor: "6B7B83" } : {}),
  };
  if (s.reference) {
    const ref = s.reference;
    // Graphique combiné : pptxgenjs lit les options en DEUXIÈME argument (`data || opt`), ses types disent `any[]`
    slide.addChart([
      // Étiquettes sur les barres seulement : sur la ligne de référence, la même valeur se répéterait à chaque catégorie
      { type: "bar", data: donnees, options: { barGrouping: s.stacked ? "stacked" : "clustered", chartColors: SERIES.slice(0, s.series.length), showValue: !s.stacked, dataLabelFormatCode: FORMATS[s.valueFormat], dataLabelFontFace: MARQUE.police, dataLabelFontSize: 9, dataLabelColor: MARQUE.texte } },
      { type: "line", data: [{ name: ref.label, labels: s.categories, values: s.categories.map(() => ref.value) }], options: { chartColors: [MARQUE.noir], lineDataSymbol: "none", lineSize: 1.5, lineDash: "dash", showValue: false } },
    ], options as unknown as unknown[]);
  } else {
    slide.addChart("bar", donnees, options);
  }
  if (avecCommentaire) {
    slide.addShape("line", { x: MARGE + wGraph + 0.3, y: 1.9, w: LARGEUR - MARGE - (MARGE + wGraph + 0.3), h: 0, line: { color: MARQUE.bleu, width: 0.75, dashType: "sysDot" } });
    slide.addText(s.commentary!, {
      x: MARGE + wGraph + 0.3, y: 1.95, w: LARGEUR - MARGE - (MARGE + wGraph + 0.3), h: 4.7, fill: { color: MARQUE.gris },
      fontFace: MARQUE.police, fontSize: 13, color: MARQUE.bleu, margin: [10, 12, 10, 12], valign: "top",
    });
  }
  pied(slide, n); notesEtSources(slide, s);
}

function tableau(pptx: PptxGenJS, s: Extract<Slide, { type: "table" }>, topic: string, n: number) {
  const slide = pptx.addSlide();
  bandeau(slide, topic); titre(slide, s);
  const emphase = new Set(s.emphasisRows ?? []);
  const entete = s.columns.map((c, i) => ({ text: c, options: { bold: true, color: "FFFFFF", fill: { color: MARQUE.bleu }, align: (i === 0 ? "left" : "right") as "left" | "right" } }));
  const lignes = s.rows.map((r, ri) => r.map((cell, i) => ({
    text: cell,
    options: {
      align: (i === 0 ? "left" : "right") as "left" | "right",
      bold: emphase.has(ri),
      fill: { color: emphase.has(ri) ? MARQUE.gris : ri % 2 === 0 ? "FFFFFF" : "F5F7F7" },
    },
  })));
  const hTableau = Math.min(4.6, 0.36 * (s.rows.length + 1));
  slide.addTable([entete, ...lignes], {
    x: MARGE, y: 1.85, w: LARGEUR - 2 * MARGE, fontFace: MARQUE.police, fontSize: 11, color: MARQUE.texte,
    border: { type: "solid", pt: 0.5, color: "D5DCDF" }, rowH: 0.34, autoPage: false,
  });
  if (s.commentary) encadre(slide, s.commentary, Math.min(6.0, 1.95 + hTableau + 0.2), 0.9);
  pied(slide, n); notesEtSources(slide, s);
}

function liste(pptx: PptxGenJS, s: Extract<Slide, { type: "findings" | "limits" }>, topic: string, n: number) {
  const slide = pptx.addSlide();
  bandeau(slide, topic); titre(slide, s);
  const elements = s.type === "findings" ? s.items : s.items.map((t) => ({ headline: "", detail: t }));
  const pas = Math.min(1.0, 4.9 / elements.length);
  elements.forEach((e, i) => {
    const y = 1.9 + i * pas;
    slide.addShape("rect", { x: MARGE, y: y + 0.08, w: 0.22, h: 0.22, fill: { color: s.type === "limits" ? MARQUE.bleu : MARQUE.vert }, line: { width: 0, color: "FFFFFF" } });
    slide.addText([
      ...(e.headline ? [{ text: `${e.headline}  `, options: { bold: true, color: MARQUE.texte } }] : []),
      { text: e.detail, options: { color: MARQUE.texte } },
    ], { x: MARGE + 0.45, y, w: LARGEUR - 2 * MARGE - 0.45, h: pas - 0.05, fontFace: MARQUE.police, fontSize: 14, valign: "top", margin: 0 });
  });
  pied(slide, n); notesEtSources(slide, s);
}

export async function renderDeck(spec: DeckSpec): Promise<Buffer> {
  for (const f of ["slg-logo.png", "slg-logo-white-tagline.png"]) {
    if (!fs.existsSync(logo(f))) throw new Error(`Logo manquant : ${logo(f)}`);
  }
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.company = "SLG";
  pptx.title = spec.slides.find((s) => s.type === "cover")?.title ?? spec.topic;
  pptx.theme = { headFontFace: MARQUE.policeTitre, bodyFontFace: MARQUE.police };
  let numero = 0;
  for (const s of spec.slides) {
    numero += 1;
    switch (s.type) {
      case "cover": couverture(pptx, s); break;
      case "section": section(pptx, s); break;
      case "kpis": kpis(pptx, s, spec.topic, numero); break;
      case "bar_chart": barres(pptx, s, spec.topic, numero); break;
      case "table": tableau(pptx, s, spec.topic, numero); break;
      case "findings":
      case "limits": liste(pptx, s, spec.topic, numero); break;
    }
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
