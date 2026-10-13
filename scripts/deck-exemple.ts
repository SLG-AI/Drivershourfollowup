/**
 * Deck d'exemple statique (étape 1 du plan) : valide la charte avant toute IA.
 * Chiffres réels calculés le 13/10/2026 sur la base locale — paie d'août 2026
 * (activité de juillet) pour les amplitudes, P2 2026 pour les 6e jours.
 * Usage : npx tsx scripts/deck-exemple.ts <sortie.pptx>
 */
import fs from "fs";
import { DeckSpec } from "../lib/analyses/deck-spec";
import { renderDeck } from "../lib/analyses/render-deck";

const depots = ["Allerborn", "Bascharage & Bertrange", "Koetschette", "Esch & Aubange", "Mersch", "Merl & Strassen", "Findel, Munsbach & Sandweiler", "Hosingen"];

const spec = DeckSpec.parse({
  topic: "Schedule hardship",
  slides: [
    { type: "cover", title: "Schedule hardship", subtitle: "What payroll data says about long days and extra working days", date: "OCTOBER 2026 — SAMPLE DECK" },
    {
      type: "kpis", title: "Key", highlight: "figures",
      items: [
        { label: "Long days (> 11 h) in July", value: "3,076", note: "2,071 between 11 and 12 h, 1,005 over 12 h" },
        { label: "Drivers with at least one", value: "56%", note: "698 of 1,250 drivers paid" },
        { label: "Share carried by the top 10%", value: "46.5%", note: "of all long days, vs 10% if evenly spread" },
        { label: "Extra working days, May–Aug", value: "2,039", note: "645 drivers, 1.59 per driver on average" },
      ],
      commentary: "Long days are frequent but unevenly spread: half of the drivers had at most one in July, while the most exposed tenth averaged 11.4.",
      sources: ["amplitudes_by_depot", "workload_concentration", "sixth_days_by_depot"],
      notes: "Long days are read from the AM1 (> 11 h) and AM2 (> 12 h) payroll premiums, paid per day; tiers are exclusive.",
    },
    { type: "section", title: "Long days by depot", subtitle: "Each depot is compared to its own number of drivers paid." },
    {
      type: "bar_chart", title: "Long days", highlight: "per driver",
      categories: depots,
      series: [{ name: "Long days per driver (July 2026)", values: [4.06, 2.73, 2.44, 1.71, 1.62, 1.57, 1.51, 1.18] }],
      reference: { label: "Average (2.46)", value: 2.46 },
      valueFormat: "two_decimals",
      commentary: "Allerborn stands out at +65% above the average. Bascharage weighs most in volume but sits close to the average once its 522 drivers are taken into account.",
      sources: ["amplitudes_by_depot"],
    },
    {
      type: "bar_chart", title: "Extra working days", highlight: "per driver",
      categories: ["Findel, Munsbach & Sandweiler", "Koetschette", "Merl & Strassen", "Esch & Aubange", "Bascharage & Bertrange", "Mersch", "Hosingen", "Allerborn"],
      series: [{ name: "6th days per driver (May–Aug 2026)", values: [2.59, 2.56, 2.46, 1.99, 1.59, 1.19, 0.54, 0.33] }],
      reference: { label: "Average (1.59)", value: 1.59 },
      valueFormat: "two_decimals",
      commentary: "The ranking is almost reversed: Allerborn, top for long days, is last for extra days. The two indicators point at different forms of hardship.",
      sources: ["sixth_days_by_depot"],
    },
    {
      type: "bar_chart", title: "Concentration", highlight: "on few drivers",
      categories: ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10"],
      series: [{ name: "Average long days per driver, by decile (July 2026)", values: [0, 0, 0, 0, 0.6, 1.3, 2.3, 3.5, 5.5, 11.4] }],
      valueFormat: "one_decimal", axisTitle: "Long days in the month",
      commentary: "Gini 0.69. The 10% most exposed drivers carry 46.5% of long days; 75 drivers had 10 or more in a single month.",
      sources: ["workload_concentration"],
    },
    {
      type: "table", title: "Depot", highlight: "overview",
      columns: ["Depot", "Drivers paid", "Long days / driver", "vs average", "6th days / driver", "vs average"],
      rows: [
        ["Allerborn", "155", "4.06", "+65%", "0.33", "−79%"],
        ["Bascharage & Bertrange", "522", "2.73", "+11%", "1.59", "0%"],
        ["Koetschette", "168", "2.44", "−1%", "2.56", "+61%"],
        ["Findel, Munsbach & Sandweiler", "65", "1.51", "−39%", "2.59", "+63%"],
        ["Average", "1,250", "2.46", "", "1.59", ""],
      ],
      emphasisRows: [4],
      sources: ["amplitudes_by_depot", "sixth_days_by_depot"],
    },
    {
      type: "findings", title: "What the data", highlight: "shows",
      items: [
        { headline: "Hardship is concentrated.", detail: "A tenth of the drivers carry almost half of the long days; the average hides it." },
        { headline: "It takes two shapes.", detail: "Long days peak in Allerborn, extra working days in Findel, Koetschette and Merl." },
        { headline: "Bascharage is about volume.", detail: "The largest depot, but close to the average per driver." },
      ],
      sources: ["amplitudes_by_depot", "sixth_days_by_depot", "workload_concentration"],
    },
    {
      type: "limits", title: "What the data", highlight: "does not show",
      items: [
        "Actual shift durations: long days are inferred from payroll premiums (> 11 h, > 12 h), not from timesheets.",
        "Long-term trends: premiums are available from January 2026 only, extra days for three reference periods.",
        "Whether the same drivers stay most exposed over time — to be measured with the recurrence indicator.",
        "Part-time drivers count as one driver; per-FTE ratios may differ.",
      ],
    },
  ],
});

renderDeck(spec).then((buf) => { fs.writeFileSync(process.argv[2], buf); console.log(`${spec.slides.length} slides → ${process.argv[2]}`); });
