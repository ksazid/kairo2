import { redirect } from "next/navigation";
import { loginPath } from "./route-auth";

type AuthenticationState = { authenticated: boolean };

export function requirePageAuthentication<T extends AuthenticationState>(data: T, returnTo: string): T {
  if (!data.authenticated) redirect(loginPath(returnTo));
  return data;
}
