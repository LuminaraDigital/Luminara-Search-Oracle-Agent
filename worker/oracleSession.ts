/**
 * Durable Object: persist Oracle chat turns per session id.
 */
export class OracleSession {
  private state: DurableObjectState;
  private turns: Array<{ role: string; content: string; at: number }> = [];

  constructor(state: DurableObjectState) {
    this.state = state;
    void this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get<typeof this.turns>('turns');
      if (stored) this.turns = stored;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/history')) {
      return Response.json({ turns: this.turns.slice(-40) });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/append')) {
      const body = (await request.json().catch(() => ({}))) as {
        role?: string;
        content?: string;
      };
      if (body.role && body.content) {
        this.turns.push({ role: body.role, content: body.content, at: Date.now() });
        if (this.turns.length > 80) this.turns = this.turns.slice(-80);
        await this.state.storage.put('turns', this.turns);
      }
      return Response.json({ ok: true, count: this.turns.length });
    }
    if (request.method === 'DELETE') {
      this.turns = [];
      await this.state.storage.delete('turns');
      return Response.json({ ok: true });
    }
    return new Response('Not found', { status: 404 });
  }
}
