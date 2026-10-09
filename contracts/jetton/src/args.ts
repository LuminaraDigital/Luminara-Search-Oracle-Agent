/**
 * Command-line arguments for the scripts in this package.
 *
 * Unknown and repeated arguments are errors. A mistyped option must stop the
 * command, not be ignored: these scripts prepare transactions.
 */
export interface ParsedArgs {
  has(flag: string): boolean;
  get(option: string): string | undefined;
}

export function parseArgs(argv: string[], allowed: { flags?: string[]; options?: string[] }): ParsedArgs {
  const flags = new Set<string>();
  const options = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--([a-z][a-z0-9-]*)(?:=(.*))?$/s.exec(argument);
    if (!match) throw new Error(`Unexpected argument "${argument}". Options look like --name or --name=value.`);
    const [, name, value] = match;
    if (flags.has(name) || options.has(name)) throw new Error(`--${name} was given more than once.`);
    if (value === undefined) {
      if (!allowed.flags?.includes(name)) {
        throw new Error(allowed.options?.includes(name) ? `--${name} needs a value: --${name}=<value>.` : `Unknown option --${name}.`);
      }
      flags.add(name);
    } else {
      if (!allowed.options?.includes(name)) {
        throw new Error(allowed.flags?.includes(name) ? `--${name} does not take a value.` : `Unknown option --${name}.`);
      }
      if (value === '') throw new Error(`--${name} needs a value: --${name}=<value>.`);
      options.set(name, value);
    }
  }
  return { has: (flag) => flags.has(flag), get: (option) => options.get(option) };
}
