import { cookies } from "next/headers";
import { loadAccessibleBrandDirectory } from "./brand-access";

export type ShellBrandOption = {
  id: string;
  name: string;
};

const apiBase = () => (process.env.KAIRO_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

export async function getShellBrandOptions(): Promise<ShellBrandOption[]> {
  const token = (await cookies()).get("kairo_access_token")?.value;
  if (!token) return [];

  const directory = await loadAccessibleBrandDirectory({ token, apiBase: apiBase() });
  if (!directory.authenticated) return [];
  return directory.brands.map(({ id, name }) => ({ id, name }));
}
