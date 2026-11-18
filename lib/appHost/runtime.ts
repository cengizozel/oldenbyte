// The bridge the device's code runs on (docs/app-bundle.md), set once when the
// page starts. The stand-ins for the server's database, session and network
// (lib/appHost/device) reach the device through this.
import type { Bridge } from "./bridge";

let bridge: Bridge | null = null;
export const setBridge = (b: Bridge) => { bridge = b; };
export function device(): Bridge {
  if (!bridge) throw new Error("The device is not ready yet.");
  return bridge;
}

// The one person a device belongs to.
export const DEVICE_USER = { id: "device", username: "you", role: "admin", mustChangePassword: false } as const;

// Where things live in the device's store. Whatever is under "device:" stays
// on this device; the app never sends it to the user's other devices.
export const LOCAL = "device:";
export const CACHE_AT = `${LOCAL}cache:`;
export const CONFIG_AT = `${LOCAL}config:`;
export const FILE_AT = `${LOCAL}file:`;
