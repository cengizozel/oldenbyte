// True in the build of the interface that is packed into the apps
// (docs/app-bundle.md), where there is no server: the page answers its own
// requests on the device.
export const ON_DEVICE = process.env.NEXT_PUBLIC_OB_APP === "1";

// Widgets about the machine an oldenbyte server runs on. With no server there
// is nothing for them to show, so a device does not offer them. One that
// arrives in a dashboard made elsewhere says it needs a server.
export const NEEDS_SERVER_MACHINE = new Set(["server", "docker"]);
