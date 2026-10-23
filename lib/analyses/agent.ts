/**
 * Analyste IA : une question en langage naturel → un DeckSpec vérifié.
 *
 * Claude (Opus 5.5) ne voit QUE les sorties agrégées des outils de
 * `outils.ts` ; il les choisit, raisonne et rédige, puis soumet le deck par
 * `submit_deck`. La soumission est refusée tant qu'un nombre du deck ne se
 * retrouve pas dans les sorties (`verification.ts`) ou que la slide
 * « limits » manque — l'IA corrige et resoumet.
 */

import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { DeckSpec, DeckSpecBase } from "./deck-spec";
import type { DonneesAnalyse } from "./donnees";
import * as o from "./outils";
import * as w from "./outils-workforce";
import * as k from "./outils-couts";
import * as sc from "./outils-scenarios";
import { verifierNombres } from "./verification";

export const MODELE = "claude-opus-5-5";
/** $ par million de jetons (Opus 5.5) : entrée, sortie, lecture et écriture de cache. */
const TARIF = { entree: 4, sortie: 20, cacheLu: 0.2, cacheEcrit: 5 };

const CONSIGNES = `You are a senior workforce analyst at SLG, a Luxembourg bus and van transport company. Managers ask you questions about driver workload and schedule hardship, and about workforce planning (headcount, movements, absences, payroll costs, interim, forecast scenarios and staffing targets); you answer with a short, rigorous PowerPoint deck in ENGLISH, whatever the language of the question.

How you work:
- Start with data_coverage to learn which months and periods exist, then call the tools the question needs. Prefer the most recent complete month or period unless the user names one.
- You never compute numbers yourself. Every figure you write (in charts, tables, KPIs, commentary, findings) must be copied from a tool output — per-driver ratios, shares and deviations from the average are already computed for you. Round only to the precision shown. If a figure you want does not exist in any output, rephrase without it.
- Compare depots per driver (not in totals) and always show the overall average as the reference (bar_chart.reference).
- "The average does not tell everything": use workload_concentration to show whether the load sits on a few drivers (median vs mean, top-10% share, Gini, recurrence of the same drivers in the top).
- Cross-check hardship signals with absenteeism and turnover by depot when the question is about hardship or well-being; say clearly when they do NOT line up.
- Be balanced. The user may want to "support an impression": look for disconfirming evidence too and report it. Never overstate causality — these are correlations on payroll data.
- Workforce Planning questions: use the workforce_*, interim_costs, scenario_projection and gap_to_target tools. Their figures are those of the Workforce screens. Always state the scope (all employees by default, or drivers only with scope "drivers"), and say clearly which months are actual and which are projected or carried over. A projection is not a forecast of certainty: present it as "if the scenario's assumptions hold".
- Costs are payroll aggregates: never estimate an individual salary, and keep the groups as the tools give them.
- Privacy: outputs are aggregated; never try to identify individual drivers and never suggest naming them.

Deck rules:
- 6 to 10 slides: cover, key figures (kpis), then the analysis (bar_chart / table), findings, and a mandatory "limits" slide ("What the data does not show") listing the known limits that matter for this question.
- Titles are short; put the second part in "highlight" (shown on the green brand block), e.g. title "LONG DAYS", highlight "PER DRIVER".
- Commentary: 1 to 3 sentences, factual, with the key number. Use "sources" to list the tools behind each slide and "notes" for definitions.
- Depot names as given by the tools. Dates in English ("Jul 2026", "P2 2026 (May–Aug)").

When the deck is ready, call submit_deck. If it is rejected, fix exactly what is listed and submit again. After it is accepted, reply with a 3 to 5 sentence summary of the main findings, in the language of the user's question.

Revisions: when the request comes with a current deck, the user is giving feedback on it. Slides are numbered from 1 in the order of the JSON. Apply ONLY the requested changes and keep every other slide identical (same order, wording and numbers). Reuse the tool outputs already provided; call a tool only if the feedback needs data they do not contain. Then submit the complete updated deck, and reply with 1 to 3 sentences describing what you changed, in the language of the user's request.`;

