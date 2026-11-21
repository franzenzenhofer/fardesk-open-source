const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_OCTET = 255;
const CGNAT_FIRST_OCTET = 100;
const CGNAT_SECOND_MIN = 64;
const CGNAT_SECOND_MAX = 127;
const LOOPBACK_NAMES = new Set(["localhost", "::1"]);
const LOOPBACK_FIRST_OCTET = 127;

export function isTailnetAddress(text: string): boolean {
  const match = IPV4_PATTERN.exec(text);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  const [first = 0, second = 0] = octets;
  return (
    octets.every((octet) => octet <= MAX_OCTET) && first === CGNAT_FIRST_OCTET && second >= CGNAT_SECOND_MIN && second <= CGNAT_SECOND_MAX
  );
}

export function isLoopbackAddress(text: string): boolean {
  if (LOOPBACK_NAMES.has(text)) return true;
  const match = IPV4_PATTERN.exec(text);
  return match !== null && Number(match[1]) === LOOPBACK_FIRST_OCTET;
}
