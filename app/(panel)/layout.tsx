import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/db";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const panelName =
    (await getSetting("panel_name")) || process.env.NEXT_PUBLIC_PANEL_NAME || "Caagil";

  return (
    <Shell user={user} panelName={panelName}>
      {children}
    </Shell>
  );
}
