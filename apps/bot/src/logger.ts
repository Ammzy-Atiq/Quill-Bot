import { type Logger, pino } from 'pino';

export type { Logger };

function prettyAvailable(): boolean {
  try {
    import.meta.resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/** JSON logs in production; pretty logs in development when pino-pretty is installed. */
export function createLogger(level: string, pretty: boolean, bindings: Record<string, unknown> = {}): Logger {
  const usePretty = pretty && prettyAvailable();
  return pino({
    level,
    base: { app: 'quill-guard', ...bindings },
    redact: {
      paths: [
        'token',
        '*.token',
        'apiKey',
        '*.apiKey',
        'accessToken',
        'refreshToken',
        '*.accessToken',
        '*.refreshToken',
      ],
      censor: '[redacted]',
    },
    ...(usePretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,app' },
          },
        }
      : {}),
  });
}
