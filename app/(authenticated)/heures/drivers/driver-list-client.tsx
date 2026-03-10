"use client";

import { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { getStatusLabel, getStatusColor, type DriverStatus } from "@/lib/utils/status-helpers";

interface DriverSummary {
  driver_id: string;
  code_salarie: string;
  vehicle_type: string;
  total_positive_hours: number;
  total_missing_hours: number;
  total_overtime_pay: number;
  latest_counter: number;
  buffer_hours: number;
  months_recorded: number;
}

type SortKey = "code_salarie" | "vehicle_type" | "latest_counter" | "total_overtime_pay" | "status";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

const VALID_SORT_KEYS: SortKey[] = ["code_salarie", "vehicle_type", "latest_counter", "total_overtime_pay", "status"];

export function DriverListClient({ drivers }: { drivers: DriverSummary[] }) {
  const searchParams = useSearchParams();

  const initialSort = searchParams.get("sort") as SortKey | null;
  const initialDir = searchParams.get("dir") as SortDir | null;

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(
    initialSort && VALID_SORT_KEYS.includes(initialSort) ? initialSort : "code_salarie"
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    initialDir === "desc" ? "desc" : "asc"
  );
  const [page, setPage] = useState(0);

  // Compute critical driver IDs based on percentile thresholds (full list, not filtered)
  const criticalDriverIds = useMemo(() => {
    const ids = new Set<string>();
    if (drivers.length === 0) return ids;
    const top10Count = Math.max(1, Math.ceil(drivers.length * 0.1));

    // Top 10% by (overtime_pay + counter)
    const bySum = [...drivers].sort(
      (a, b) => (Number(b.total_overtime_pay) + Number(b.latest_counter))
              - (Number(a.total_overtime_pay) + Number(a.latest_counter))
    );
    for (let i = 0; i < top10Count; i++) ids.add(bySum[i].driver_id);

    // Bottom 10% by counter (lowest values)
    const byCounter = [...drivers].sort(
      (a, b) => Number(a.latest_counter) - Number(b.latest_counter)
    );
    for (let i = 0; i < top10Count; i++) ids.add(byCounter[i].driver_id);

    return ids;
  }, [drivers]);

  const filtered = useMemo(() => {
    let result = [...drivers];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter((d) =>
        d.code_salarie.toLowerCase().includes(q)
      );
    }
    result.sort((a, b) => {
      let cmp: number;
      if (sortKey === "status") {
        const aIsCritical = criticalDriverIds.has(a.driver_id) ? 1 : 0;
        const bIsCritical = criticalDriverIds.has(b.driver_id) ? 1 : 0;
        cmp = aIsCritical - bIsCritical;
      } else if (sortKey === "code_salarie" || sortKey === "vehicle_type") {
        cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      } else {
        cmp = Number(a[sortKey]) - Number(b[sortKey]);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return result;
  }, [drivers, search, sortKey, sortDir]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageData = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    const newDir = sortKey === key ? (sortDir === "asc" ? "desc" : "asc") : "asc";
    const newKey = key;
    setSortKey(newKey);
    setSortDir(newDir);
    setPage(0);

    // Update URL without triggering server re-render
    const url = new URL(window.location.href);
    url.searchParams.set("sort", newKey);
    url.searchParams.set("dir", newDir);
    window.history.replaceState(window.history.state, "", url.toString());
  }

  function buildFromParams() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.set("sort", sortKey);
    params.set("dir", sortDir);
    return params.toString();
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) return <ChevronsUpDown className="ml-1 h-3 w-3" />;
    return sortDir === "asc"
      ? <ChevronUp className="ml-1 h-3 w-3" />
      : <ChevronDown className="ml-1 h-3 w-3" />;
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Rechercher un code salarié..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="pl-9"
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button className="flex items-center font-medium" onClick={() => toggleSort("code_salarie")}>
                  Code salarié <SortIcon column="code_salarie" />
                </button>
              </TableHead>
              <TableHead>
                <button className="flex items-center font-medium" onClick={() => toggleSort("vehicle_type")}>
                  Type <SortIcon column="vehicle_type" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button className="ml-auto flex items-center font-medium" onClick={() => toggleSort("latest_counter")}>
                  Compteur <SortIcon column="latest_counter" />
                </button>
              </TableHead>
              <TableHead className="text-right">
                <button className="ml-auto flex items-center font-medium" onClick={() => toggleSort("total_overtime_pay")}>
                  Heures sup. <SortIcon column="total_overtime_pay" />
                </button>
              </TableHead>
              <TableHead>
                <button className="flex items-center font-medium" onClick={() => toggleSort("status")}>
                  Statut <SortIcon column="status" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  Aucun conducteur trouvé
                </TableCell>
              </TableRow>
            ) : (
              pageData.map((d) => (
                <TableRow key={d.driver_id}>
                  <TableCell>
                    <Link
                      href={`/heures/drivers/${d.driver_id}?from=${encodeURIComponent(buildFromParams())}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {d.code_salarie}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{d.vehicle_type}</Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(d.latest_counter).toFixed(2)}h
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {Number(d.total_overtime_pay) > 0 ? (
                      <span className="text-red-600">
                        {Number(d.total_overtime_pay).toFixed(2)}h
                      </span>
                    ) : (
                      "0,00h"
                    )}
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const status: DriverStatus = criticalDriverIds.has(d.driver_id) ? "red" : "green";
                      return (
                        <Badge className={getStatusColor(status)} variant="secondary">
                          {getStatusLabel(status)}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {filtered.length} conducteur(s) — Page {page + 1}/{totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
            >
              Précédent
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
