export function formatHours(value: number): string {
  return value.toFixed(2).replace(".", ",") + "h";
}

/** Montant en euros, à l'euro près : « 1 234 567 € ». */
export function formatEuros(value: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("fr-FR").format(value);
}
