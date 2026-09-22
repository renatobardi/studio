// pngjs as Playwright ships it — an exported entry point of playwright-core that publishes no
// declaration. Only what tools/compare-reference.mjs uses, typed by hand so `checkJs` can check
// that script instead of reading it as `any` (#260).
declare module "playwright-core/lib/utilsBundle" {
  interface DecodedPng {
    width: number;
    height: number;
    data: Buffer;
  }

  export const PNG: {
    new (options: { width: number; height: number }): { data: Buffer };
    sync: {
      read(buffer: Buffer): DecodedPng;
      write(png: { data: Buffer }): Buffer;
    };
  };
}
