import type { ExecutionContext, ScheduledController } from '@cloudflare/workers-types';

export interface RelayEnv {
  RENDER_APP_URL?: string;
  CRON_SECRET?: string;
}

export interface RelayOutcome {
  ok: boolean;
  status: number | null;
  skipped?: boolean;
  message: string;
}

function buildTargetEndpoint(rawUrl?: string): string | null {
  const trimmed = rawUrl?.trim();
  if (!trimmed || trimmed.includes('YOUR-RENDER-URL')) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
    return `${base}/api/scheduler/run`;
  } catch {
    return null;
  }
}

export async function runCronRelay(env: RelayEnv): Promise<RelayOutcome> {
  const endpoint = buildTargetEndpoint(env.RENDER_APP_URL);
  if (!endpoint) {
    console.warn('[shortspilot-cron-relay] Skipped: RENDER_APP_URL is not configured yet.');
    return {
      ok: false,
      status: null,
      skipped: true,
      message: 'RENDER_APP_URL is not configured.',
    };
  }

  const cronSecret = env.CRON_SECRET?.trim();
  if (!cronSecret) {
    console.warn('[shortspilot-cron-relay] Skipped: CRON_SECRET Worker secret is not configured.');
    return {
      ok: false,
      status: null,
      skipped: true,
      message: 'CRON_SECRET is not configured.',
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'User-Agent': 'shortspilot-cron-relay/1.0',
      },
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) {
      const rawBody = await res.text().catch(() => '');
      const safeSnippet = rawBody.replace(/\s+/g, ' ').slice(0, 180);
      console.error(
        `[shortspilot-cron-relay] Scheduler request returned HTTP ${res.status}: ${safeSnippet}`
      );
      return {
        ok: false,
        status: res.status,
        message: `Render scheduler returned HTTP ${res.status}`,
      };
    }

    const data = (await res.json().catch(() => ({}))) as {
      processedUsers?: number;
      skipped?: boolean;
      timestamp?: string;
    };

    console.log(
      `[shortspilot-cron-relay] HTTP ${res.status} ok (processedUsers=${
        data.processedUsers ?? 0
      }, skipped=${Boolean(data.skipped)}, timestamp=${data.timestamp ?? 'n/a'})`
    );

    return {
      ok: true,
      status: res.status,
      message: `Scheduler triggered successfully (HTTP ${res.status})`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Network or timeout error';
    console.error(`[shortspilot-cron-relay] Request failed: ${reason}`);
    return {
      ok: false,
      status: null,
      message: reason,
    };
  }
}

export default {
  async fetch(_request: Request): Promise<Response> {
    return new Response(
      JSON.stringify({
        ok: true,
        service: 'shortspilot-cron-relay',
        schedule: '* * * * *',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  },

  async scheduled(
    _controller: ScheduledController,
    env: RelayEnv,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(runCronRelay(env));
  },
};
