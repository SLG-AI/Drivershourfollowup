"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { VEHICLE_TYPES } from "@/lib/constants";
import { getActiveModule } from "@/lib/navigation";
import { ChevronDown, Search } from "lucide-react";

interface ReferencePeriod {
  id: string;
  year: number;
  period_number: number;
  label: string;
}

function HeuresFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [periods, setPeriods] = useState<ReferencePeriod[]>([]);
  const [open, setOpen] = useState(false);

  const periodParam = searchParams.get("period") || "";
  const selectedPeriodIds = periodParam ? periodParam.split(",") : [];
  const vehicleType = searchParams.get("vehicle") || "all";

  const hasCleaned = useRef(false);
  useEffect(() => {
    async function fetchPeriods() {
      const supabase = createClient();
      const { data } = await supabase
        .from("reference_periods")
        .select("*")
        .order("year", { ascending: false })
        .order("period_number", { ascending: false });
      if (data) {
        setPeriods(data);
        if (!hasCleaned.current && selectedPeriodIds.length > 0) {
          hasCleaned.current = true;
          const validIds = new Set(data.map((p) => p.id));
          const cleaned = selectedPeriodIds.filter((id) => validIds.has(id));
          if (cleaned.length !== selectedPeriodIds.length) {
            const params = new URLSearchParams(searchParams.toString());
            if (cleaned.length === 0 || cleaned.length === data.length) {
              params.delete("period");
            } else {
              params.set("period", cleaned.join(","));
            }
            router.replace(`${pathname}?${params.toString()}`);
          }
        }
      }
    }
    fetchPeriods();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const togglePeriod = useCallback(
    (id: string) => {
      let next: string[];
      if (selectedPeriodIds.includes(id)) {
        next = selectedPeriodIds.filter((p) => p !== id);
      } else {
        next = [...selectedPeriodIds, id];
      }
      if (next.length === 0 || next.length === periods.length) {
        updateParams("period", "");
      } else {
        updateParams("period", next.join(","));
      }
    },
    [selectedPeriodIds, periods, updateParams]
  );

  const selectAll = useCallback(() => {
    updateParams("period", "");
  }, [updateParams]);

  const allSelected = selectedPeriodIds.length === 0;

  let triggerLabel = "Toutes les périodes";
  if (!allSelected) {
    if (selectedPeriodIds.length === 1) {
      const p = periods.find((p) => p.id === selectedPeriodIds[0]);
      triggerLabel = p?.label || "1 période";
    } else {
      triggerLabel = `${selectedPeriodIds.length} périodes`;
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-[260px] justify-between font-normal"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[260px] p-2" align="end">
          <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() => selectAll()}
            />
            <span className="font-medium">Toutes les périodes</span>
          </label>
          <div className="my-1 border-t" />
          {periods.map((p) => {
            const isChecked = allSelected || selectedPeriodIds.includes(p.id);
            return (
              <label
                key={p.id}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => togglePeriod(p.id)}
                />
                {p.label}
              </label>
            );
          })}
        </PopoverContent>
      </Popover>

      <Select
        value={vehicleType}
        onValueChange={(val) => updateParams("vehicle", val === "all" ? "" : val)}
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Tous</SelectItem>
          {VEHICLE_TYPES.map((type) => (
            <SelectItem key={type} value={type}>
              {type === "BUS" ? "Bus" : "Van (CAM)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

const MONTH_LABELS: Record<number, string> = {
  1: "Janvier", 2: "Février", 3: "Mars", 4: "Avril",
  5: "Mai", 6: "Juin", 7: "Juillet", 8: "Août",
  9: "Septembre", 10: "Octobre", 11: "Novembre", 12: "Décembre",
};

function MultiSelectFilter({
  label,
  paramKey,
  options,
  searchParams,
  onUpdate,
}: {
  label: string;
  paramKey: string;
  options: string[];
  searchParams: URLSearchParams;
  onUpdate: (key: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const paramValue = searchParams.get(paramKey) || "";
  const selected = paramValue ? paramValue.split(",") : [];
  const allSelected = selected.length === 0;

  const filtered = search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options;

  const toggle = (value: string) => {
    let next: string[];
    if (allSelected) {
      // "Tous" is active: clicking an item deselects it (select all except this one)
      next = options.filter((o) => o !== value);
    } else if (selected.includes(value)) {
      next = selected.filter((s) => s !== value);
    } else {
      next = [...selected, value];
    }
    onUpdate(paramKey, next.length === 0 || next.length === options.length ? "" : next.join(","));
  };

  const toggleAll = () => {
    if (allSelected) {
      // Deselect all — clear the filter (no items selected = empty results)
      // Instead, keep "Tous" as a toggle: if already all, do nothing meaningful
      // But user wants to deselect → we can't have 0 items, so just keep all
      return;
    }
    onUpdate(paramKey, "");
  };

  let triggerLabel = `Tous (${label})`;
  if (!allSelected) {
    triggerLabel = selected.length === 1 ? selected[0] : `${selected.length} ${label.toLowerCase()}`;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="max-w-[200px] justify-between font-normal text-xs h-9"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-2" align="end">
        {options.length > 6 && (
          <div className="flex items-center gap-2 px-2 pb-2">
            <Search className="h-3.5 w-3.5 opacity-50" />
            <Input
              placeholder="Rechercher..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
        )}
        <label className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent">
          <Checkbox checked={allSelected} onCheckedChange={() => toggleAll()} />
          <span className="font-medium text-xs">Tous</span>
        </label>
        <div className="my-1 border-t" />
        <div className="max-h-[250px] overflow-y-auto">
          {filtered.map((option) => {
            const isChecked = allSelected || selected.includes(option);
            return (
              <label
                key={option}
                className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs cursor-pointer hover:bg-accent"
              >
                <Checkbox checked={isChecked} onCheckedChange={() => toggle(option)} />
                <span className="truncate">{option}</span>
              </label>
            );
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-2 text-xs text-muted-foreground">Aucun résultat</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function WorkforceFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [fonctions, setFonctions] = useState<string[]>([]);
  const [centreCouts, setCentreCouts] = useState<string[]>([]);
  const [depots, setDepots] = useState<string[]>([]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const selectedYear = searchParams.get("year") || String(currentYear);
  const selectedMonth = searchParams.get("month") || String(currentMonth);
  const years = Array.from({ length: 4 }, (_, i) => currentYear + 1 - i);

  useEffect(() => {
    async function fetchOptions() {
      const supabase = createClient();
      const { data } = await supabase
        .from("wp_employees")
        .select("description_fonction, centre_cout, description_departement");
      if (data) {
        const fns = [...new Set(data.map((e) => e.description_fonction).filter(Boolean))].sort() as string[];
        const ccs = [...new Set(data.map((e) => e.centre_cout).filter(Boolean))].sort() as string[];
        const deps = [...new Set(data.map((e) => e.description_departement).filter(Boolean))].sort() as string[];
        setFonctions(fns);
        setCentreCouts(ccs);
        setDepots(deps);
      }
    }
    fetchOptions();
  }, []);

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const updateSimpleFilter = useCallback(
    (key: string, value: string, defaultValue: string) => {
      updateFilter(key, value === defaultValue ? "" : value);
    },
    [updateFilter]
  );

  return (
    <>
      <Select value={selectedMonth} onValueChange={(v) => updateSimpleFilter("month", v, String(currentMonth))}>
        <SelectTrigger className="w-[130px] h-9 text-xs">
          <SelectValue placeholder="Mois" />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <SelectItem key={m} value={String(m)}>
              {MONTH_LABELS[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={selectedYear} onValueChange={(v) => updateSimpleFilter("year", v, String(currentYear))}>
        <SelectTrigger className="w-[90px] h-9 text-xs">
          <SelectValue placeholder="Année" />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {fonctions.length > 0 && (
        <MultiSelectFilter
          label="Fonctions"
          paramKey="fonctions"
          options={fonctions}
          searchParams={new URLSearchParams(searchParams.toString())}
          onUpdate={updateFilter}
        />
      )}
      {centreCouts.length > 0 && (
        <MultiSelectFilter
          label="Cost Centers"
          paramKey="cc"
          options={centreCouts}
          searchParams={new URLSearchParams(searchParams.toString())}
          onUpdate={updateFilter}
        />
      )}
      {depots.length > 0 && (
        <MultiSelectFilter
          label="Dépôts"
          paramKey="depots"
          options={depots}
          searchParams={new URLSearchParams(searchParams.toString())}
          onUpdate={updateFilter}
        />
      )}
    </>
  );
}

export function Header() {
  const pathname = usePathname();
  const activeModule = getActiveModule(pathname);

  return (
    <header className="flex h-16 items-center justify-between border-b bg-background px-6">
      <div>
        {activeModule && (
          <span className="text-sm font-medium text-muted-foreground">
            {activeModule.label}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {activeModule?.id === "heures" && <HeuresFilters />}
        {activeModule?.id === "workforce" && <WorkforceFilters />}
      </div>
    </header>
  );
}
