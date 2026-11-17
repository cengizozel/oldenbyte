"use client";

import { useState } from "react";
import { SettingsRow, SettingsSection, FOCUS_RING } from "@/components/ui/Field";
import Toggle from "@/components/ui/Toggle";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import * as storage from "@/lib/storage";
import { ELEVATED_KEY, POWERS, POWER_DETAIL, POWER_LABEL, missingPowers, type ElevatedSettings, type InstalledWidget, type Power } from "@/lib/customWidgets";
import { refreshCustomWidgets, removeCustomWidget, setCustomWidgetEnabled, useCustomWidgets } from "@/lib/useCustomWidgets";
import { widgetWarning } from "@/components/CustomWidget";

// Settings > Custom widgets (docs/custom-widgets.md): the account's switches
// for elevated widgets, off until the user turns them on, and the list of
// widget files installed for this account.

const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(b < 10 * 1024 ? 1 : 0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const SMALL = `h-7 px-2.5 rounded-lg text-sm bg-black/5 dark:bg-white/10 text-[var(--text-primary)] hover:bg-black/10 dark:hover:bg-white/15 ${FOCUS_RING}`;

export function CustomWidgetsSettings() {
  const { loaded, widgets, elevated } = useCustomWidgets();
  const [confirmAllow, setConfirmAllow] = useState(false);
  const [confirmOn, setConfirmOn] = useState<InstalledWidget | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function save(next: ElevatedSettings) {
    setError("");
    if (!(await storage.setItem(ELEVATED_KEY, JSON.stringify(next)))) setError("Could not save.");
    await refreshCustomWidgets();
  }
  const setPower = (p: Power) => save({ ...elevated, [p]: !elevated[p] });

  async function toggleWidget(w: InstalledWidget) {
    setError("");
    if (!w.enabled) { setConfirmOn(w); return; }
    const res = await setCustomWidgetEnabled(w.ext, false);
    if (!res.ok) setError(res.error);
  }

  return (
    <SettingsSection title="Custom widgets">
      <SettingsRow
        label="Allow elevated widgets"
        hint="Off: a widget from outside oldenbyte can only keep its own data. On: a widget may ask for the powers below, and you switch each such widget on yourself."
      >
        <Toggle checked={elevated.allow} onChange={() => (elevated.allow ? save({ ...elevated, allow: false }) : setConfirmAllow(true))} label="Allow elevated widgets" />
      </SettingsRow>
      {elevated.allow && POWERS.map(p => (
        <SettingsRow key={p} label={POWER_LABEL[p]} hint={POWER_DETAIL[p]}>
          <Toggle checked={elevated[p]} onChange={() => setPower(p)} label={POWER_LABEL[p]} />
        </SettingsRow>
      ))}
      {loaded && widgets.length === 0 && (
        <SettingsRow label="No custom widgets yet" hint="Upload a widget file, or install one from the Community tab, in the widget picker (edit mode)." />
      )}
      {widgets.map(w => {
        const powers = w.manifest.powers ?? [];
        const missing = missingPowers(powers, elevated);
        const about = [
          w.source === "community" ? "community catalog" : "uploaded by you",
          powers.length ? `elevated: ${powers.map(p => POWER_LABEL[p].toLowerCase()).join(", ")}` : "standard",
          size(w.bytes),
        ].join(" · ");
        return (
          <SettingsRow
            key={w.ext}
            label={`${w.manifest.name} ${w.manifest.version}`}
            hint={missing.length ? `${about}. Needs ${missing.map(p => POWER_LABEL[p].toLowerCase()).join(", ")} switched on above.` : about}
          >
            {powers.length > 0 && missing.length === 0 && <Toggle checked={w.enabled} onChange={() => toggleWidget(w)} label={`${w.manifest.name} switched on`} />}
            {confirmRemove === w.ext ? (
              <>
                <button type="button" className={`${SMALL} !text-red-600 dark:!text-red-400`} onClick={async () => { setConfirmRemove(null); const r = await removeCustomWidget(w.ext); if (!r.ok) setError(r.error); }}>Remove</button>
                <button type="button" className={SMALL} onClick={() => setConfirmRemove(null)}>Keep</button>
              </>
            ) : (
              <button type="button" className={SMALL} onClick={() => setConfirmRemove(w.ext)} title="Remove the widget file. Widgets already on a dashboard keep their data.">Remove</button>
            )}
          </SettingsRow>
        );
      })}
      {error && <SettingsRow label={<span className="text-red-500">{error}</span>} />}
      {confirmAllow && (
        <ConfirmDialog
          title="Allow elevated widgets?"
          detail={
            <>
              <p>Elevated widgets are code from outside oldenbyte that can do more than keep their own data: reach the network, read your other widgets, or read your file library.</p>
              <p>Nothing changes until you also switch on a power and then a widget that asks for it. Each widget shows what it asks for first.</p>
            </>
          }
          cancelLabel="Keep it off"
          confirmLabel="Allow"
          onCancel={() => setConfirmAllow(false)}
          onConfirm={() => { setConfirmAllow(false); save({ ...elevated, allow: true }); }}
        />
      )}
      {confirmOn && (
        <ConfirmDialog
          title={`Switch on ${confirmOn.manifest.name}?`}
          detail={widgetWarning(confirmOn.manifest, elevated).detail}
          cancelLabel="Keep it off"
          confirmLabel="I trust it, switch it on"
          onCancel={() => setConfirmOn(null)}
          onConfirm={async () => { const w = confirmOn; setConfirmOn(null); const r = await setCustomWidgetEnabled(w.ext, true); if (!r.ok) setError(r.error); }}
        />
      )}
    </SettingsSection>
  );
}
