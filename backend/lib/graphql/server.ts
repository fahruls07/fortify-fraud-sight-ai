import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GraphQLError } from "graphql";
import { createSchema, createYoga } from "graphql-yoga";
import { can } from "../acm";
import { subscribe } from "../alerts";
import { acknowledge, queryAlerts, viewOf, type AlertQuery } from "../alertview";
import { userFrom } from "../auth";
import { getStore } from "../store";

const typeDefs = readFileSync(join(/*turbopackIgnore: true*/ process.cwd(), "lib", "graphql", "schema.graphql"), "utf8");
type Ctx = { user: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const check = (q: AlertQuery) => { if ((q.from && !DATE.test(q.from)) || (q.to && !DATE.test(q.to))) throw new GraphQLError("from/to must be YYYY-MM-DD"); return q; };

// Bus events → async iterator for one subscriber; cleans up when the client disconnects.
async function* events(kind: "alert.created" | "alert.updated") {
  const queue: unknown[] = []; let wake: (() => void) | null = null;
  const off = subscribe((e) => { if (e.type === kind) { queue.push(e.row); wake?.(); } });
  try {
    for (;;) {
      while (queue.length) { const row = queue.shift() as { id: string }; const a = getStore().alerts.find((x) => x.id === row.id); if (a) yield viewOf(getStore(), a); }
      await new Promise<void>((r) => (wake = r)); wake = null;
    }
  } finally { off(); }
}

const yoga = createYoga<Ctx>({
  graphqlEndpoint: "/api/graphql",
  fetchAPI: { Response },
  graphiql: process.env.NODE_ENV !== "production",
  context: ({ request }) => ({ user: userFrom(request) }), // proxy already requires alerts.view for /api/graphql
  schema: createSchema<Ctx>({
    typeDefs,
    resolvers: {
      Query: {
        alerts: (_, q: AlertQuery) => queryAlerts(getStore(), check(q)).items,
        alertCount: (_, q: AlertQuery) => queryAlerts(getStore(), { ...check(q), limit: 1 }).total,
        alert: (_, { id }: { id: string }) => { const a = getStore().alerts.find((x) => x.id === id); return a ? viewOf(getStore(), a) : null; },
      },
      Mutation: {
        acknowledgeAlert: (_, { id }: { id: string }, ctx) => {
          if (!can(ctx.user, "alerts.investigate")) throw new GraphQLError("Forbidden: you do not have access to this action.");
          const r = acknowledge(getStore(), id, ctx.user);
          if (typeof r === "string") throw new GraphQLError(r);
          return viewOf(getStore(), r);
        },
      },
      Subscription: {
        alertCreated: { subscribe: () => events("alert.created"), resolve: (v: unknown) => v },
        alertUpdated: { subscribe: () => events("alert.updated"), resolve: (v: unknown) => v },
      },
    },
  }),
});

export const handle = (req: Request) => yoga.handleRequest(req, { user: "" });
