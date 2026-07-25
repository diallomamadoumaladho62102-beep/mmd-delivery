"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  resolveBrowserStaffSession,
  type ResolvedStaffSession,
} from "@/lib/adminBrowserAuth";
import { filterNavGroups } from "@/lib/adminNav";
import {
  isStaffRole,
  roleDisplayName,
  type StaffRole,
} from "@/lib/adminRbac";
import { sessionHasPermission } from "@/lib/adminSessionAccess";
import { supabase } from "@/lib/supabaseBrowser";

type ShellProps = {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
};

function isActivePath(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminShell({
  title,
  subtitle,
  children,
  actions,
}: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<ResolvedStaffSession | null>(null);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(
    {}
  );
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    void resolveBrowserStaffSession().then((s) => {
      if (alive) setSession(s);
    });
    return () => {
      alive = false;
    };
  }, [pathname]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const role: StaffRole | null =
    session?.role && isStaffRole(session.role) ? session.role : null;

  const groups = useMemo(
    () =>
      filterNavGroups({
        role,
        isFounder: session?.isFounder === true,
        hasPermission: (permission) =>
          sessionHasPermission(
            { role: session?.role ?? null, isFounder: session?.isFounder },
            permission
          ),
      }),
    [role, session]
  );

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/admin/login");
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim().toLowerCase();
    if (!q) return;
    const hit = groups
      .flatMap((g) => g.items)
      .find((item) => item.label.toLowerCase().includes(q));
    if (hit) router.push(hit.href);
  }

  const displayRole = roleDisplayName(session?.role ?? null, {
    isFounder: session?.isFounder,
  });

  const sidebar = (
    <aside
      className={[
        "flex h-full flex-col border-r border-slate-800/80 bg-[var(--cc-sidebar)] text-[var(--cc-sidebar-text)]",
        railCollapsed ? "w-[72px]" : "w-[260px]",
      ].join(" ")}
    >
      <div className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
        <Link href="/admin" className="flex min-w-0 items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--cc-ai)] text-xs font-bold text-white">
            MMD
          </span>
          {!railCollapsed ? (
            <span className="truncate text-sm font-semibold tracking-tight">
              Control Center
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          className="ml-auto hidden rounded-lg p-1.5 text-[var(--cc-sidebar-muted)] hover:bg-white/10 hover:text-white lg:inline-flex"
          onClick={() => setRailCollapsed((v) => !v)}
          aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronIcon direction={railCollapsed ? "right" : "left"} />
        </button>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto px-2 py-3"
        aria-label="Control Center navigation"
      >
        {groups.map((group) => {
          const collapsed = collapsedGroups[group.id] === true;
          return (
            <div key={group.id} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--cc-sidebar-muted)] hover:bg-white/5 hover:text-white",
                  railCollapsed ? "justify-center" : "",
                ].join(" ")}
                title={group.label}
              >
                {!railCollapsed ? (
                  <>
                    <span className="flex-1 truncate">{group.label}</span>
                    <ChevronIcon direction={collapsed ? "right" : "down"} />
                  </>
                ) : (
                  <span>{group.label.slice(0, 1)}</span>
                )}
              </button>
              {!collapsed ? (
                <ul className="mt-0.5 space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActivePath(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={item.label}
                          className={[
                            "flex items-center rounded-lg px-2.5 py-2 text-sm transition-colors duration-150",
                            railCollapsed ? "justify-center" : "gap-2",
                            active
                              ? "bg-white/12 font-medium text-white"
                              : "text-slate-300 hover:bg-white/8 hover:text-white",
                          ].join(" ")}
                          aria-current={active ? "page" : undefined}
                        >
                          {!railCollapsed ? (
                            <span className="truncate">{item.label}</span>
                          ) : (
                            <span className="text-xs font-semibold">
                              {item.label.slice(0, 2)}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 p-3">
        {!railCollapsed ? (
          <div className="rounded-xl bg-white/5 px-3 py-2.5">
            <p className="truncate text-xs text-[var(--cc-sidebar-muted)]">Signed in</p>
            <p className="truncate text-sm font-medium text-white">{displayRole}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[var(--cc-bg)] text-[var(--cc-text)]">
      <div className="flex min-h-screen">
        <div className="hidden md:sticky md:top-0 md:flex md:h-screen md:shrink-0">
          {sidebar}
        </div>

        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-50 shadow-2xl">{sidebar}</div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-[var(--cc-border)] bg-[var(--cc-surface)]/95 backdrop-blur">
            <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--cc-border)] bg-white text-slate-600 md:hidden"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <MenuIcon />
              </button>

              <Link
                href="/admin"
                className="hidden items-center gap-2 sm:inline-flex md:hidden"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--cc-ai)] text-[10px] font-bold text-white">
                  MMD
                </span>
              </Link>

              <form onSubmit={onSearchSubmit} className="min-w-0 flex-1 max-w-xl">
                <label className="sr-only" htmlFor="cc-search">
                  Search modules
                </label>
                <input
                  id="cc-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search modules…"
                  className="h-9 w-full rounded-xl border border-[var(--cc-border)] bg-[var(--cc-elevated)] px-3 text-sm text-slate-800 outline-none ring-[var(--cc-info)] placeholder:text-slate-400 focus:ring-2"
                />
              </form>

              <div className="ml-auto flex items-center gap-2">
                {actions}
                <button
                  type="button"
                  disabled
                  className="inline-flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl border border-[var(--cc-border)] bg-slate-50 text-slate-400"
                  aria-label="Notifications — coming soon"
                  title="Notifications — coming soon"
                >
                  <BellIcon />
                </button>
                <div className="hidden items-center gap-2 rounded-xl border border-[var(--cc-border)] bg-white px-2.5 py-1.5 sm:flex">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {(displayRole || "A").slice(0, 1)}
                  </span>
                  <span className="max-w-[120px] truncate text-xs font-medium text-slate-700">
                    {displayRole}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="h-9 rounded-xl border border-[var(--cc-border)] bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Sign out
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
            {(title || subtitle) && (
              <div className="mb-6 space-y-1">
                {title ? (
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    {title}
                  </h1>
                ) : null}
                {subtitle ? (
                  <p className="text-sm text-[var(--cc-muted)]">{subtitle}</p>
                ) : null}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--cc-border)] bg-white/95 px-2 py-2 backdrop-blur md:hidden"
        aria-label="Mobile quick nav"
      >
        {[
          { href: "/admin", label: "Home" },
          { href: "/admin/orders", label: "Ops" },
          { href: "/admin/finance", label: "Finance" },
          { href: "/admin/tasks", label: "Tasks" },
        ].map((item) => {
          const active = isActivePath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "flex flex-1 flex-col items-center rounded-xl px-2 py-1.5 text-[11px] font-medium",
                active ? "text-[var(--cc-info)]" : "text-slate-500",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex flex-1 flex-col items-center rounded-xl px-2 py-1.5 text-[11px] font-medium text-slate-500"
        >
          More
        </button>
      </nav>
      <div className="h-16 md:hidden" />
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" | "down" }) {
  const rotation =
    direction === "down" ? "rotate-90" : direction === "left" ? "rotate-180" : "";
  return (
    <svg
      viewBox="0 0 20 20"
      className={`h-3.5 w-3.5 shrink-0 ${rotation}`}
      fill="currentColor"
      aria-hidden
    >
      <path d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zm0 5A.75.75 0 012.75 9h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 9.75zm0 5a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM8 16a2 2 0 104 0H8z" />
    </svg>
  );
}