export interface Usage {
  entree: number;
  sortie: number;
  cacheLu: number;
  cacheEcrit: number;
  coutUsd: number;
}

/** Un appel d'outil et sa sortie (agrégée) : conservé pour les retouches et la vérification. */
export interface SortieOutil {
  outil: string;
  entree: unknown;
  sortie: unknown;
}

export interface ResultatAnalyse {
  deck: DeckSpec | null;
  resume: string;
  usage: Usage;
  outilsAppeles: string[];
  /** Sorties de cette analyse ET des versions précédentes : la base des retouches suivantes. */
  sorties: SortieOutil[];
}

export interface Tour {
  question: string;
  resume: string;
}

/** Le deck avec un numéro explicite par slide, pour que « slide 3 » désigne la même chose pour l'IA et l'utilisateur. */
function numeroter(deck: DeckSpec) {
  return { topic: deck.topic, slides: deck.slides.map((s, i) => ({ slide_number: i + 1, ...s })) };
}

export async function analyser(params: {
  question: string;
  donnees: DonneesAnalyse;
  /** Échanges précédents du même fil, pour les demandes de retouche. */
  historique?: Tour[];
  /** Deck de la version précédente et sorties d'outils déjà calculées : la demande est alors une retouche. */
  precedent?: { deck: DeckSpec; sorties: SortieOutil[]; version: number };
  client?: Anthropic;
  /** Appelé à chaque outil exécuté : progression affichée dans le chat. */
  surProgression?: (etape: string) => void | Promise<void>;
  maintenant?: Date;
}): Promise<ResultatAnalyse> {
  const { donnees: d, surProgression } = params;
  // Clé non rattachée à un workspace : l'API exige alors l'en-tête anthropic-workspace-id
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID;
  const client = params.client ?? new Anthropic(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {});
  const maintenant = params.maintenant ?? new Date();
  const sorties: SortieOutil[] = [...(params.precedent?.sorties ?? [])];
  const outilsAppeles: string[] = [];
  let deckAccepte: DeckSpec | null = null;

  /** Chaque outil : exécuter, garder la sortie pour la vérification, la rendre en JSON. */
  const outil = <S extends z.ZodType>(name: string, description: string, inputSchema: S, f: (p: z.infer<S>) => unknown | Promise<unknown>) =>
    betaZodTool({
      name,
      description,
      inputSchema,
      run: async (p) => {
        outilsAppeles.push(name);
        await surProgression?.(name);
        const sortie = await f(p);
        sorties.push({ outil: name, entree: p, sortie });
        return JSON.stringify(sortie);
      },
    });

  const annee = z.number().int().min(2020).max(2100);
  const mois = z.number().int().min(1).max(12);
  const perimetre = z.enum(["all", "drivers"]).optional().describe("all (default) = every employee, as on the Workforce screens; drivers = drivers only");
  const outils = [
    outil("data_coverage", "Which months, reference periods and years are available, plus the known limits of the data. Call first.", z.object({}), () => o.couvertureDonnees(d, maintenant)),
    outil("long_days_by_depot", "Long working days (11 to 12 h and over 12 h, from payroll premiums) for one ACTIVITY month: overall and per depot, per driver, with deviation from the average.", z.object({ activity_year: annee, activity_month: z.number().int().min(1).max(12) }), (p) => o.journeesLonguesParDepot(d, p)),
    outil("long_days_trend", "Long working days per activity month for every month with payroll data.", z.object({}), () => o.tendanceJourneesLongues(d)),
    outil("extra_days_by_depot", "Extra working days (6th days, paid 80 EUR/day after each reference period) for one period (1 = Jan-Apr, 2 = May-Aug, 3 = Sep-Dec): overall and per depot, per driver, with deviation from the average.", z.object({ year: annee, period: z.number().int().min(1).max(3) }), (p) => o.sixiemesJoursParDepot(d, p)),
    outil("extra_days_trend", "Extra working days for every reference period with payroll data.", z.object({}), () => o.tendanceSixiemesJours(d)),
    outil("hours_by_depot", "Drivers' hours file for one month: positive hours, overtime paid and missing hours per driver, per depot.", z.object({ year: annee, month: z.number().int().min(1).max(12) }), (p) => o.heuresParDepot(d, p)),
    outil("workload_concentration", "Is the load spread or concentrated on a few drivers? Mean vs median, p90, top-10%/20% share, Gini, deciles, drivers above a threshold, and whether the top-10% drivers were already top in the previous month/period. month_or_period = activity month (long_days, positive_hours) or reference period 1-3 (extra_days).", z.object({ indicator: z.enum(["long_days", "extra_days", "positive_hours"]), year: annee, month_or_period: z.number().int().min(1).max(12), threshold: z.number().optional(), by_depot: z.boolean().optional() }), (p) => o.concentrationCharge(d, p)),
    outil("absenteeism_by_depot", "Absence rates for a year (CNS sick leave, short sick leave MCT, unjustified, total) overall and per depot (depots of 10+ FTE only).", z.object({ year: annee }), (p) => o.absenteismeParDepot(d, p, maintenant)),
    outil("turnover_by_depot", "Exit rates for a year (excluding end of temporary assignments; voluntary / involuntary) overall and per depot (10+ FTE only).", z.object({ year: annee }), (p) => o.departsParDepot(d, p, maintenant)),
    outil("absence_turnover_monthly_trend", "Month-by-month absence rates (CNS, MCT, unjustified, total) and turnover (rate, voluntary / involuntary exits in FTE) for several years, company-wide. Use it for seasonality and multi-year trends; omit years to get every available year.", z.object({ years: z.array(annee).optional() }), (p) => o.tendanceAbsenteismeDeparts(d, p, maintenant)),
    outil("workforce_headcount_trend", "Workforce Planning: month-end FTE chain for the 12 months of a year (under contract, after suspensions, after CNS sick leave, paid, available after short sick leave, after holidays), actual vs projected months, and the absence rates applied. Same figures as the Workforce dashboard curve.", z.object({ year: annee, scope: perimetre }), (p) => w.courbeEffectifs(d, p, maintenant)),
    outil("workforce_headcount_by_depot", "Workforce Planning: FTE per depot for one month (headcount, under contract, suspended, paid, available, after holidays, BUS/van FTE) and absence rates per depot (10+ FTE only), with the company total of the dashboard.", z.object({ year: annee, month: mois, scope: perimetre }), (p) => w.effectifsParDepot(d, p, maintenant)),
    outil("workforce_movements", "Workforce Planning: month-by-month entries, exits, ends of temporary assignments, new contract suspensions and returns (people and FTE) for a year; suspensions in progress by category; exits, returns and hires already known for the next 12 months.", z.object({ year: annee, scope: perimetre }), (p) => w.mouvementsEffectifs(d, p, maintenant)),
    outil("workforce_costs_trend", "Workforce costs for a year, month by month: contractual employer cost along the FTE chain (under contract, after suspensions, after sick leave, paid, available), average cost per FTE, actual payroll employer cost, annual contractual payroll, pay families per month and year-to-date pay items (overtime, long-day premiums, 6th days...). Same figures as the Costs screen.", z.object({ year: annee, scope: perimetre }), (p) => k.coutsTendance(d, p, maintenant)),
    outil("workforce_costs_by_depot", "Payroll of one month by depot and by driver function: gross paid, planning-related pay and its share, per-employee averages (groups of 10+ employees; smaller groups merged).", z.object({ year: annee, month: mois, scope: perimetre }), (p) => k.coutsParDepot(d, p, maintenant)),
    outil("interim_costs", "Interim workers (SLG Intérim): billed cost, hours, FTE and number of workers per month for a year (or one month), by depot and by cost component.", z.object({ year: annee, month: mois.optional() }), (p) => k.coutsInterim(d, p)),
    outil("scenario_projection", "Workforce Planning forecast: projects one forecast scenario (default scenario if scenario_id is omitted; the output lists the others) over the remaining months of a year, company-wide: FTE chain, drivers of change (turnover, departures, hires, returns, suspensions), rates applied, projected cost and cost per FTE, and the same months without scenario for comparison.", z.object({ year: annee, scenario_id: z.string().optional() }), (p) => sc.projectionScenario(d, p, maintenant)),
    outil("gap_to_target", "Workforce Planning: gap between FTE after suspensions and a dated target scenario (needs by depot and month), month by month, with the FTE to hire; actual months on the depots that have a target, future months from a forecast scenario when the target covers the whole company; per-depot gap on the latest actual month. Lists target scenarios when none exists for the year.", z.object({ year: annee, target_scenario_id: z.string().optional(), projection_scenario_id: z.string().optional() }), (p) => sc.ecartALaCible(d, p, maintenant)),
    betaZodTool({
      name: "submit_deck",
      description: "Submit the finished deck. It is checked: every number must come from a tool output, and a 'limits' slide is required. If rejected, fix the listed issues and submit again.",
      inputSchema: DeckSpecBase,
      run: async (deck) => {
        await surProgression?.("submit_deck");
        const forme = DeckSpec.safeParse(deck);
        if (!forme.success) return `REJECTED — invalid deck: ${forme.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
        const ecarts = verifierNombres(forme.data, sorties.map((x) => x.sortie));
        if (ecarts.length > 0) {
          return `REJECTED — these numbers are not in any tool output (copy them from the outputs, or remove them):\n${ecarts.map((e) => `- slide ${e.slide}, ${e.champ}: ${e.nombre}`).join("\n")}`;
        }
        deckAccepte = forme.data;
        return "ACCEPTED. Now write the short summary for the user.";
      },
    }),
  ];

  const echanges = params.historique?.length
    ? `Earlier in this conversation:\n${params.historique.map((t, i) => `${i + 1}. Request: ${t.question}\n   Your reply: ${t.resume}`).join("\n")}\n\n`
    : "";
  const contexte = params.precedent
    ? `${echanges}Current deck (version ${params.precedent.version}), slides numbered from 1:\n${JSON.stringify(numeroter(params.precedent.deck))}\n\nTool outputs already computed (cite these numbers; call a tool only for data they do not contain):\n${JSON.stringify(params.precedent.sorties)}\n\nUser feedback on this deck:\n`
    : echanges
      ? `${echanges}New request (build a complete new deck that takes it into account):\n`
      : "";

  const runner = client.beta.messages.toolRunner({
    model: MODELE,
    max_tokens: 16000,
    max_iterations: 25,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: CONSIGNES,
    tools: outils,
    messages: [{ role: "user", content: `${contexte}${params.question}` }],
  });

  const usage: Usage = { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0, coutUsd: 0 };
  let dernier: Anthropic.Beta.BetaMessage | null = null;
  for await (const message of runner) {
    dernier = message;
    usage.entree += message.usage.input_tokens;
    usage.sortie += message.usage.output_tokens;
    usage.cacheLu += message.usage.cache_read_input_tokens ?? 0;
    usage.cacheEcrit += message.usage.cache_creation_input_tokens ?? 0;
  }
  usage.coutUsd = Math.round(((usage.entree * TARIF.entree + usage.sortie * TARIF.sortie + usage.cacheLu * TARIF.cacheLu + usage.cacheEcrit * TARIF.cacheEcrit) / 1e6) * 100) / 100;

  if (dernier?.stop_reason === "refusal") throw new Error("La demande a été refusée par le modèle.");
  const resume = (dernier?.content ?? [])
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { deck: deckAccepte, resume, usage, outilsAppeles, sorties };
}
