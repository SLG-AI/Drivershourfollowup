"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { modules, globalNavItems, getActiveModule, type NavModule } from "@/lib/navigation";
import { Bus, ChevronLeft } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const [selectedModule, setSelectedModule] = useState<NavModule | null>(null);

  // Sync selected module with current pathname
  useEffect(() => {
    const active = getActiveModule(pathname);
    if (active) {
      setSelectedModule(active);
    }
  }, [pathname]);

  // Module list view (first level)
  if (!selectedModule) {
    return (
      <aside className="flex h-screen w-64 flex-col border-r bg-sidebar-background">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
            <Bus className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="font-semibold text-lg">DHF</span>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          <p className="px-3 pb-2 text-xs font-semibold uppercase text-sidebar-foreground/50 tracking-wider">
            Modules
          </p>
          {modules.map((mod) => {
            const isActive = pathname.startsWith(mod.basePath);
            return (
              <button
                key={mod.id}
                onClick={() => setSelectedModule(mod)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors text-left",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <mod.icon className="h-4 w-4" />
                {mod.label}
              </button>
            );
          })}
        </nav>
        <div className="border-t px-3 py-3">
          {globalNavItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </aside>
    );
  }

  // Sub-navigation view (second level)
  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-sidebar-background">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary">
          <Bus className="h-4 w-4 text-primary-foreground" />
        </div>
        <span className="font-semibold text-lg">DHF</span>
      </div>

      {/* Back to modules */}
      <button
        onClick={() => setSelectedModule(null)}
        className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground transition-colors border-b"
      >
        <ChevronLeft className="h-4 w-4" />
        Modules
      </button>

      {/* Module header */}
      <div className="flex items-center gap-2 px-6 py-3">
        <selectedModule.icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">{selectedModule.label}</span>
      </div>

      {/* Sub-nav items */}
      <nav className="flex-1 space-y-1 px-3">
        {selectedModule.items.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t px-3 py-3">
        {globalNavItems.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}
