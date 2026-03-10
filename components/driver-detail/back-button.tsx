"use client";

import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackButton() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const backHref = from ? `/heures/drivers?${from}` : "/heures/drivers";

  return (
    <Button variant="ghost" size="icon" asChild>
      <Link href={backHref}>
        <ArrowLeft className="h-4 w-4" />
      </Link>
    </Button>
  );
}
