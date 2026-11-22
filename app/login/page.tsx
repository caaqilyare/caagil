import { redirect } from "next/navigation";
import { one } from "@/lib/db";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const users = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  if (Number(users?.c ?? 0) === 0) redirect("/setup");
  return <LoginForm />;
}
