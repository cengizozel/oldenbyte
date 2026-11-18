// The server's sign-in, on a device (docs/app-bundle.md): there is nobody to
// sign in. The device belongs to one person, and every request is theirs.
import type { NextRequest } from "next/server";
import { DEVICE_USER } from "@/lib/appHost/runtime";

export type SessionUser = { id: string; username: string; role: string; mustChangePassword: boolean; deviceId?: string | null };
export type CookieOptions = { httpOnly: true; sameSite: "lax"; secure: boolean; path: "/"; maxAge: number };
export type NewSession = { token: string; cookie: CookieOptions };

export const sessionCookieOptions = (maxAge: number): CookieOptions => ({ httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge });
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function getUserFromRequest(_request: NextRequest): Promise<SessionUser | null> {
  return { ...DEVICE_USER };
}
const none = async (): Promise<never> => { throw new Error("There is no signing in on a device."); };
export const createSession: (userId: string, deviceId?: string) => Promise<NewSession> = none;
export async function destroySession(): Promise<void> {}
export async function destroyAllSessions(): Promise<void> {}
export async function pruneExpiredSessions(): Promise<void> {}
