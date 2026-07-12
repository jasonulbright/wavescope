/**
 * Butterchurn 3 ships no TypeScript declarations. The engine surface the app
 * relies on is typed in lib/viz/milkdrop.ts; these declarations only give the
 * bare module imports a shape.
 */
declare module "butterchurn" {
  const butterchurn: unknown;
  export default butterchurn;
}

declare module "butterchurn-presets" {
  /** UMD preset pack: preset name → preset object (interop may nest it). */
  const presets: unknown;
  export default presets;
}
