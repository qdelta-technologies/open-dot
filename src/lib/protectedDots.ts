/** The team's core dots: deleting one needs the team password (ACCESS_PASSWORD). Matched by name, case-insensitive. */
const PROTECTED_DOTS = ["chintu", "bantu", "atlas", "pluto"];

export const isProtectedDot = (name: string) => PROTECTED_DOTS.includes(name.trim().toLowerCase());
