import assert from "node:assert/strict";
import test from "node:test";
import { darkColors, lightColors } from "./mobileTheme";
type Rgb = [number, number, number];
function rgb(hex: string): Rgb {
  return [1, 3, 5].map(
    (start) => parseInt(hex.slice(start, start + 2), 16) / 255,
  ) as Rgb;
}
function luminance(values: Rgb) {
  return values
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!,
      0,
    );
}
function ratio(a: Rgb, b: Rgb) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}
function composite(rgba: string, base: string): Rgb {
  const parts = rgba.match(/[\d.]+/g)!.map(Number);
  return rgb(base).map(
    (value, index) =>
      value * (1 - parts[3]!) + (parts[index]! / 255) * parts[3]!,
  ) as Rgb;
}
test("native body and secondary text meet AA on every shared surface in both themes", () => {
  for (const colors of [darkColors, lightColors])
    for (const background of [colors.bg, colors.card, colors.cardSoft])
      for (const foreground of [
        colors.textPrimary,
        colors.textSecondary,
        colors.textMuted,
        colors.textTertiary,
        colors.primaryOnTint,
      ]) {
        assert.ok(
          ratio(rgb(foreground), rgb(background)) >= 4.5,
          `${foreground} on ${background}`,
        );
      }
});
test("native status labels meet AA on their tinted surfaces", () => {
  for (const colors of [darkColors, lightColors])
    for (const base of [colors.bg, colors.card, colors.cardSoft])
      for (const tone of [
        colors.successTone,
        colors.warningTone,
        colors.infoTone,
        colors.dangerTone,
        colors.primaryTone,
        colors.riskHigh,
        colors.riskMedium,
        colors.riskLow,
      ]) {
        assert.ok(
          ratio(rgb(tone.text), composite(tone.bg, base)) >= 4.5,
          `${tone.text} on ${tone.bg} over ${base}`,
        );
      }
});
