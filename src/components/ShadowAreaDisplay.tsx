import { useTranslation } from "../i18n/useTranslation";
import { designShadowArea } from "../shadowOverlay";

/**
 * Format a shadow area in square meters for display, rounding to whole
 * square meters since the measurement is only accurate to the mask
 * resolution anyway.
 */
export function formatArea(area: number, locale: string): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  return `${formatter.format(Math.round(area))} m²`;
}

/**
 * Shows the ground area currently shadowed by the design buildings, kept in
 * sync with the sun position by the shadow overlay.
 */
export default function ShadowAreaDisplay() {
  const { t, locale } = useTranslation();
  const result = designShadowArea.value;

  let value: string;
  if (result == null) {
    value = t("shadowArea.unavailable");
  } else if (result.area == null) {
    value = t("shadowArea.sunBelowHorizon");
  } else {
    value = formatArea(result.area, locale);
  }

  return (
    <>
      <div class="section-title">{t("shadowArea.title")}</div>
      <div class="row">
        <div class="row-title">{t("shadowArea.proposal")}</div>
        <div class="row-item">
          <span class="shadow-area-value">{value}</span>
        </div>
      </div>
      <div class="shadow-area-hint">{t("shadowArea.hint")}</div>
    </>
  );
}
