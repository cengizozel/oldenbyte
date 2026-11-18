// Passwords belong to accounts on a server. A device has none
// (docs/app-bundle.md); these exist only so the server's code loads.
export const needsRehash = (): boolean => false;
export async function hashPassword(): Promise<string> { throw new Error("There are no passwords on a device."); }
export async function verifyPassword(): Promise<boolean> { return false; }
