/** Image requests advertise supported resources without spoofing browser identity. */
export function imageFetchHeaders(referer: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8',
  };
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.username = '';
        url.password = '';
        url.hash = '';
        headers['referer'] = url.href;
      }
    } catch {
      /* Invalid and local referrers must not leave the machine. */
    }
  }
  return headers;
}
