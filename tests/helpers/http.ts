type Options<Params> = {
  method: string;
  path: string;
  token?: string;
  body?: unknown;
  params: Params;
};

export async function callRoute<Params, Json = Record<string, unknown>>(
  handler: (req: Request, context: { params: Promise<Params> }) => Promise<Response>,
  { method, path, token, body, params }: Options<Params>,
): Promise<{ status: number; json: Json }> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const request = new Request(`http://test${path}`, {
    method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const response = await handler(request, { params: Promise.resolve(params) });
  return { status: response.status, json: await response.json() as Json };
}
