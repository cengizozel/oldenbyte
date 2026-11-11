import { describe, expect, it } from "vitest";
import { LOCALES, readLocale, translate } from "@/lib/i18n";

describe("translate", () => {
  it("returns the English string and fills placeholders", () => {
    expect(translate("en", "common.save")).toBe("Save");
    expect(translate("en", "common.removeNamed", { name: "Bog" })).toBe("Remove Bog");
  });
  it("picks a plural form by count", () => {
    expect(translate("en", "common.andMore", { count: 1 })).toBe("and 1 more");
    expect(translate("en", "common.andMore", { count: 4 })).toBe("and 4 more");
  });
  it("falls back to English for an unknown locale or a missing key", () => {
    expect(translate("xx", "common.cancel")).toBe("Cancel");
    LOCALES.zz = { label: "Test", messages: { common: { save: "Sauver" } } };
    expect(translate("zz", "common.save")).toBe("Sauver");
    expect(translate("zz", "common.cancel")).toBe("Cancel");
    delete LOCALES.zz;
  });
  it("only accepts known locales", () => {
    expect(readLocale("en")).toBe("en");
    expect(readLocale("nope")).toBe("en");
    expect(readLocale(null)).toBe("en");
  });
});
