import type { StaffRole } from "@/lib/adminRbac";

export type OrgNodeRole =
  | "founder"
  | StaffRole
  | "finance_director"
  | "ops_director"
  | "marketplace_director"
  | "taxi_director"
  | "safety_director"
  | "ai_director";

export type OrgNode = {
  id: string;
  title: string;
  roleKey: OrgNodeRole;
  department: string;
  children?: OrgNode[];
};

/** Interactive org template — people cards bind live staff rows by role. */
export const MMD_ORG_CHART: OrgNode = {
  id: "founder",
  title: "Founder",
  roleKey: "founder",
  department: "Executive",
  children: [
    {
      id: "super-admin",
      title: "Super Admin",
      roleKey: "admin",
      department: "Executive",
    },
    {
      id: "finance-director",
      title: "Finance Director",
      roleKey: "finance_director",
      department: "Finance",
      children: [
        {
          id: "finance-managers",
          title: "Finance Managers",
          roleKey: "finance",
          department: "Finance",
        },
        {
          id: "payout-managers",
          title: "Payout Managers",
          roleKey: "finance",
          department: "Finance",
        },
      ],
    },
    {
      id: "ops-director",
      title: "Operations Director",
      roleKey: "ops_director",
      department: "Operations",
      children: [
        {
          id: "dispatch-managers",
          title: "Dispatch Managers",
          roleKey: "ops",
          department: "Operations",
        },
        {
          id: "support-managers",
          title: "Support Managers",
          roleKey: "support",
          department: "Support",
        },
        {
          id: "driver-verification",
          title: "Driver Verification",
          roleKey: "review",
          department: "Trust & Safety",
        },
      ],
    },
    {
      id: "marketplace-director",
      title: "Marketplace Director",
      roleKey: "marketplace_director",
      department: "Marketplace",
    },
    {
      id: "taxi-director",
      title: "Taxi Director",
      roleKey: "taxi_director",
      department: "Taxi",
    },
    {
      id: "safety-director",
      title: "Safety Director",
      roleKey: "safety_director",
      department: "Safety",
    },
    {
      id: "ai-director",
      title: "AI Director",
      roleKey: "ai_director",
      department: "MMD AI",
    },
  ],
};

export function staffRolesForOrgNode(roleKey: OrgNodeRole): StaffRole[] {
  switch (roleKey) {
    case "founder":
    case "admin":
      return ["admin"];
    case "finance":
    case "finance_director":
      return ["finance"];
    case "ops":
    case "ops_director":
    case "marketplace_director":
    case "taxi_director":
      return ["ops"];
    case "support":
      return ["support"];
    case "review":
    case "safety_director":
      return ["review"];
    case "ai_director":
      return ["admin", "ops"];
    default:
      return [];
  }
}
