import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const users = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  if (Number(users?.c ?? 0) > 0) redirect("/login");
  return <SetupForm />;
}
