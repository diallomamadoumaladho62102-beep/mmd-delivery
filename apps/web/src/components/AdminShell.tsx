"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
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
import { ADMIN_LOGO, CC_BTN_SECONDARY, CC_INPUT, CC_ROLE_BADGE, CC_SIDEBAR_LINK, CC_SIDEBAR_LINK_ACTIVE, navIcon } from "@/components/admin/adminUi";

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
    let alive = true;
    const beat = async () => {
      try {
        const { adminFetch } = await import("@/lib/adminBrowserAuth");
        if (!alive) return;
        await adminFetch("/api/admin/staff/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "online" }),
        });
      } catch {
        // Presence is best-effort; never block the shell.
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

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
        "flex h-full flex-col border-r border-white/12 bg-white/[0.04] text-white backdrop-blur-[20px] shadow-[10px_10px_24px_rgba(0,0,0,0.25)]",
        railCollapsed ? "w-[88px]" : "w-[260px]",
      ].join(" ")}
      aria-label="Control Center navigation"
    >
      <div className="flex items-center gap-3 px-6 py-7">
        <Link href="/admin" className="flex min-w-0 items-center gap-3">
          <Image
            src={ADMIN_LOGO}
            alt="MMD Delivery"
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-[14px] object-contain"
            priority
          />
          {!railCollapsed ? (
            <span className="truncate text-[22px] font-bold tracking-tight text-[var(--cc-gold)]">
              MMD Control
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          className="ml-auto hidden rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white lg:inline-flex"
          onClick={() => setRailCollapsed((v) => !v)}
          aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <ChevronIcon direction={railCollapsed ? "right" : "left"} />
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-4 pb-4" aria-label="Admin sections">
        {groups.map((group) => {
          const collapsed = collapsedGroups[group.id] === true;
          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className={[
                  "flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--cc-gold)]",
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
                <ul className="mt-2 space-y-1">
                  {group.items.map((item) => {
                    const active = isActivePath(pathname, item.href);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          title={item.label}
                          className={[
                            railCollapsed ? "justify-center" : "gap-3",
                            active ? CC_SIDEBAR_LINK_ACTIVE : CC_SIDEBAR_LINK,
                          ].join(" ")}
                          aria-current={active ? "page" : undefined}
                        >
                          <span className="text-xl leading-none" aria-hidden>
                            {navIcon(item.href)}
                          </span>
                          {!railCollapsed ? (
                            <span className="truncate">{item.label}</span>
                          ) : null}
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

      <div className="border-t border-white/10 p-4">
        {!railCollapsed ? (
          <div className="rounded-2xl border border-white/12 bg-white/[0.06] px-3 py-2.5">
            <p className="truncate text-xs text-white/60">Signed in</p>
            <p className="truncate text-sm font-semibold text-[var(--cc-gold)]">
              {displayRole}
            </p>
          </div>
        ) : null}
      </div>
    </aside>
  );

  return (
    <div className="admin-figma min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1280px]">
        <div className="hidden md:sticky md:top-0 md:flex md:h-screen md:shrink-0">
          {sidebar}
        </div>

        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-[#001a66]/70"
              aria-label="Close menu"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 z-50 shadow-2xl">{sidebar}</div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col overflow-x-auto">
          <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0033CC]/85 backdrop-blur-[12px]">
            <div className="flex h-[72px] items-center gap-3 px-4 sm:h-[88px] lg:px-10">
              <button
                type="button"
                className={`inline-flex h-10 w-10 items-center justify-center md:hidden ${CC_BTN_SECONDARY}`}
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <MenuIcon />
              </button>

              <Link
                href="/admin"
                className="hidden items-center gap-2 sm:inline-flex md:hidden"
              >
                <Image
                  src={ADMIN_LOGO}
                  alt="MMD"
                  width={32}
                  height={32}
                  className="size-8 rounded-lg object-contain"
                />
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
                  className={`${CC_INPUT} max-w-xl`}
                />
              </form>

              <div className="ml-auto flex items-center gap-2">
                {actions}
                <div className={`hidden sm:flex ${CC_ROLE_BADGE}`}>
                  <span aria-hidden>🛡️</span>
                  <span className="max-w-[140px] truncate">
                    {displayRole}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className={`h-10 px-3 text-xs ${CC_BTN_SECONDARY}`}
                >
                  Sign out
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 py-6 lg:px-10 lg:py-8">
            {(title || subtitle) && (
              <div className="mb-6 space-y-1">
                {title ? (
                  <h1 className="cc-page-title">{title}</h1>
                ) : null}
                {subtitle ? (
                  <p className="cc-page-subtitle">{subtitle}</p>
                ) : null}
              </div>
            )}
            {children}
          </main>
        </div>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/12 bg-[#0033CC]/95 px-2 py-2 backdrop-blur md:hidden"
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
                active ? "text-[var(--cc-gold)]" : "text-white/70",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="flex flex-1 flex-col items-center rounded-xl px-2 py-1.5 text-[11px] font-medium text-white/70"
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
