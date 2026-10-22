/** Own property read. Missing keys stay undefined so a prototype field cannot sneak in. */
export function own(value: object, key: string): unknown {
  if (!Object.hasOwn(value, key)) return undefined;
  return Reflect.get(value, key);
}
