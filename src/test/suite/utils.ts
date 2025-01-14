import * as util from 'util';

export function debugLog(prefix: string, value: any) {
  if (process.env.DEBUG) {
    console.log(`${prefix}: ${util.inspect(value, { depth: null, colors: true })}`);
  }
}
