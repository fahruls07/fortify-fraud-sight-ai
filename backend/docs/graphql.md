# Fortify Alerts GraphQL API

Endpoint: `/api/graphql` (needs a console session cookie and the `alerts.view` permission).
Schema: [`lib/graphql/schema.graphql`](../lib/graphql/schema.graphql). In development, open `/api/graphql` in a browser for GraphiQL.

Status mapping to the console workflow: `ACTIVE` = New, `ACKNOWLEDGED` = Investigating, `RESOLVED` = Decided.

## Query

```graphql
query GetAlerts($status: AlertStatus, $limit: Int) {
  alerts(status: $status, limit: $limit) { id ruleName severity timestamp status }
}
```

```bash
curl -b cookies.txt http://localhost:3000/api/graphql -H 'content-type: application/json' \
  -d '{"query":"query GetAlerts($status: AlertStatus, $limit: Int) { alerts(status: $status, limit: $limit) { id ruleName severity timestamp status } }","variables":{"status":"ACTIVE","limit":10}}'
```

Other filters: `severity`, `from` / `to` (`YYYY-MM-DD`, WIB, inclusive), `offset`. `alertCount(...)` returns the total for the same filters.

## Mutation

```graphql
mutation { acknowledgeAlert(id: "ALT-0142") { id status assignedTo } }
```

Needs `alerts.investigate`. Resolving is a decision (approve / challenge / decline / freeze) and goes through `POST /api/alerts/{id}/decision`, because held funds must be released or stopped.

## Subscription (real time over SSE)

```graphql
subscription OnNewAlert { alertCreated { id ruleName severity } }
```

Transport: Server-Sent Events (GraphQL over SSE, "distinct connections" mode) served by GraphQL Yoga. Each event is `event: next` with `data: {"data":{...}}`.

```js
const q = encodeURIComponent("subscription OnNewAlert { alertCreated { id ruleName severity } }");
const es = new EventSource(`/api/graphql?query=${q}`);           // cookie is sent automatically (same origin)
es.addEventListener("next", (e) => console.log(JSON.parse(e.data).data.alertCreated));
```

```bash
curl -N -b cookies.txt -H 'accept: text/event-stream' \
  "http://localhost:3000/api/graphql?query=subscription%20OnNewAlert%20%7B%20alertCreated%20%7B%20id%20ruleName%20severity%20%7D%20%7D"
```

`alertUpdated` streams status changes the same way.

Why SSE instead of WebSocket: Next.js route handlers cannot upgrade to WebSocket, and SSE works through the existing auth proxy, needs no extra server, and reconnects automatically in the browser. To serve the same schema over WebSocket (`graphql-ws`), run it on a separate Node server with `ws` + `graphql-ws`'s `useServer` and the schema from `lib/graphql/server.ts`.
