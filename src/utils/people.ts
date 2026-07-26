const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

export const countryName = (code: string | null | undefined) => {
  const normalized = code?.trim().toUpperCase();
  if (!normalized || !/^[A-Z]{2}$/.test(normalized)) return "Country not reported";
  return regionNames.of(normalized) ?? normalized;
};
