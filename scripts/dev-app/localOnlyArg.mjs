export const LOCAL_ONLY_ARG = '--local-only'

export function splitLocalOnlyArg(args) {
  const rest = args.filter((arg) => arg !== LOCAL_ONLY_ARG)
  return { localOnly: rest.length !== args.length, rest }
}
