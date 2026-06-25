import { prisma } from "@/lib/prisma";
import { isRegistrationEnabled, hasInviteCode } from "@/lib/appconfig";
import { json } from "@/lib/http";

export async function GET() {
  const userCount = await prisma.user.count();
  return json({
    needsSetup: userCount === 0,
    registrationEnabled: await isRegistrationEnabled(),
    hasInvite: await hasInviteCode(),
  });
}
