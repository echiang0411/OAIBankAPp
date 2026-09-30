export function hostingConfig(env: NodeJS.ProcessEnv, port: number) {
  const publicUrl = env.APP_ORIGIN || (env.RAILWAY_PUBLIC_DOMAIN ? `https://${env.RAILWAY_PUBLIC_DOMAIN}` : undefined);
  const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('APP_ORIGIN must be an HTTP or HTTPS origin without a path.');
    }
    origins.add(url.origin);
  }
  const hosts = new Set([...origins].map(origin => new URL(origin).host));
  return {
    bindHost: env.HOST ?? '127.0.0.1',
    allowed(host: string | undefined, origin: string | undefined, method: string, path: string) {
      const healthcheck = Boolean(env.RAILWAY_ENVIRONMENT_ID) && method === 'GET' && path === '/api/health' && host === 'healthcheck.railway.app';
      return (hosts.has(host ?? '') || healthcheck) && (!origin || origins.has(origin));
    },
  };
}
