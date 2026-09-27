import { OrganizationsTable } from "@/components/platform/organizations-table";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Organizaciones</h1>
      <OrganizationsTable />
    </div>
  );
}
