export function getMessageType(message: string): string {
  const parts = message.split(' ');
  return parts[0];
}
